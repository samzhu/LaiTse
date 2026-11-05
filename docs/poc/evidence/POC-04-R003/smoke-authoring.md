# T14 smoke authoring notes

The single browser cycle uses three isolated trusted Firefox profiles: a host that starts synthetic Opus and VP8 sources through the normal controls, a healthy participant, and a slow participant. Both receivers start through normal UI controls and must show actual decoded/rendered counters before the disturbance.

Only the slow participant's existing Playwright WebSocket route is held, server to browser. The in-memory driver queue is capped at 256 KiB and 128 messages; its first queued message is allowed to age to 500 ms, then the route is closed with code 1013 and the held references are discarded. Client to server stays pass-through. Driver counts and ages are application-route observations, separate from the server participation.self.transport observation and local media-queue residence attributes.

The recovery check waits for the new connection's session.resumed, room.snapshot, and participation.self before asserting automatic audio and screen subscriptions. Fresh Opus/VP8 stream config plus new actual sample/frame rendering prove recovery; the browser smoke does not wait on a separate keyframe request. Healthy audio/video counters are sampled during the hold and after recovery, and a normal healthy feedback button must receive an interaction.ack before the slow route closes.

The script has no standalone server/browser launcher. Root owns the runtime run. This authoring pass only checks syntax with the repository's absolute Node 26.13 binary; it does not run the browser or server.
