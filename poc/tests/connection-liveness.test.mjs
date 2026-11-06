import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { createConnectionLiveness } from "../src/server/connection-liveness.ts";

class FakeSocket extends EventEmitter {
  OPEN = 1;
  CLOSED = 3;
  readyState = this.OPEN;
  pings = 0;
  terminations = 0;

  ping() {
    this.pings += 1;
  }

  terminate() {
    this.terminations += 1;
    this.readyState = this.CLOSED;
  }
}

test("one deterministic app timer pings connections, accepts pong, and expires only the silent socket", () => {
  let timestamp = 0;
  let tick;
  let timerDelay;
  let timerCleared = false;
  let unrefCalled = false;
  let intervalCount = 0;
  const liveness = createConnectionLiveness({
    pingIntervalMs: 1_000,
    pongTimeoutMs: 2_000,
    now: () => timestamp,
    setInterval(callback, delay) {
      intervalCount += 1;
      tick = callback;
      timerDelay = delay;
      return { unref() { unrefCalled = true; } };
    },
    clearInterval() {
      timerCleared = true;
    },
  });
  const healthy = new FakeSocket();
  const silent = new FakeSocket();

  liveness.add(healthy);
  liveness.add(silent);
  assert.equal(intervalCount, 1, "all sockets share one timer");
  assert.equal(timerDelay, 1_000);
  assert.equal(unrefCalled, true);
  assert.equal(liveness.size, 2);

  timestamp = 1_000;
  tick();
  assert.equal(healthy.pings, 1);
  assert.equal(silent.pings, 1);

  healthy.emit("pong");
  timestamp = 2_000;
  tick();
  assert.equal(healthy.pings, 2, "a valid pong permits the next heartbeat");
  assert.equal(silent.terminations, 0);

  timestamp = 2_999;
  tick();
  assert.equal(silent.terminations, 0, "timeout is not early");
  timestamp = 3_000;
  tick();
  assert.equal(silent.terminations, 1, "the socket is terminated at its pong deadline");
  assert.equal(healthy.terminations, 0, "a healthy connection stays open");
  assert.equal(liveness.size, 1);

  liveness.remove(healthy);
  assert.equal(healthy.listenerCount("pong"), 0);
  assert.equal(liveness.size, 0);
  liveness.dispose();
  assert.equal(timerCleared, true);
  timestamp = 10_000;
  tick();
  assert.equal(intervalCount, 1);
  assert.equal(healthy.pings, 2);
});

test("the liveness timer validates finite positive deadlines", () => {
  assert.throws(() => createConnectionLiveness({ pingIntervalMs: 0 }), /positive finite number/u);
  assert.throws(() => createConnectionLiveness({ pongTimeoutMs: Number.NaN }), /positive finite number/u);
  assert.throws(() => createConnectionLiveness({ pingIntervalMs: 10, pongTimeoutMs: 9 }), /greater than or equal/u);
});
