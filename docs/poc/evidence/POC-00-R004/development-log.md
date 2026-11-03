# T02 implementation handoff

**Date:** 2026-11-03 (Asia/Taipei)  
**Scope:** desktop capability inventory and local HTTPS/LAN certificate preparation. Physical phone testing remains pending.

## Implemented

- Added a browser capability probe in `src/client/capabilities.ts` and a compact panel in `src/client/App.tsx` / `src/client/styles.css`. It records secure-context state, bounded UA/platform, API presence, eight small WebCodecs config probes, MediaRecorder/MSE MIME probes, and `canPlayType` hints. Probe errors and timeouts remain `unknown`. The page does not request media permission, capture, record, decode, or play media.
- Added strict known-field validation in `src/server/capabilities.ts`. A joined socket can submit a bounded 8 KiB capability frame; ordinary room controls remain 1 KiB. The server assigns connection and observation IDs, member, room, and server time; it ACKs only that socket and retains the latest 64 reports in process memory. The lookup route returns the exact stored report. The browser reads the record back and compares it with the submitted report.
- Extended `scripts/setup-local-tls.mjs` with validated `--host <literal-IP>` and `--output-dir <path-under-.scratch>`. Leaf certificates retain localhost SANs and add the selected IP; `--force` recreates that TLS directory and its CA. It writes a DER `local-ca.cer`; it changes no trust store.
- Added `scripts/t02-smoke.mjs` for one Firefox HTTPS/WSS probe, submit, server lookup, ordinary reaction, JSON evidence, and screenshot. It imports the CA only into an isolated run profile and uses no certificate-ignore option.
- Updated `README.md` with desktop steps, future phone CA install/trust/removal guidance, LAN startup instructions, and local no-auth / client-reported-data limits.

## Checks run

- `./.tools/node-v26.13.0-darwin-arm64/bin/npm run typecheck` — passed.
- `./.tools/node-v26.13.0-darwin-arm64/bin/node --test tests/capabilities.integration.test.mjs` — 2 passed. This covers same-socket server correlation and lookup, rejection of invalid bounded schema, no report broadcast, and a regular reaction after a report.
- `node --check` for `scripts/setup-local-tls.mjs` and `scripts/t02-smoke.mjs` — passed.
- Generated isolated TLS files under `.scratch/t02/tls` with test IP `192.0.2.23`, then verified the leaf certificate matches that IP and `localhost` with OpenSSL. This is a reserved documentation/test address, not the host LAN and not a phone check.
- `ipconfig getifaddr en0` did not return an address in this environment (`ipconfig_server_port failed (os/kern) unknown error code (44c)`); no real LAN IP was available here.

## Root desktop handoff

Run from the repository root with Node 26.13.0 and `certutil` available:

```sh
./.tools/node-v26.13.0-darwin-arm64/bin/npm run build
HOST=127.0.0.1 PORT=4173 \
TLS_CERT_FILE=.scratch/t02/tls/localhost-cert.pem \
TLS_KEY_FILE=.scratch/t02/tls/localhost-key.pem \
./.tools/node-v26.13.0-darwin-arm64/bin/npm start
```

In another terminal:

```sh
T02_CA_CERT=.scratch/t02/tls/local-ca.pem \
PLAYWRIGHT_BROWSERS_PATH=/Users/samzhu/workspace_herdr/LaiTse/.tools/playwright-browsers \
./.tools/node-v26.13.0-darwin-arm64/bin/node scripts/t02-smoke.mjs
```

The script writes `.scratch/t02/desktop-smoke/capability-evidence.json` and `capability-report.png`. The current `.scratch/t02/tls` certificate contains `localhost` and only the reserved test IP above; use the developer machine's real LAN IP with `npm run tls:dev -- --host <LAN-IP>` before any future phone attempt.

## Not run / remaining

- The Playwright desktop smoke, full build, existing T01 integration suite, Chrome/Firefox UI acceptance, and physical iOS/Android browser check are for the root acceptance pass; none are claimed complete here.
- No package manifest or lockfile changed. No Git, GitHub, deployment, or system/user trust-store writes were made.
- The observation API has no authentication in this local POC and is intended only for a private development network. Server IDs associate a report with its real socket; codec/API values remain client-reported.

**Writer status:** implementation files and this handoff log are saved and read back. T02 implementation writing is stopped and released to root for build/browser acceptance. Phone evidence remains explicitly untested.
