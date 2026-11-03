# T05 synthetic desktop smoke

This script injects an animated canvas MediaStreamTrack in place of getDisplayMedia(). The track travels through the real VP8 WebCodecs encoder, LTS1 WebSocket relay, native VideoDecoder, and receiver canvas. It is synthetic-source pipeline evidence only; it does not demonstrate the native capture picker, physical display capture, phone support, or late-join synchronization.

Status: failed
Run started: 2026-11-03T13:39:45.546Z
Run finished: 2026-11-03T13:40:10.247Z
Topology: 1 publisher, 2 receivers, 3 Firefox processes over trusted local HTTPS/WSS.

The report includes actual browser counters, frame dimensions, source track settings, recent render fps, queue high-water counters, audio continuation checks, and downloaded observation JSON. It does not contain captured screen pixels beyond the focused screenshots.

Failure: page.waitForFunction: Timeout 15000ms exceeded.
    at /Users/samzhu/workspace_herdr/LaiTse/scripts/t05-smoke.mjs:395:23
