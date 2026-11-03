# T04 implementation handoff

Date: 2026-11-03 (Asia/Taipei)

## Scope delivered

- Added a narrow audio-controller observation getter and a local **下載音訊觀測** button. The downloaded schema includes bounded browser metadata, fixed Opus configuration, current local publisher/receiver generations, snapshot counters, packet gaps and an instantaneous receiver queue estimate.
- Kept the measurement boundaries in the JSON: end-to-end latency is `null`; human listening, physical-device evidence and publisher source identification are not collected. Sent counters are page-lifetime cumulative; receive/decode/render counters span the listening session; packet gaps are scoped to one stream generation and begin after its first accepted sequence. A gap is not an audible interruption measure. Generations are local to the running server process and there is no durable run/session ID.
- Added `scripts/t04-smoke.mjs` for three isolated trusted-HTTPS Firefox processes, one synthetic publisher and two desktop receivers. It exercises late join, one receiver unsubscribe with the server acknowledgement, continued playback at the other receiver, re-subscribe, stream stop, actual JSON downloads, and a panel-only screenshot. Every profile enables Firefox fake media; only the publisher profile simulates microphone permission. The smoke was not run by this implementation agent.
- Added one public WebSocket relay contract case for identical delivery to two subscribed receivers, isolated unsubscribe, and current-generation re-subscribe. Added concise T04 usage and limitation notes to README.

## Checks run

- `PATH="$PWD/.tools/node-v26.13.0-darwin-arm64/bin:$PATH" npm_config_cache="$PWD/.cache/npm" npm run typecheck` — passed.
- `./.tools/node-v26.13.0-darwin-arm64/bin/node --test tests/audio.integration.test.mjs` — passed, 3/3 cases (the two prior cases and the new dual-receiver case).
- `./.tools/node-v26.13.0-darwin-arm64/bin/node --check scripts/t04-smoke.mjs` — passed after the final smoke edits.
- Build, combined integration suite, TLS browser smoke, and screenshot/read-back were not run here; root owns those checks after this handoff. No browser/server process was started by this agent.
- No dependencies or lockfiles changed. README was synchronized with the current behavior and limitations. No docs/evidence run is claimed as executed by this agent.

## Root handoff commands

Run after taking the implementation files:

```sh
PATH="$PWD/.tools/node-v26.13.0-darwin-arm64/bin:$PATH" npm_config_cache="$PWD/.cache/npm" npm run build
./.tools/node-v26.13.0-darwin-arm64/bin/node --test tests/*.test.mjs
```

With the trusted local HTTPS/WSS server running and `certutil` on `PATH`, run the first browser smoke:

```sh
T04_CA_CERT=.scratch/t01/tls/local-ca.pem \
T04_BASE_URL=https://localhost:4173 \
./.tools/node-v26.13.0-darwin-arm64/bin/node scripts/t04-smoke.mjs
```

The smoke writes downloaded observations, `audio-evidence.json`, and `receiver-a-audio-panel.png` under ignored `.scratch/t04/desktop-smoke/`. This desktop synthetic run cannot pass the original phone, real-mic, human-listening, long-duration, repeated-run, cross-device-quality or p95 criteria.
