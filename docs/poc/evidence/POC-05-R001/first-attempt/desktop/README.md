# T16 single-room fan-out smoke

Status: failed
Started: 2026-11-05T03:04:43.424Z
Finished: 2026-11-05T03:04:56.551Z
Duration: 13127 ms

One externally running locked managed studio used one publisher and three additional real Firefox receiver processes. The publisher generated a single synthetic Opus source and a single synthetic VP8 canvas source. The report retains only allowlisted control summaries, byte/frame counters, local queue observations, render counters, and screenshots; it does not retain media payloads, full control payloads, credentials, or browser storage.

This short run is a core feasibility check. It does not establish capacity, quality, end-to-end latency, human listening, physical-device capture, weak-network behavior, or deployment readiness.

Failure: locator.click: Timeout 8000ms exceeded.
Call log:
[2m  - waiting for getByTestId('audio-continue-listening')[22m
[2m    - locator resolved to <button class="primary-button" data-testid="audio-continue-listening">繼續收聽</button>[22m
[2m  - attempting click action[22m
[2m    - waiting for element to be visible, enab
