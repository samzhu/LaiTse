# T13 implementation checks

This implementation restores only a same-page receiver intent after the resumed socket has received matching fresh room and participation snapshots. The intent is ephemeral and room-bound. Manual receiver stop, an explicit room selection, interaction mode, leave, or a different authoritative room clears it. Controller disposal on socket close releases local media resources without clearing that intent.

Audio restores its subscription after its worklet resources are prepared, without awaiting `AudioContext.resume()`. If the browser keeps the context suspended, the panel remains usable and offers the normal **繼續收聽** gesture. It uses the latest `audio.stream` codec settings and publisher clock/generation. Screen recovery uses the fresh VP8 stream dimensions and clock, then relies on the relay's next-keyframe gate. The read-only display keeps first-join auto-watch and can restore its prior same-page video intent; it never starts audio. Neither panel auto-starts a microphone or display capture source, and the client does not persist media intent across a full page reload.

## Checks

Runtime: Node.js `v26.13.0` and npm `11.20.0`; the repository-pinned Node path and local npm cache were used.

- `npm run typecheck` — passed (client and server TypeScript projects).
- `node --test tests/media-recovery.integration.test.mjs tests/media-timeline.test.mjs` — passed, 12/12 cases. The new in-process WebSocket contracts confirm a resumed receiver begins unsubscribed, can resubscribe to the publisher's current Opus/VP8 stream, receives current audio frames and a keyframe-gated screen frame, and does not revive a disconnected publisher until a new manual start produces a new generation and clock ID.
- Logs: [runtime.log](runtime.log), [typecheck.log](typecheck.log), and [focused-node.log](focused-node.log).

The external WebSocket checks start and close their Fastify app inside the test process. No persistent server or browser was started here. Production build, the complete Node suite, and real Firefox receive/recovery demonstration remain for root's final validation. This evidence does not cover 20-run or p95 targets, phones, real devices, human listening, weak networks, long runs, or deployment.
