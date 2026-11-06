import net from "node:net";

const MAX_INITIAL_REQUEST_BYTES = 2_048;
const MAX_RETAINED_PAIRS = 64;

function assertLoopbackHost(host, label) {
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error(`${label} must be loopback-only.`);
  }
}

function positiveInteger(value, label, { allowZero = false, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > max) {
    throw new Error(`${label} is outside its allowed range.`);
  }
  return value;
}

/**
 * A local raw TCP forwarder for an isolated browser profile. Faults apply to
 * WebSocket TCP pairs identified from their HTTP upgrade request. Blackhole
 * mode discards all bytes in both directions and suppresses the upstream FIN;
 * release destroys every old WebSocket pair before normal forwarding resumes.
 */
export class LocalTcpFaultProxy {
  constructor({
    upstreamHost,
    upstreamPort,
    listenHost = "127.0.0.1",
    delayMs = 0,
    bytesPerSecond = 0,
    maxQueuedBytes = 512 * 1_024,
    maxQueuedChunks = 256,
  }) {
    assertLoopbackHost(upstreamHost, "upstreamHost");
    assertLoopbackHost(listenHost, "listenHost");
    this.upstreamHost = upstreamHost === "localhost" ? "127.0.0.1" : upstreamHost.replace(/^\[|\]$/gu, "");
    this.upstreamPort = positiveInteger(upstreamPort, "upstreamPort", { max: 65_535 });
    this.listenHost = listenHost === "localhost" ? "127.0.0.1" : listenHost.replace(/^\[|\]$/gu, "");
    this.delayMs = positiveInteger(delayMs, "delayMs", { allowZero: true, max: 500 });
    this.bytesPerSecond = positiveInteger(bytesPerSecond, "bytesPerSecond", { allowZero: true, max: 10 * 1_024 * 1_024 });
    this.maxQueuedBytes = positiveInteger(maxQueuedBytes, "maxQueuedBytes", { max: 2 * 1_024 * 1_024 });
    this.maxQueuedChunks = positiveInteger(maxQueuedChunks, "maxQueuedChunks", { max: 1_024 });
    this.server = net.createServer((client) => this.#accept(client));
    this.addressInfo = null;
    this.blackholeEnabled = false;
    this.stopping = false;
    this.nextPairId = 1;
    this.pairs = new Map();
    this.metrics = {
      acceptedConnections: 0,
      websocketConnections: 0,
      queueOverflowResets: 0,
      blackholeDiscardedClientBytes: 0,
      blackholeDiscardedServerBytes: 0,
    };
  }

  async listen(port = 0) {
    positiveInteger(port, "listenPort", { allowZero: true, max: 65_535 });
    if (this.addressInfo) throw new Error("The TCP fault proxy is already listening.");
    await new Promise((resolve, reject) => {
      const onError = (error) => { this.server.off("listening", onListening); reject(error); };
      const onListening = () => { this.server.off("error", onError); resolve(); };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen({ host: this.listenHost, port, exclusive: true });
    });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("The TCP fault proxy did not bind a TCP port.");
    this.addressInfo = { host: address.address, port: address.port };
    return { ...this.addressInfo };
  }

  blackholeWebSockets() {
    this.blackholeEnabled = true;
    for (const pair of this.pairs.values()) if (pair.isWebSocket) pair.blackholed = true;
  }

  /** Close every old WebSocket pair before allowing a fresh connection. */
  releaseAndReconnect() {
    this.blackholeEnabled = false;
    for (const pair of this.pairs.values()) {
      if (pair.isWebSocket && pair.blackholed) this.#resetPair(pair, "blackhole-released-for-reconnect");
    }
  }

  getSnapshot() {
    const pairs = [...this.pairs.values()].slice(0, MAX_RETAINED_PAIRS).map((pair) => ({
      id: pair.id,
      isWebSocket: pair.isWebSocket,
      blackholed: pair.blackholed,
      resetReason: pair.resetReason,
      clientOpen: !pair.client.destroyed,
      upstreamOpen: !pair.upstream.destroyed,
      upstreamConnected: pair.upstreamConnected,
      clientBytes: pair.clientBytes,
      serverBytes: pair.serverBytes,
      blackholeDiscardedClientBytes: pair.blackholeDiscardedClientBytes,
      blackholeDiscardedServerBytes: pair.blackholeDiscardedServerBytes,
      queuedBytesHighWater: pair.queuedBytesHighWater,
    }));
    return {
      listening: Boolean(this.addressInfo),
      listenHost: this.addressInfo?.host ?? null,
      listenPort: this.addressInfo?.port ?? null,
      blackholeEnabled: this.blackholeEnabled,
      acceptedConnections: this.metrics.acceptedConnections,
      websocketConnections: this.metrics.websocketConnections,
      queueOverflowResets: this.metrics.queueOverflowResets,
      blackholeDiscardedClientBytes: this.metrics.blackholeDiscardedClientBytes,
      blackholeDiscardedServerBytes: this.metrics.blackholeDiscardedServerBytes,
      activeWebSocketPairs: pairs.filter((pair) => pair.isWebSocket && (pair.clientOpen || pair.upstreamOpen)).length,
      pairs,
    };
  }

  async close() {
    if (this.stopping) return;
    this.stopping = true;
    this.blackholeEnabled = false;
    for (const pair of this.pairs.values()) this.#resetPair(pair, "proxy-cleanup");
    if (!this.addressInfo) return;
    await new Promise((resolve) => this.server.close(() => resolve()));
    this.addressInfo = null;
  }

  #accept(client) {
    this.metrics.acceptedConnections += 1;
    client.setNoDelay(true);
    client.pause();
    const upstream = net.createConnection({ host: this.upstreamHost, port: this.upstreamPort });
    upstream.setNoDelay(true);
    const pair = {
      id: this.nextPairId++,
      client,
      upstream,
      upstreamConnected: false,
      isWebSocket: false,
      requestProbe: Buffer.alloc(0),
      blackholed: this.blackholeEnabled,
      resetReason: null,
      clientEnded: false,
      upstreamEnded: false,
      clientBytes: 0,
      serverBytes: 0,
      blackholeDiscardedClientBytes: 0,
      blackholeDiscardedServerBytes: 0,
      queuedBytesHighWater: 0,
      directions: {
        clientToServer: { queue: [], bytes: 0, timer: null, dueAt: 0, source: client, target: upstream },
        serverToClient: { queue: [], bytes: 0, timer: null, dueAt: 0, source: upstream, target: client },
      },
    };
    this.pairs.set(pair.id, pair);
    client.on("data", (chunk) => this.#onData(pair, "clientToServer", chunk));
    upstream.on("data", (chunk) => this.#onData(pair, "serverToClient", chunk));
    client.on("end", () => this.#onEnd(pair, "client"));
    upstream.on("end", () => this.#onEnd(pair, "upstream"));
    client.on("error", () => this.#onSocketError(pair, "client"));
    upstream.on("error", () => this.#onSocketError(pair, "upstream"));
    client.on("close", () => this.#onSocketClose(pair, "client"));
    upstream.on("close", () => this.#onSocketClose(pair, "upstream"));
    upstream.once("connect", () => {
      pair.upstreamConnected = true;
      client.resume();
    });
    if (this.blackholeEnabled && pair.isWebSocket) pair.blackholed = true;
  }

  #classifyRequest(pair, chunk) {
    if (pair.isWebSocket || pair.requestProbe === null) return;
    const remaining = Math.max(0, MAX_INITIAL_REQUEST_BYTES - pair.requestProbe.length);
    if (remaining > 0) pair.requestProbe = Buffer.concat([pair.requestProbe, chunk.subarray(0, remaining)]);
    const headerEnd = pair.requestProbe.indexOf("\r\n");
    if (headerEnd >= 0 || pair.requestProbe.length >= MAX_INITIAL_REQUEST_BYTES) {
      const requestLine = pair.requestProbe.subarray(0, Math.max(0, headerEnd)).toString("latin1");
      pair.isWebSocket = /^GET\s+\/ws(?:\?|\s)/u.test(requestLine);
      pair.requestProbe = null;
      if (pair.isWebSocket) {
        this.metrics.websocketConnections += 1;
        if (this.blackholeEnabled) pair.blackholed = true;
      }
    }
  }

  #onData(pair, directionName, chunk) {
    if (pair.resetReason) return;
    if (directionName === "clientToServer") {
      this.#classifyRequest(pair, chunk);
      pair.clientBytes += chunk.byteLength;
    } else {
      pair.serverBytes += chunk.byteLength;
    }
    if (pair.isWebSocket && this.blackholeEnabled) pair.blackholed = true;
    if (pair.blackholed && pair.isWebSocket) {
      if (directionName === "clientToServer") {
        pair.blackholeDiscardedClientBytes += chunk.byteLength;
        this.metrics.blackholeDiscardedClientBytes += chunk.byteLength;
      } else {
        pair.blackholeDiscardedServerBytes += chunk.byteLength;
        this.metrics.blackholeDiscardedServerBytes += chunk.byteLength;
      }
      return;
    }
    if (this.delayMs === 0 && this.bytesPerSecond === 0) {
      this.#write(pair, pair.directions[directionName], chunk);
      return;
    }
    const direction = pair.directions[directionName];
    direction.queue.push(Buffer.from(chunk));
    direction.bytes += chunk.byteLength;
    pair.queuedBytesHighWater = Math.max(pair.queuedBytesHighWater, direction.bytes);
    if (direction.bytes > this.maxQueuedBytes || direction.queue.length > this.maxQueuedChunks) {
      if (pair.isWebSocket) this.metrics.queueOverflowResets += 1;
      this.#resetPair(pair, "bounded-delay-queue-overflow");
      return;
    }
    this.#pump(pair, direction);
  }

  #pump(pair, direction) {
    if (direction.timer || direction.queue.length === 0 || pair.resetReason) return;
    const now = Date.now();
    const next = direction.queue[0];
    const pacingMs = this.bytesPerSecond > 0 ? Math.ceil(next.byteLength * 1_000 / this.bytesPerSecond) : 0;
    const delay = Math.max(0, direction.dueAt - now) + this.delayMs + pacingMs;
    direction.dueAt = now + delay;
    direction.timer = setTimeout(() => {
      direction.timer = null;
      if (pair.resetReason) return;
      const chunk = direction.queue.shift();
      if (chunk) {
        direction.bytes -= chunk.byteLength;
        this.#write(pair, direction, chunk);
      }
      this.#pump(pair, direction);
    }, delay);
  }

  #write(pair, direction, chunk) {
    if (pair.resetReason || direction.target.destroyed) return;
    const accepted = direction.target.write(chunk);
    if (!accepted) {
      direction.source.pause();
      direction.target.once("drain", () => {
        if (!pair.resetReason && !direction.source.destroyed) direction.source.resume();
      });
    }
  }

  #onEnd(pair, side) {
    if (side === "client") pair.clientEnded = true;
    else pair.upstreamEnded = true;
    if (pair.blackholed && pair.isWebSocket && this.blackholeEnabled) return;
    const direction = side === "client" ? pair.directions.clientToServer : pair.directions.serverToClient;
    const finish = () => {
      if (pair.resetReason) return;
      if (side === "client" && !pair.upstream.destroyed) pair.upstream.end();
      if (side === "upstream" && !pair.client.destroyed) pair.client.end();
    };
    if (direction.queue.length === 0) finish();
    else {
      const poll = () => {
        if (pair.resetReason) return;
        if (direction.queue.length === 0) finish();
        else setTimeout(poll, 5);
      };
      poll();
    }
  }

  #onSocketError(pair, side) {
    if (pair.resetReason) return;
    if (pair.blackholed && pair.isWebSocket && this.blackholeEnabled && side === "upstream") return;
    this.#resetPair(pair, `${side}-socket-error`);
  }

  #onSocketClose(pair, side) {
    if (pair.blackholed && pair.isWebSocket && this.blackholeEnabled && side === "upstream") return;
    if (!pair.resetReason) this.#resetPair(pair, `${side}-socket-closed`);
    if (pair.client.destroyed && pair.upstream.destroyed) {
      for (const direction of Object.values(pair.directions)) if (direction.timer) clearTimeout(direction.timer);
      this.pairs.delete(pair.id);
    }
  }

  #resetPair(pair, reason) {
    if (pair.resetReason) return;
    pair.resetReason = reason;
    for (const direction of Object.values(pair.directions)) {
      if (direction.timer) clearTimeout(direction.timer);
      direction.timer = null;
      direction.queue.length = 0;
      direction.bytes = 0;
    }
    if (!pair.client.destroyed) pair.client.destroy();
    if (!pair.upstream.destroyed) pair.upstream.destroy();
    if (pair.client.destroyed && pair.upstream.destroyed) this.pairs.delete(pair.id);
  }
}
