import { readFileSync } from "node:fs";
import { createApp } from "./app.ts";

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

const app = await createApp({ https: readTlsOptions() });
const address = await app.listen({
  host: process.env.HOST ?? "127.0.0.1",
  port,
});

const url = new URL(address);
console.log(`LaiTse local POC listening at ${url.origin}`);
console.log("Room state and control events are held in process memory only.");

const stop = async () => {
  await app.close();
};

process.once("SIGINT", () => void stop().then(() => process.exit(0)));
process.once("SIGTERM", () => void stop().then(() => process.exit(0)));
