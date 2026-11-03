# LaiTse local POC baseline

This is the T01 local baseline. One Fastify process serves the built React page, the health and room APIs, and a WebSocket endpoint. The room flow is deliberately small: two participants can join one local room and observe the same member list and bounded control events.

This is an experiment, not the product or the MVP. It creates no cloud resources and uses no external service. Its state is volatile process memory.

## Runtime and exact dependencies

The project pins Node.js `26.13.0` in `.nvmrc` and `package.json`. On the current Apple Silicon macOS host, the official Node archive is stored under ignored `.tools/` and verified against the matching line in Node's official `SHASUMS256.txt`. No global Node or nvm configuration is changed.

For a fresh local setup, download the official archive and checksum file, verify the archive, and extract it into the ignored tool directory:

```sh
mkdir -p .tools/downloads .tools .cache/npm
curl --fail --location https://nodejs.org/dist/v26.13.0/SHASUMS256.txt --output .tools/downloads/SHASUMS256-v26.13.0.txt
curl --fail --location https://nodejs.org/dist/v26.13.0/node-v26.13.0-darwin-arm64.tar.xz --output .tools/downloads/node-v26.13.0-darwin-arm64.tar.xz
(cd .tools/downloads && grep 'node-v26.13.0-darwin-arm64.tar.xz$' SHASUMS256-v26.13.0.txt | shasum -a 256 -c -)
tar -xJf .tools/downloads/node-v26.13.0-darwin-arm64.tar.xz -C .tools
export PATH="$PWD/.tools/node-v26.13.0-darwin-arm64/bin:$PATH"
node --version
npm --version
npm ci --cache "$PWD/.cache/npm"
```

The implementation environment is macOS arm64. On another operating system or CPU architecture, use the matching archive name and verify its entry in the same official checksum file. The package lock keeps direct and transitive package versions, registry URLs, and integrity hashes fixed. `npm run licenses` writes an ignored inventory with the installed package versions and package-declared licenses to `.scratch/t01/dependency-inventory.json`.

Direct runtime packages are `fastify@5.12.8`, `@fastify/websocket@11.3.6`, `@fastify/static@10.1.8`, `react@19.3.1`, and `react-dom@19.3.1`. The client build, type checking, integration harness, and Playwright browser script use pinned development packages in `package.json`. Project metadata declares Apache-2.0 to match the existing `LICENSE` file.

## Build and run

With the pinned Node runtime on `PATH`:

```sh
npm run typecheck
npm run test:integration
npm run build
npm start
```

By default the app listens on `http://127.0.0.1:4173`. It serves the built page at `/`, a health response at `/api/health`, the fixed room catalogue at `/api/rooms`, and the control WebSocket at `/ws`. `HOST` and `PORT` can change the listen address. The default binds only to loopback.

To use local HTTPS and WSS, create an isolated development CA and localhost certificate, then start the same application with both certificate paths:

```sh
npm run tls:dev
TLS_CERT_FILE=.scratch/t01/tls/localhost-cert.pem \
TLS_KEY_FILE=.scratch/t01/tls/localhost-key.pem \
npm start
```

The generated certificate covers `localhost`, `127.0.0.1`, and `::1`. The CA and private keys stay in ignored `.scratch/t01/tls/`; setup does not change a macOS or browser-wide trust store. HTTP mode is provided for quick local development. HTTPS/WSS is used for browser evidence.

## Browser evidence

Install Playwright's Firefox build into the ignored tool directory, with NSS `certutil` available on `PATH`:

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/.tools/playwright-browsers" npm exec -- playwright install firefox
```

Keep the HTTPS server running, then run:

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/.tools/playwright-browsers" \
E2E_OUTPUT_DIR=.scratch/t01/e2e-run \
npm run test:e2e
```

The script launches two independent Firefox processes with isolated temporary profiles. Each Firefox child also receives private `MOZ_APP_DATA` and `MOZ_LOCAL_APP_DATA` directories under its run output; `$HOME`, existing Firefox data, and system settings are unchanged. This follows the workaround in [Mozilla Bug 2069536](https://bugzilla.mozilla.org/show_bug.cgi?id=2069536) for bare-executable launches on macOS 27. It imports the local CA only into those two per-run NSS databases, uses ordinary certificate verification, and fails if HTTPS is not trusted. It does not use `ignoreHTTPSErrors` or certificate-ignore browser flags. It records Node/npm, macOS, Firefox, API status, both clients' observed member/event state, and two screenshots under the chosen `.scratch/t01/` output directory. Set `HEADLESS=0` to show the two windows while the run executes. This is two-client local evidence, not a browser compatibility or mobile-device result.

## Control protocol and bounds

The server accepts one fixed room, `lobby` (`Local test room`). A client must join with a display name of 1–32 printable characters. The room is limited to eight connected members. After joining, the only accepted control is a `wave`, `clap`, or `heart` reaction. The server assigns a process-wide sequence number to join, leave, and reaction events and broadcasts them to current room members.

WebSocket connections must have an Origin matching the request's scheme and host. Binary, malformed, unknown, or invalid control frames close the connection. Frames are limited to 1 KiB, accepted reactions to 10 per connection per second, and slow receivers are closed once queued output exceeds 64 KiB. The page keeps only the most recent 20 events for display.

## Data classification and limitations

- **Fixed, versioned setup:** the one-room catalogue and its display name are source constants in `src/server/app.ts`; a build from the same source reconstructs them.
- **Execution-time data:** current members, connection membership, and the event sequence exist in server process memory. A disconnect removes only that participant. The sequence resets when the server process stops or is replaced. The visible recent-event list exists only in page memory and clears when that page reloads or the participant explicitly leaves or joins again.
- **Not durable:** there is no database, file persistence, identity system, authorization/role model, event history, or cross-process coordination. A future multi-instance Cloud Run deployment would give instances separate memory and can lose all current state on replacement. This local result does not establish a persistence or Cloud Run recovery design.
- **Not implemented in this ticket:** audio, screen sharing, avatar movement, authentication, room management, capacity, and mobile browser behavior.

## Focused commands

```sh
npm run typecheck
npm run test:integration
npm run build
npm run licenses
```

The focused integration suite exercises the API and real WebSocket connections from Node clients, including room membership, shared sequenced events, invalid origins, invalid messages, and payload bounds. The Playwright script separately uses actual Firefox browser processes for the two-client page flow. It does not replace later real-device media or capacity experiments.

## Recorded verification

[POC-00-R001](docs/poc/evidence/POC-00-R001/README.md) preserves the original Firefox launch failure. R002 records the final two-browser acceptance with private application-data directories; the authoritative status and remaining stage requirements are in [the execution log](docs/poc/execution-log.md). On macOS an automation sandbox may prevent Firefox from launching; run the test from a normal local terminal. Do not substitute certificate-ignore flags. Runtime dependencies remain stable releases; the diagnostic prerelease browser was rejected and is unused.
