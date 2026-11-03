# T01 development log

Date: 2026-11-03 (Asia/Taipei)

## Environment setup

- Downloaded `node-v26.13.0-darwin-arm64.tar.xz` from `https://nodejs.org/dist/v26.13.0/` and verified it against the matching entry in the official `SHASUMS256.txt`; result: `OK`.
- Used the extracted runtime at `.tools/node-v26.13.0-darwin-arm64`; it reports Node `v26.13.0` and npm `11.20.0`.
- The first npm metadata command using the default user cache failed with `EPERM` because that cache contains root-owned files. No user-level cache files were changed. Subsequent npm commands use `.cache/npm`.
- Exact top-level package pins are recorded in `package.json`; registry query results at implementation time: Fastify 5.12.8, `@fastify/websocket` 11.3.6, `@fastify/static` 10.1.8, React/React DOM 19.3.1, TypeScript 7.0.2, Vite 8.3.5, Playwright 1.64.1, and ws 8.22.1.

## Red-green integration cycle

### Red — before server implementation

Command:

```text
PATH="$PWD/.tools/node-v26.13.0-darwin-arm64/bin:$PATH" npm run test:integration --cache "$PWD/.cache/npm"
```

Result: exit code 1. Node's test runner could not import `src/server/app.ts` (`ERR_MODULE_NOT_FOUND`). The integration contract was present, while the application module did not exist yet.

### Green — after server implementation

Command:

```text
PATH="$PWD/.tools/node-v26.13.0-darwin-arm64/bin:$PATH" npm --cache "$PWD/.cache/npm" run test:integration
```

Result: exit code 0; 6 tests passed, 0 failed. The cases cover the health/room APIs, two real WebSocket clients sharing the same server-assigned membership and sequenced reaction, cross-origin handshake rejection, malformed and oversized frame closes, unknown-room rejection, and the 32-character display-name limit.

## Typecheck and production build

- `npm --cache "$PWD/.cache/npm" run typecheck`: exit code 0 using Node `v26.13.0` and TypeScript `7.0.2`.
- `npm --cache "$PWD/.cache/npm" run build`: exit code 0; typecheck, Vite client build, and server TypeScript output completed. Vite emitted the built client into `dist/client` and `tsc` emitted the server into `dist/server`.
- The Playwright real-browser run is reserved for the T01 acceptance owner after this implementation handoff; its script and TLS setup are in the owned paths and the result is not claimed here.
