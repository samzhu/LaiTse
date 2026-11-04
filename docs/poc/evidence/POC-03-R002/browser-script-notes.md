# T08 cross-room media smoke

Status: passed
Started: 2026-11-04T02:17:40.070Z
Finished: 2026-11-04T02:17:48.454Z
Topology: 2 publishers, 2 receivers, 4 isolated Firefox processes over trusted local HTTPS/WSS.

The browser sources are generated oscillators and distinct-color canvas streams injected by this script. WebSocket packet payloads are never written to disk; bounded transport traces keep only packet hashes and frame metadata. The script verifies rendered AudioWorklet RMS and decoded canvas pixels, compares source packet hashes with the publisher in each server-selected room, switches one receiver, and verifies that the new room requires explicit subscriptions.

Separate trusted Node WSS clients try client-selected room/identity/role fields and binary publication without publisher ownership. The server diagnostics expose bounded queue/guard counters only; they do not contain names or connection identities.

This synthetic local desktop result does not establish verified account identity, private-room entry, physical-device support, human listening, end-to-end quality, capacity, durability, or deployment readiness.

Failure: none
