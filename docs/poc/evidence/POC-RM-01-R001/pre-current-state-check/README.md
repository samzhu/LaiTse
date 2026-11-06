# POC-RM-01 browser smoke

Status: passed
Started: 2026-11-06T02:26:33.171Z
Finished: 2026-11-06T02:26:43.149Z
Contexts: four isolated Firefox profiles over trusted local HTTPS/WSS at https://localhost:55299

The smoke uses the normal room join dialog and management UI. Three additional denial messages are sent over the same joined participant WebSocket to confirm server-side rejection. Passwords, tokens, verifiers, raw control frames, and page error text are not retained.

This is a short local browser control smoke. It does not evaluate voice, persistence, database restart recovery, deployment, capacity, fairness of random selection, or product readiness.

Failure: none
