# T12 smoke authoring handoff

**Status:** saved and read back; authoring checks complete; no server or browser was started.

## Owned resources

- `scripts/control-reconnect-smoke.mjs` — sole writer: T12-SMOKE.
- `.scratch/t12/smoke-authoring/` — sole writer: T12-SMOKE.
- Source, tests, README, authoritative POC and collaboration documents, Git, server, and browser remain outside this handoff.

## What the smoke checks

The script uses isolated Firefox persistent profiles with the local CA imported only into each temporary profile. It checks a managed host, a password-gated participant and optional display, automatic control recovery after a controlled WebSocket close, same participant identity and authoritative room snapshots, reload after switching rooms, current host/grant permissions, a changed room-password revision, explicit leave, interaction event-ID de-duplication across resume, and public queue expiry after more than eight seconds.

The controlled disconnect uses Playwright's test-only WebSocket route close with code 4000 and is recorded as an application-level disconnect. It is not reported as physical network loss or weak-network evidence. The display check compares its initial screen subscription control with the post-resume count; it does not start or inspect media decoding.

The test route retains only bounded, in-memory messages while a reconnect is held, then forwards those messages once after release. Retained JSON summaries use a field whitelist. Tokens, passwords, event IDs, interaction text, storage contents, raw frames, and media payloads are not written to report or console. Test credentials are removed from the Firefox child environment. Temporary Firefox profiles are deleted after contexts close.

## Runner configuration

Required environment:

- `RECONNECT_TEST_HOST_TOKEN` — managed host token, 32–256 UTF-8 bytes.
- `RECONNECT_TEST_ROOM_PASSWORD` — the currently configured studio password, distinct from the host token.

Optional environment:

- `RECONNECT_OUTPUT_DIR` — report and screenshots directory, restricted to `.scratch/t12/` (default `.scratch/t12/acceptance`).
- `RECONNECT_BASE_URL` — trusted HTTPS app origin (default `https://localhost:4173`).
- `RECONNECT_CA_CERT` — local CA PEM path (default `.scratch/t01/tls/local-ca.pem`).
- `CERTUTIL_BIN` — `certutil` executable (default `certutil`).
- `HEADLESS=0` — show Firefox windows.
- `RECONNECT_INCLUDE_DISPLAY=0` — omit the third, optional display Firefox.
- `PLAYWRIGHT_BROWSERS_PATH` — browser install override (default `.tools/playwright-browsers`).

The runner does not start or stop the managed local server. Root owns runtime and browser execution. It writes `control-reconnect-report.json` and the participant reconnecting/recovered screenshots under `RECONNECT_OUTPUT_DIR`.

## Authoring validation

- Pinned Node syntax check: `.tools/node-v26.13.0-darwin-arm64/bin/node --check scripts/control-reconnect-smoke.mjs` — passed.
- Browser/server smoke: not run by T12-SMOKE; root owns it.
- Syntax log: `syntax-check.log`.
