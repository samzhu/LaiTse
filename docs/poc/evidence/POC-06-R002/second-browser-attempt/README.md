# PostgreSQL browser restart smoke

Data slice: failed
Operational process/session result: failed or incomplete
Full POC pass: false
Product ready: false

Two isolated trusted Firefox profiles kept their original pages and session proofs open across two script-owned application processes. The report stores only allowlisted control metadata, session and interaction IDs, counts, gate outcomes, and process PIDs. It contains no database URL, passwords, resume tokens, chat text, or raw control/media payloads. Screenshot chat text is masked.

This is a small PostgreSQL persistence data slice. It does not test media, quality, scale, mobile, weak networks, endurance, cloud deployment, or full POC/product readiness.

Screenshots: before-restart-interactions.png, before-restart-host-live-B.png
Failure: Firefox pages should stay on their original navigation across restart.
+ actual - expected

  {
+   guest: 2,
+   host: 2
-   guest: 1,
-   host: 1
  }
