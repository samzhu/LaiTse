import { readFileSync } from "node:fs";
import { createApp } from "./app.ts";
import { isLoopbackHost } from "./capacity.ts";

function readTlsOptions() {
  const certPath = process.env.TLS_CERT_FILE;
  const keyPath = process.env.TLS_KEY_FILE;
  if (!certPath && !keyPath) return undefined;
  if (!certPath || !keyPath) {
    throw new Error("Set both TLS_CERT_FILE and TLS_KEY_FILE, or leave both unset.");
  }

  return {
    cert: readFileSync(certPath),
    key: readFileSync(keyPath),
  };
}

const port = Number(process.env.PORT ?? "4173");
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  throw new Error("PORT must be an integer between 0 and 65535.");
}

const meetingRoomPassword = process.env.MEETING_ROOM_PASSWORD ?? "";
const hostControlToken = process.env.HOST_CONTROL_TOKEN ?? "";
const host = process.env.HOST ?? "127.0.0.1";
const localCapacityAdmin = process.env.LOCAL_CAPACITY_ADMIN === "1";
if (localCapacityAdmin && !isLoopbackHost(host)) {
  throw new Error("LOCAL_CAPACITY_ADMIN=1 requires HOST to be a loopback address.");
}
const app = await createApp({
  https: readTlsOptions(),
  meetingRoomPassword,
  hostControlToken,
  databaseUrl: process.env.DATABASE_URL,
  localCapacityAdmin,
});
const address = await app.listen({
  host,
  port,
});

const url = new URL(address);
console.log(`LaiTse local POC listening at ${url.origin}`);
console.log(`System information persistence is ${process.env.DATABASE_URL ? "PostgreSQL" : "process-memory"}.`);
console.log(`Meeting room startup seed is ${meetingRoomPassword ? "locked" : "unlocked"}; saved PostgreSQL settings take precedence when present.`);
console.log(`Host controls are ${hostControlToken ? "enabled" : "disabled"} by startup configuration.`);
console.log(`Local capacity administration is ${localCapacityAdmin ? "enabled at /poc/capacity" : "disabled"}.`);

const stop = async () => {
  await app.close();
};

process.once("SIGINT", () => void stop().then(() => process.exit(0)));
process.once("SIGTERM", () => void stop().then(() => process.exit(0)));
