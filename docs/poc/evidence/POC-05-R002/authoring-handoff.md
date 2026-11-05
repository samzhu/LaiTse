# T17 mixed two-room smoke handoff

Status: saved, read back, syntax-checked, and STOPPED for root review/runtime ownership.

## Scope delivered

- Sole authored repository code file: `scripts/two-room-mixed-smoke.mjs`.
- Authoring snapshot: `.scratch/t17/authoring/two-room-mixed-smoke.mjs` (byte-identical to the runnable script).
- The smoke defines six isolated Firefox profiles: lobby host/watch/interaction-only and locked-studio host/watch/interaction-only. Hosts claim through the normal UI and each create one synthetic Opus and VP8 source. Interaction-only roles switch through the normal UI before either source starts.
- It records allowlisted controls, media-only counters, server self/downlink counters, repeated worklet/render observations, live watch screenshots, and bounded SHA-256 hashes for each binary media message. It stores no media payloads or private interaction payloads. Hash receipts must reconcile per-client/direction frames and bytes, map to the room's publisher subset, and report foreign/unknown/ambiguous counts.
- The studio mode transition checks interaction-mode server/raw-media silence while lobby playback grows, then confirms watch mode does not auto-subscribe before a normal manual receive action resumes fresh configuration and decoded playback. Publisher stop waits for `audio.stopped`/`screen.stopped` acknowledgements and ended tracks before raw-quiet and final hash audit.

## Runtime inputs

- Required: `MIXED_TEST_HOST_TOKEN` (32–256 bytes) and a distinct `MIXED_TEST_ROOM_PASSWORD`.
- Optional: `MIXED_BASE_URL` (default `https://localhost:4173`), `MIXED_CA_CERT` (default `.scratch/t01/tls/local-ca.pem`), `MIXED_OUTPUT_DIR` (default `.scratch/t17/acceptance`, constrained to `.scratch/t17`), `HEADLESS=0`, and `CERTUTIL_BIN`.
- Run with `/Users/samzhu/workspace_herdr/LaiTse/.tools/node-v26.13.0-darwin-arm64/bin/node scripts/two-room-mixed-smoke.mjs`. The managed HTTPS/WSS server is externally started and owned by root; this script does not start a server.

## Checks and stop

- Exact Node version check: `v26.13.0`.
- `node --check` passed for both the runnable file and authoring snapshot; `cmp` confirmed they match.
- SHA-256: see `fingerprints.txt`.
- No smoke runtime, server, or browser was started. No app/source/tests/dependencies/README/docs/existing scripts/Git files were changed. Root owns review, runtime, independent report/hash readback, screenshots, product/documentation updates, cleanup, and commit. No further writes are pending from this author.
