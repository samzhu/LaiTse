import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import vm from "node:vm";
import { createApp } from "../src/server/app.ts";
import {
  DEFAULT_MEMBER_SOFT_LIMIT,
  LOCAL_CAPACITY_ADMIN_HTML,
  MAX_MEMBER_SOFT_LIMIT,
  MIN_MEMBER_SOFT_LIMIT,
  isLoopbackAddress,
  isLoopbackHost,
  parseMemberSoftLimit,
} from "../src/server/capacity.ts";

let app;

before(async () => {
  app = await createApp({ serveClient: false, localCapacityAdmin: true });
});

after(async () => {
  await app?.close();
});

function inject(options) {
  return app.inject({ headers: { host: "127.0.0.1" }, ...options });
}

async function getCapacity(headers = {}, remoteAddress = "127.0.0.1") {
  return inject({ method: "GET", url: "/api/poc/capacity", headers: { host: "127.0.0.1", ...headers }, remoteAddress });
}

async function postCapacity(body, { headers = {}, remoteAddress = "127.0.0.1" } = {}) {
  return inject({
    method: "POST",
    url: "/api/poc/capacity",
    headers: { host: "127.0.0.1", origin: "http://127.0.0.1", "content-type": "application/json", ...headers },
    payload: body,
    remoteAddress,
  });
}

test("capacity setting bounds and loopback address checks are explicit", () => {
  assert.equal(DEFAULT_MEMBER_SOFT_LIMIT, 10);
  assert.equal(MIN_MEMBER_SOFT_LIMIT, 1);
  assert.equal(MAX_MEMBER_SOFT_LIMIT, 1_000);
  assert.equal(parseMemberSoftLimit(1), 1);
  assert.equal(parseMemberSoftLimit(1_000), 1_000);
  for (const value of [0, 1_001, 1.5, "10", null, {}, true]) assert.equal(parseMemberSoftLimit(value), null);
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("203.0.113.4"), false);
  assert.equal(isLoopbackHost("localhost:4173"), true);
  assert.equal(isLoopbackHost("[::1]:4173"), true);
  assert.equal(isLoopbackHost("example.test"), false);
});

test("local page and GET report capacity without changing it", async () => {
  const page = await inject({ method: "GET", url: "/poc/capacity" });
  assert.equal(page.statusCode, 200);
  assert.match(page.headers["content-type"], /text\/html/u);
  assert.match(page.body, /data-testid="capacity-limit"/u);
  assert.match(page.body, /data-testid="capacity-save"/u);
  assert.match(page.body, /data-testid="capacity-current-members"/u);
  assert.match(page.body, /data-testid="capacity-limit-output"/u);
  assert.match(page.body, /data-testid="capacity-save-status"/u);
  const pageScript = LOCAL_CAPACITY_ADMIN_HTML.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
  assert.ok(pageScript);
  assert.doesNotThrow(() => new vm.Script(pageScript));

  const response = await getCapacity();
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    softLimit: 10,
    currentMembers: 0,
    persistence: "process-memory",
    persisted: false,
  });
});

test("local JSON updates are bounded, same-origin, and report memory mode as non-durable", async () => {
  const updated = await postCapacity({ softLimit: 12 });
  assert.equal(updated.statusCode, 200);
  assert.deepEqual(updated.json(), {
    softLimit: 12,
    currentMembers: 0,
    persistence: "process-memory",
    persisted: false,
  });
  assert.equal((await getCapacity()).json().softLimit, 12);

  const invalid = await postCapacity({ softLimit: 1_001 });
  assert.equal(invalid.statusCode, 400);
  assert.equal((await getCapacity()).json().softLimit, 12);

  const extraField = await postCapacity({ softLimit: 20, force: true });
  assert.equal(extraField.statusCode, 400);
  assert.equal((await getCapacity()).json().softLimit, 12);

  const wrongContentType = await postCapacity("{\"softLimit\":20}", {
    headers: { "content-type": "text/plain" },
  });
  assert.equal(wrongContentType.statusCode, 415);
  assert.equal((await getCapacity()).json().softLimit, 12);
});

test("local capacity routes reject spoofed or non-loopback requests and cross-origin writes", async () => {
  const spoofed = await getCapacity({ "x-forwarded-for": "127.0.0.1" }, "203.0.113.4");
  assert.equal(spoofed.statusCode, 403);

  const nonLoopbackHost = await inject({
    method: "GET",
    url: "/api/poc/capacity",
    headers: { host: "example.test", "x-forwarded-for": "127.0.0.1" },
    remoteAddress: "127.0.0.1",
  });
  assert.equal(nonLoopbackHost.statusCode, 403);

  const crossOrigin = await postCapacity({ softLimit: 20 }, { headers: { origin: "https://attacker.example" } });
  assert.equal(crossOrigin.statusCode, 403);
  assert.equal((await getCapacity()).json().softLimit, 12);
});

test("capacity routes stay absent unless createApp explicitly enables the local option", async () => {
  const disabledApp = await createApp({ serveClient: false });
  try {
    const response = await disabledApp.inject({
      method: "GET",
      url: "/api/poc/capacity",
      headers: { host: "127.0.0.1" },
      remoteAddress: "127.0.0.1",
    });
    assert.equal(response.statusCode, 404);
  } finally {
    await disabledApp.close();
  }
});
