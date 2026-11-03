# T01 Firefox launch diagnosis

Date: 2026-11-03 (Asia/Taipei)

## Outcome

The local T01 page and WSS path work in one real Firefox client when Firefox's app-data directories are scoped to fresh, private paths under this diagnostic directory. The successful run used the project's existing stable Playwright/browser pair; it did not require a prerelease dependency, browser-ignore flags, a HOME override, or changes to system/user trust stores.

The saved R001 failures match a known macOS 27 Firefox app-data access problem. This root-cause attribution is an inference from the exact `Could not find profile folder` symptom and the successful isolated app-data override; no protected user Firefox profile was inspected.

## Preserved attempts

### Firefox 1555 without Mozilla app-data overrides

- Acceptance evidence: `.scratch/t01/acceptance-r001/browser-evidence.json` and `.scratch/t01/acceptance-r001-attempt02/browser-evidence.json`.
- Host: Node `v26.13.0`, macOS `27.2`, arm64; Playwright `1.64.1`; Firefox `157.0`, Playwright revision `1555`.
- Result: first launch aborted with `SIGABRT`; the controlled retry exited with `Could not find profile folder`. The root agent separately confirmed bare launch without a custom NSS profile returns the same profile error.

### Firefox 159 / Playwright next build

- Preserved report: `.scratch/t01/browser-diagnostic/run/browser-diagnostic.json`.
- Exact package: `playwright@1.65.0-alpha-2026-11-03` (Apache-2.0); its bundled `playwright-core/browsers.json` selects Firefox `159.0`, revision `1572`.
- Result: one escalated, isolated `launchPersistentContext` attempt still exited with `Could not find profile folder`; it never reached the local HTTPS page. This prerelease/browser pair is not a viable T01 route in this environment and is not recommended for adoption.

### Stable Firefox with private app-data paths

- Successful report: `.scratch/t01/browser-diagnostic/run-stable-private-appdata/browser-diagnostic.json`.
- Screenshot: `.scratch/t01/browser-diagnostic/run-stable-private-appdata/single-client.png`.
- Exact pair: Playwright `1.64.1` with its matching Firefox `157.0`, revision `1555`.
- Environment: Node `v26.13.0`, macOS `27.2`, arm64.
- `MOZ_APP_DATA` and `MOZ_LOCAL_APP_DATA` pointed to `run-stable-private-appdata/firefox-app-data/` and `run-stable-private-appdata/firefox-local-app-data/`. These variables were scoped to the diagnostic Node/Firefox process. `$HOME` remained unchanged.
- The local CA was imported only into a fresh NSS profile under the same diagnostic output directory. Certificate verification remained enabled.
- Result: the browser loaded `https://localhost:4173`, displayed `API ready · process-memory`, joined the room over WSS, and observed its server-assigned `member.joined` event plus a `wave` event with sequences 1 and 2. One-client evidence only; the two-client flow remains for the root agent to run and record as the next POC run.

## Primary references

- [Playwright issue #42768: Firefox shared app-data access on macOS 27](https://github.com/microsoft/playwright/issues/42768) reports the same profile-folder failure and discusses the Firefox 158 upstream fix and Playwright 1.65 work.
- [Mozilla Bug 2069536: allow Firefox to run with `-profile` without access to its shared macOS 27 app-data directory](https://bugzilla.mozilla.org/show_bug.cgi?id=2069536) documents process-local `MOZ_APP_DATA` / `MOZ_LOCAL_APP_DATA` paths as a workaround.
- [Playwright browser documentation](https://playwright.dev/docs/browsers) explains that Playwright requires its matching bundled Firefox build; the stable diagnostic used the browser revision paired with Playwright 1.64.1.

## Handoff

Use the stable Playwright `1.64.1` / Firefox `157.0` pair with both Mozilla app-data variables pointed to per-run scratch paths for the full two-client acceptance run. Preserve R001 as Inconclusive; use a new POC-00 run for the workaround. The root agent owns updating the application E2E invocation, running the two-client flow, and writing the official evidence.

No dependency manifest or lockfile changed. No HOME, existing profile, keychain, user/system trust store, or Cloud resource changed.
