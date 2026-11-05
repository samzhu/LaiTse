# T18 smoke authoring handoff

**Scope:** `scripts/process-restart-smoke.mjs` and this authoring folder only. This smoke is a bounded local operational-rebuild probe. It does not introduce persistence or declare runtime data loss acceptable.

## Runner behavior

- Requires Node `v26.13.0` when executed, three distinct in-memory values (`RESTART_TEST_HOST_TOKEN`, `RESTART_TEST_ROOM_PASSWORD`, `RESTART_TEST_LIVE_PASSWORD`), a trusted local CA, and local TLS certificate/key files. Defaults are `https://localhost:4173`, `.scratch/t01/tls/local-ca.pem`, `.scratch/t01/tls/localhost-cert.pem`, and `.scratch/t01/tls/localhost-key.pem`.
- Refuses an occupied local port. It starts two sequential `dist/server/index.js` children with the same startup token/password/TLS/host/port configuration; it signals only those child handles. A stop records PID, timestamps, exact signal mode, and exit result. SIGKILL is a bounded fallback after SIGTERM.
- Keeps three isolated Firefox profiles open across the actual process stop/start, imports the local CA only into those profiles, removes test credentials from browser environments, and does not change system trust or autoplay policy.
- Uses normal UI join, host claim, publisher grant/revoke, live password change to B, watch subscription, synthetic audio/video, and one feedback event. It does not submit or retain chat text.
- On restart, requires the old browser proofs to receive `resume_invalid`, the expired-session UI state, and no automatic join/claim/publish/subscribe. Manual UI rejoin records fresh IDs, confirms B is rejected while startup password A works, and requires a fresh host claim and manually started sources before the watch renders new clock IDs.
- A separate WSS probe records forged-host-role rejection and server-side audio/screen publish denial for a normal participant. No restart or state-management API is added.
- Report `status: passed` means only the operational process-stop/rejoin observations passed. The report keeps `dynamicRestoration: not-restored`, `productConclusion: NO_GO_DURABILITY_UNRESOLVED`, and `fullT18Pass: false`; it does not claim durable recovery or accept data loss.
- Output is isolated in `.scratch/t18/acceptance/run-<run-id>/`. Reports contain allowlisted IDs, counters, error codes, and media-render evidence; no credentials, resume values, chat text, or raw media. Firefox profiles are removed during cleanup. Root owns runtime execution and evidence review.

## Authoring verification and handoff

- `node --check scripts/process-restart-smoke.mjs` passed with the available Node `v26.1.0` parser. The runner itself refuses execution unless `process.version === v26.13.0`.
- No production build, tests, application server, browser, or runtime smoke was run by this writer. Root owns those checks and all runtime resources.
- SHA-256: `41e8eeaca110ea99059182acd11a6c9bc563c9738f28e79a9ba06c61070d0ff3`.
- The saved authoring copy was read back and has the same SHA-256 as the runner.

The runner is saved and handed to root for narrow readback, exact-runtime validation, and the separately owned runtime phase. This writer has stopped and released both scoped paths.
