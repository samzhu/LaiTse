# PG-BROWSER authoring handoff

## Scope and ownership

- Sole writer: `scripts/database-restart-browser.mjs` and this authoring directory.
- All application/source files, existing scripts, docs, package manifests and Git were read-only.
- No application, Docker, PostgreSQL, browser, or child-server runtime was started by this author.
- Root owns runtime acceptance, report/evidence and any documentation changes after this handoff.

## Harness design

The script starts two isolated Firefox persistent profiles with the repository local CA imported only into each profile. Both pages join the locked studio through the normal startup-A prompt. The host claims through the normal UI, the guest sends one synthetic chat and one feedback action, then the host changes the live gate to B. It keeps the same two pages and browser contexts open while SIGTERM stops only the script-owned `dist/server/index.js` child. A second child starts on the same local HTTPS port with the identical startup-A configuration and the same database URL in its environment.

For each page the existing browser session first resumes without a password, receives `room_password_required`, and retries through the normal room-password dialog with B. The script requires the same server-issued participant ID on `session.resumed`, fresh same-socket room/participation/interaction state, the same chat interaction ID in the visible DOM, and the previous feedback count inside its short TTL. It confirms no automatic anonymous join, host claim, media start or subscription, then requires a manual host reclaim and pause/unpause action round-trip. Two independent raw WSS normal-join probes require startup A to fail and live B to enter. No database administration endpoint is used.

Controls are reduced to bounded allowlisted fields per WebSocket connection and server PID. Password/token values and database URL are not captured. Chat payload text is not retained; report includes the client event ID and server interaction ID only. Screenshots mask the chat-copy node and assert password inputs are blank. Firefox environment is stripped of `PG_BROWSER_*`, `RESTART_TEST_*`, database URL, host-token and TLS-secret variables. The script includes no media capture setup or quality scope.

## Invocation contract for root

- Run with `/Users/samzhu/workspace_herdr/LaiTse/.tools/node-v26.13.0-darwin-arm64/bin/node` v26.13.0 after PostgreSQL integration has built `dist/server/index.js`.
- Set `PG_BROWSER_DATABASE_URL` or `DATABASE_URL`, `PG_BROWSER_HOST_TOKEN` (32–256 bytes), `PG_BROWSER_STARTUP_PASSWORD` (A), and distinct `PG_BROWSER_LIVE_PASSWORD` (B). Credentials are environment-only and child CLI arguments contain no database URL.
- TLS inputs default to `.scratch/t01/tls/local-ca.pem`, `.scratch/t01/tls/localhost-cert.pem`, and `.scratch/t01/tls/localhost-key.pem`; `CERTUTIL_BIN` defaults to `certutil`.
- Default base URL is `https://localhost:4173`; an already occupied local port causes refusal. Output is constrained to `.scratch/postgres/acceptance` by default.
- The readiness contract is strict: `/api/health` must return `persistence: "postgresql"`, and `/api/rooms` must retain fixed `lobby`/`studio` catalog with managed locked studio. No runtime result is claimed by this authoring handoff.

## Evidence limits

A passing run means this small PostgreSQL-backed persistence slice and owned-process restart behavior passed. `fullPOCPass` and `productReady` always remain false. No media, phone, human quality, weak network, scale, endurance, Cloud Run, deployment, or complete POC-06 result is covered. The optional movement position case is not exercised.
