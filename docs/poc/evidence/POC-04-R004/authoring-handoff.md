# T15 smoke authoring handoff

Date: 2026-11-05
Baseline: eb58084
Writer: T15-SMOKE / Luna xhigh

## Resource state

- scripts/integrated-session-smoke.mjs: saved, read back, syntax checked with the pinned Node v26.13.0 binary, then STOP. Runtime/browser ownership is released to root.
- .scratch/t15/authoring/handoff.md: saved, read back, then STOP. This note is limited to authoring and handoff evidence.
- SHA-256 fingerprints for both resources are saved in .scratch/t15/authoring/fingerprints.sha256.
- No source, existing script, manifest, lockfile, README, authority document, runtime, browser, or Git resource was changed by this writer.

## Harness behavior

The standalone script expects the managed local HTTPS/WSS application to be running already. It creates four isolated Firefox profiles for studio host/receiver, studio participant publisher, lobby host/publisher, and lobby receiver. It enters through /?room=studio or /?room=lobby. Studio joins answer the existing Meeting room password prompt; host actions use the existing host panel. Both publishers use an injected oscillator and animated canvas source. AudioWorklet samples, received/decoded counters, decoded canvas color, Opus/VP8 configs, and source clock IDs are checked in both rooms. The clock comparison is a room-separation signal; the harness does not perform a raw media hash audit.

After both rooms render, the studio host receiver gets a local one-second application-driver deadline. At that deadline the harness closes both test-only WebSocketRoute endpoints with code 4003 and records scheduled and actual timestamps. It does not add an application fault API or claim a server timeout, Cloud Run timeout, TCP shaping, packet loss, or real background transition. The new connection must send session.resume, receive session.resumed plus fresh room.snapshot and participation.self authority, and only then restore explicit audio/screen subscriptions. The harness checks subscribe acknowledgements, fresh Opus/VP8 configs, publisher keyframe request, fresh binary counters, and actual AudioWorklet/canvas rendering. It verifies that the old host claim did not return, then reclaims host through the regular UI.

The studio host revokes the publisher through the regular host UI. The harness checks audio.streamEnded and screen.streamEnded, ended source tracks, no additional publisher or receiver binary frames after a 900 ms bounded drain, stable receiver packet counters, silence, and a cleared screen. It then closes both endpoints of the revoked publisher route with code 4003 and checks the latest resume authority is publishAllowed=false, with no automatic host claim, audio.start, screen.start, binary publication, or new synthetic capture requests. The lobby receiver is sampled every 400 ms throughout the studio fault and revocation path; AudioWorklet samples, VP8 frames and media packet counts must advance at every consecutive sample. A feedback interaction ACK is required during the local timeout/recovery interval and again after studio media recovery.

An optional INTEGRATED_HOLD_SECONDS accepts real elapsed active-room time from 0 through 4200 seconds; default 0 keeps the run lightweight. It records real start/end times and room media counters no farther apart than 30 seconds. It does not accelerate time or turn a short run into a 65-minute result.

## Evidence and extraction limits

The generated output directory defaults to .scratch/t15/acceptance and is configurable only within .scratch/t15. A successful or failed run attempts to retain report.json, a short README.md, and at least two final Firefox screenshots named studio-host-final.png and lobby-receiver-final.png. The report has real timestamps, selected whitelisted control summaries, route byte/frame counters, bounded repeated media observations, source clock IDs, and failure/cleanup status.

The script never writes control or media payloads, packet hashes, display names, screenshots of credentials, browser storage, host tokens, room passwords, or resume token values. Control parsing retains only allowlisted fields and credential-presence booleans; secret values remain in process memory for redaction and are removed from Firefox child-process environment. CA trust is installed only in disposable isolated Firefox profiles, and those profiles are removed during cleanup. System trust is not changed.

Evidence caps fail the run: 8 connections per client, 240 summarized controls per connection, 32 stages, 64 continuous lobby samples, 160 optional-hold samples, and 20 error records. The continuous lobby samples must advance AudioWorklet samples, rendered video frames, and both receive packet counters on every consecutive observation.

## How root can run it

Set INTEGRATED_TEST_HOST_TOKEN, INTEGRATED_TEST_ROOM_PASSWORD, INTEGRATED_BASE_URL, INTEGRATED_CA_CERT, and optionally INTEGRATED_OUTPUT_DIR and INTEGRATED_HOLD_SECONDS in the shell environment. Then use the pinned binary:

    /Users/samzhu/workspace_herdr/LaiTse/.tools/node-v26.13.0-darwin-arm64/bin/node scripts/integrated-session-smoke.mjs

Do not put credential values in shell history, command transcripts, notes, or reports. Expected defaults are https://localhost:4173, .scratch/t01/tls/local-ca.pem, .scratch/t15/acceptance, and a zero-second optional hold.

## Checks and limits at handoff

- Passed: exact Node version check and syntax-only check with Node v26.13.0.
- Not run by this writer: server startup, build, tests, Firefox/browser runtime, TLS operation, report generation, screenshots, and cleanup verification. Root owns those checks and runtime.
- No phone, physical microphone/display, human listening, true weak network, 65-minute run unless explicitly requested, p95, resource capacity, Cloud Run, or full POC-04 claim is made.
- Root may make runtime-owned narrow changes after this STOP; this writer has no remaining work or resource claim.
