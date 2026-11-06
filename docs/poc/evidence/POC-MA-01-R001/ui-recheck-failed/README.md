# POC-MA-01 browser smoke

Status: failed
Started: 2026-11-06T01:37:43.061Z
Finished: 2026-11-06T01:37:58.014Z
Topology: four isolated Firefox processes over trusted local HTTPS/WSS; A/B publish in studio, C joins late, and D stays in lobby.

Audio and screen sources are generated in the test pages. The microphone and display APIs are replaced only in A/B test contexts; there is no physical microphone, native picker, real display capture, or human listening claim.

The report retains compact WebSocket control summaries and bounded binary packet metadata plus SHA-256 hashes, never media payloads or recovery secrets. Per-source playback assertions use the source owner’s `data-audio-streams` AudioWorklet PCM counters.

This is a short local feasibility smoke. It does not measure latency or listening quality, test phones, prove physical network recovery, establish capacity or endurance, or validate persistence/deployment.

Failure: Error: MA01-D sent screen.subscribe was not observed within 8000 ms.
    at waitFor (file:///Users/samzhu/workspace_herdr/LaiTse/scripts/multi-speaker-smoke.mjs:474:9)
    at async startWatchingScreen (file:///Users/samzhu/workspace_herdr/LaiTse/scripts/multi-speaker-smoke.mjs:653:3)
    at async Promise.all (index 1)
    at async runSmoke (file:///Users/samzhu/workspace_herdr/LaiTse/scripts/multi-speaker-smoke.mjs:773:3)
    at async file:///Users/samzhu/workspace_herdr/LaiTse/scripts/multi-speaker-smoke.mjs:1017:3
