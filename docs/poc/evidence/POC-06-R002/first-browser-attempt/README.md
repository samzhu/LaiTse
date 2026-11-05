# PostgreSQL browser restart smoke

Data slice: failed
Operational process/session result: failed or incomplete
Full POC pass: false
Product ready: false

Two isolated trusted Firefox profiles kept their original pages and session proofs open across two script-owned application processes. The report stores only allowlisted control metadata, session and interaction IDs, counts, gate outcomes, and process PIDs. It contains no database URL, passwords, resume tokens, chat text, or raw control/media payloads. Screenshot chat text is masked.

This is a small PostgreSQL persistence data slice. It does not test media, quality, scale, mobile, weak networks, endurance, cloud deployment, or full POC/product readiness.

Screenshots:
Failure: browserType.launchPersistentContext: Failed to launch the browser process.
Browser logs:

<launching> /Users/samzhu/workspace_herdr/LaiTse/.tools/playwright-browsers/firefox-1555/firefox/Nightly.app/Contents/MacOS/firefox -no-remote -headless -profile /Users/samzhu/workspace_herdr/LaiTse/.scratch/postgres/acceptance/br
