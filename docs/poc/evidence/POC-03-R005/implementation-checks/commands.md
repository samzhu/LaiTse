# T09 implementation checks

Date: 2026-11-04
Node: 26.13.0 from `.tools/node-v26.13.0-darwin-arm64/bin/node`

| Check | Result |
|---|---|
| `PATH=.tools/node-v26.13.0-darwin-arm64/bin:$PATH npm run typecheck` | Passed (client and server TypeScript) |
| `node --check scripts/host-control-smoke.mjs` | Passed |
| `node --check tests/host-control.integration.test.mjs` | Passed before source handoff |
| Focused integration set (`host-control`, `server`, `space`) | Passed before source handoff: 15 tests, 0 failed |
| Root follow-up build and full Node suite | Passed after source handoff: build completed; 34 tests, 0 failed |
| Root follow-up T09 integration run | Passed after source handoff: 3 tests, 0 failed, including credential separation and host room-switch return denial |

The focused contracts cover token/password separation, startup token bounds, per-connection claim throttling, strict unauthorized host actions, cross-room targeting, publish grants, audio and screen revoke, blocked post-revoke starts and binary frames, live lock and unlock, wrong and correct room-password entry, stale grants after switching, activity end while retaining members, and current-connection removal. The source owner ran the post-handoff build and Node checks; desktop browser acceptance remains with root.

The managed-mode browser smoke is `node scripts/host-control-smoke.mjs`. It expects the server to start with `HOST_CONTROL_TOKEN` set, managed mode enabled, and the meeting room initially unlocked. Supply the same host token via `HOST_CONTROL_TEST_TOKEN`, a distinct dynamic room password via `HOST_CONTROL_TEST_PASSWORD`, `HOST_CONTROL_EXPECT_ENABLED=1`, and `HOST_CONTROL_OUTPUT_DIR` under `.scratch/t09/`. The script uses Node 26, Playwright Firefox, `certutil`, and `.scratch/t01/tls/local-ca.pem`; it removes all credentials from Firefox child environments and checks report output for leaked credential values. Root's runner is prepared with those variables and will perform the runtime flow.
