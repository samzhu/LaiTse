# T16 smoke authoring handoff

Status: saved, read back, and STOPPED for root review/runtime ownership.

## Scope delivered

- Sole authored code file: `scripts/single-room-fanout-smoke.mjs`.
- This handoff and fingerprint are under `.scratch/t16/authoring/` only.
- The script uses one externally running locked managed `studio` room, one host-claiming publisher, and three additional actual Firefox receivers. It samples one receiver first, then all three, verifies A unsubscribe isolation while B/C continue, and normally stops both publisher sources.
- It keeps only bounded allowlisted control summaries, binary byte/frame counters, selected server self/downlink/transport counters, local render/queue snapshots, stage timestamps, and live receiver screenshots. It stores no raw media, raw control payload, credential value, or browser storage.

## Syntax evidence

`/Users/samzhu/workspace_herdr/LaiTse/.tools/node-v26.13.0-darwin-arm64/bin/node --version` returned `v26.13.0`.

`/Users/samzhu/workspace_herdr/LaiTse/.tools/node-v26.13.0-darwin-arm64/bin/node --check scripts/single-room-fanout-smoke.mjs` completed successfully.

Script SHA-256 at handoff: `d92c8fe9a1279e685fc9d426496ee38248caf304b50a5fa915332361143d1bf0`.

## Runtime inputs

- Required environment: `FANOUT_TEST_HOST_TOKEN`, `FANOUT_TEST_ROOM_PASSWORD`.
- Optional environment: `FANOUT_BASE_URL` (default `https://localhost:4173`), `FANOUT_CA_CERT` (default `.scratch/t01/tls/local-ca.pem`), `FANOUT_OUTPUT_DIR` (default `.scratch/t16/acceptance`), `HEADLESS` (set `0` for visible Firefox), and `CERTUTIL_BIN`.
- Run with the pinned Node binary above. The managed HTTPS/WSS server is expected to be started and configured externally by root; the script does not start a server or browser in this authoring turn.

## Limits and stop

Only exact-version Node syntax validation was run here. The smoke was not executed; browser, server, source, build, tests, documentation, README, manifests, and Git were not changed. Root owns the next script review, runtime run, evidence readback, documentation updates, cleanup, and commit. The binary byte counters exclude text/control bytes; a quiet window permits benign control changes while requiring media counters to remain stable. No further writes are pending from this writer.
