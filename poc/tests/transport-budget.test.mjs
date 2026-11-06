import assert from "node:assert/strict";
import { test } from "node:test";
import { createTransportBudget, MAX_APPLICATION_SEND_BYTES, MAX_PENDING_CALLBACK_AGE_MS } from "../src/server/transport-budget.ts";

class FakeSocket {
  OPEN = 1;
  readyState = this.OPEN;
  bufferedAmount = 0;
  callbacks = [];
  sent = [];
  closes = [];
  terminated = false;

  send(payload, optionsOrCallback, maybeCallback) {
    const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback;
    this.sent.push({ payload, options: typeof optionsOrCallback === "function" ? undefined : optionsOrCallback });
    if (callback) this.callbacks.push(callback);
  }

  close(code, reason) {
    this.closes.push({ code, reason });
    this.readyState = 2;
  }

  terminate() {
    this.terminated = true;
    this.readyState = 3;
  }
}

function fakeClock() {
  let now = 0;
  const timers = new Set();
  return {
    now: () => now,
    schedule(callback, delayMs) {
      const timer = { callback, dueAt: now + delayMs, cancelled: false, unref() {} };
      timers.add(timer);
      return timer;
    },
    cancel(timer) {
      timer.cancelled = true;
      timers.delete(timer);
    },
    advance(milliseconds, runTimers = true) {
      now += milliseconds;
      if (!runTimers) return;
      let next;
      while ((next = [...timers].find((timer) => !timer.cancelled && timer.dueAt <= now))) {
        timers.delete(next);
        next.callback();
      }
    },
  };
}

function createBudget(socket, clock) {
  return createTransportBudget(socket, {
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
}

test("one socket shares pending byte accounting across control and media writes", () => {
  const socket = new FakeSocket();
  const clock = fakeClock();
  const budget = createBudget(socket, clock);
  assert.equal(budget.send("control"), true);
  assert.equal(budget.send(Buffer.alloc(12), { binary: true, compress: false }), true);
  assert.equal(budget.snapshot().pendingCallbackCount, 2);
  assert.equal(budget.snapshot().pendingCallbackBytes, Buffer.byteLength("control") + 12);
  assert.equal(budget.snapshot().pendingCallbackHighWaterCount, 2);
  assert.equal(socket.sent[1].options.binary, true);
  assert.equal(budget.snapshot().maxPendingBytes, MAX_APPLICATION_SEND_BYTES);
  assert.equal(budget.snapshot().maxPendingCallbackAgeMs, MAX_PENDING_CALLBACK_AGE_MS);
});

test("snapshot reports injected budget limits for deterministic seam use", () => {
  const socket = new FakeSocket();
  const clock = fakeClock();
  const budget = createTransportBudget(socket, {
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    maxBytes: 32,
    maxCallbackAgeMs: 17,
  });
  assert.equal(budget.snapshot().maxPendingBytes, 32);
  assert.equal(budget.snapshot().maxPendingCallbackAgeMs, 17);
});

test("pending callback bytes enforce the shared 1.5 MiB socket cap even if bufferedAmount stays zero", () => {
  const socket = new FakeSocket();
  const clock = fakeClock();
  const budget = createBudget(socket, clock);
  assert.equal(budget.send(Buffer.alloc(MAX_APPLICATION_SEND_BYTES - 8), { binary: true, compress: false }), true);
  assert.equal(budget.send("123456789"), false);
  assert.deepEqual(socket.closes, [{ code: 1013, reason: "Receiver send queue exceeded limit" }]);
  assert.equal(budget.snapshot().closeReason, "buffered_bytes");
});

test("a callback pending beyond one second closes only its slow socket", () => {
  const clock = fakeClock();
  const slowSocket = new FakeSocket();
  const healthySocket = new FakeSocket();
  const slow = createBudget(slowSocket, clock);
  const healthy = createBudget(healthySocket, clock);
  assert.equal(slow.send(Buffer.alloc(96), { binary: true, compress: false }), true);
  assert.equal(healthy.send("control acknowledgement"), true);
  healthySocket.callbacks[0]();
  clock.advance(MAX_PENDING_CALLBACK_AGE_MS);
  assert.deepEqual(slowSocket.closes, [{ code: 1013, reason: "Receiver send callback timed out" }]);
  assert.equal(slow.snapshot().closeReason, "pending_callback_age");
  assert.equal(healthySocket.closes.length, 0);
  assert.equal(healthySocket.readyState, healthySocket.OPEN);
  assert.equal(healthy.send("still healthy"), true);
});

test("a callback delivered after the age limit still records a per-socket close", () => {
  const socket = new FakeSocket();
  const clock = fakeClock();
  const budget = createBudget(socket, clock);
  assert.equal(budget.send("held"), true);
  clock.advance(MAX_PENDING_CALLBACK_AGE_MS + 1, false);
  socket.callbacks[0]();
  assert.equal(budget.snapshot().closeReason, "pending_callback_age");
  assert.equal(socket.closes[0]?.code, 1013);
});
