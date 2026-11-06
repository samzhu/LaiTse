# POC-MA-01 browser smoke

Status: failed
Started: 2026-11-06T01:35:46.104Z
Finished: 2026-11-06T01:35:47.862Z
Topology: four isolated Firefox processes over trusted local HTTPS/WSS; A/B publish in studio, C joins late, and D stays in lobby.

Audio and screen sources are generated in the test pages. The microphone and display APIs are replaced only in A/B test contexts; there is no physical microphone, native picker, real display capture, or human listening claim.

The report retains compact WebSocket control summaries and bounded binary packet metadata plus SHA-256 hashes, never media payloads or recovery secrets. Per-source playback assertions use the source owner’s `data-audio-streams` AudioWorklet PCM counters.

This is a short local feasibility smoke. It does not measure latency or listening quality, test phones, prove physical network recovery, establish capacity or endurance, or validate persistence/deployment.

Failure: browserType.launchPersistentContext: Failed to launch the browser process.
Browser logs:

<launching> /Users/samzhu/workspace_herdr/LaiTse/.tools/playwright-browsers/firefox-1555/firefox/Nightly.app/Contents/MacOS/firefox -no-remote -headless -profile /Users/samzhu/workspace_herdr/LaiTse/.scratch/ma01/browser/MA01-C-runtime/profile -juggler-pipe about:blank
<launched> pid=34188
[pid=34188][err] *** You are running in headless mode.
[pid=34188] <process did exit: exitCode=null, signal=SIGABRT>
[pid=34188] starting temporary directories cleanup
Call log:
[2m  - <launching> /Users/samzhu/workspace_herdr/LaiTse/.tools/playwright-browsers/firefox-1555/firefox/Nightly.app/Contents/MacOS/firefox -no-remote -headless -profile /Users/samzhu/workspace_herdr/LaiTse/.scratch/ma01/browser/MA01-C-runtime/profile -juggler-pipe about:blank[22m
[2m  - <launched> pid=34188[22m
[2m  - [pid=34188][err] *** You are running in headless mode.[22m
[2m  - [pid=34188] <process did exit: exitCode=null, si
