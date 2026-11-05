# LaiTse local POC

One Fastify process serves the React page, health and room APIs, and one WebSocket endpoint. The local POC now has two rooms, server-backed pixel avatars, bounded room controls, Opus audio, and VP8 screen sharing.

This is an experiment, not the product or the MVP. It creates no cloud resources and uses no external service. Without `DATABASE_URL`, it keeps state in volatile process memory; local development can opt into PostgreSQL 18 for system information.

## Runtime and exact dependencies

The project pins Node.js `26.13.0` in `.nvmrc` and `package.json`. On the current Apple Silicon macOS host, the official Node archive is stored under ignored `.tools/` and verified against the matching line in Node's official `SHASUMS256.txt`. No global Node or nvm configuration is changed.

For a fresh local setup, download the official archive and checksum file, verify the archive, and extract it into the ignored tool directory:

```sh
mkdir -p .tools/downloads .tools .cache/npm
curl --fail --location https://nodejs.org/dist/v26.13.0/SHASUMS256.txt --output .tools/downloads/SHASUMS256-v26.13.0.txt
curl --fail --location https://nodejs.org/dist/v26.13.0/node-v26.13.0-darwin-arm64.tar.xz --output .tools/downloads/node-v26.13.0-darwin-arm64.tar.xz
(cd .tools/downloads && grep 'node-v26.13.0-darwin-arm64.tar.xz$' SHASUMS256-v26.13.0.txt | shasum -a 256 -c -)
tar -xJf .tools/downloads/node-v26.13.0-darwin-arm64.tar.xz -C .tools
export PATH="$PWD/.tools/node-v26.13.0-darwin-arm64/bin:$PATH"
node --version
npm --version
npm ci --cache "$PWD/.cache/npm"
```

The implementation environment is macOS arm64. On another operating system or CPU architecture, use the matching archive name and verify its entry in the same official checksum file. The package lock keeps direct and transitive package versions, registry URLs, and integrity hashes fixed. `npm run licenses` writes an ignored inventory with the installed package versions and package-declared licenses to `.scratch/t01/dependency-inventory.json`.

Direct runtime packages are `fastify@5.12.8`, `@fastify/websocket@11.3.6`, `@fastify/static@10.1.8`, `react@19.3.1`, `react-dom@19.3.1`, and `phaser@4.2.1` (MIT); PostgreSQL mode also uses `pg@8.23.1`. The client build, type checking, integration harness, and Playwright browser script use pinned development packages in `package.json`. Project metadata declares Apache-2.0 to match the existing `LICENSE` file.

## Build and run

With the pinned Node runtime on `PATH`:

```sh
npm run typecheck
npm run test:integration
npm run test:persistence # optional; requires PG_TEST_DATABASE_URL
npm run build
npm start
```

By default the app listens on `http://127.0.0.1:4173`. It serves the built page at `/`, a health response at `/api/health`, the fixed room catalogue at `/api/rooms`, and the control WebSocket at `/ws`. `HOST` and `PORT` can change the listen address. The default binds only to loopback.

## PostgreSQL 18 local development

For a local database, copy `.env.example` to `.env`, set the same local-only password in `POSTGRES_PASSWORD` and `DATABASE_URL`, replace the sample `HOST_CONTROL_TOKEN`, then start the database and app:

```sh
cp .env.example .env
docker compose up -d --wait postgres
npm run build
npm start
```

The Compose service uses the official `postgres:18.6-bookworm` image, binds only to `127.0.0.1:55432`, and stores data in the named `laitse-postgres18-data` volume mounted at PostgreSQL 18's `/var/lib/postgresql` directory. Stop it with `docker compose down`; that leaves the named volume in place. The checked-in `.env.example` credentials are local samples and must be changed before use. `.env` is ignored by Git.

Set `DATABASE_URL` to enable database mode. Without it, `/api/health` reports `process-memory`; with it, health reports `postgresql` and the actual availability state. The first database startup seeds the current fixed rooms, startup meeting-room verifier, interaction presentation defaults, and whether managed host controls are enabled. Later startup environment values do not overwrite saved room passwords or the managed-host setting. The same host-token-enabled state must be present at every startup; the token value itself is never saved, so it can be rotated while host controls remain enabled. A mismatch fails startup instead of changing the saved management mode.

PostgreSQL stores room lock verifier and revision, participant identity/role/mode and last room position, resumable session digests and expiry, chat/danmaku/sticker/feedback archive, interaction deduplication, moderation tombstones, host grant/revoke audit, capability observations, control event history, and durable room activity counters. A session resume restores a participant only after its proof and current room admission are validated. It restores the same participant ID, mode, and last position. Boot clears active connection ownership and starts with no online members, host claim, or publisher grant. For crash recovery, an active session has a ten-minute lease refreshed every minute; it can resume after restart only while that saved lease is still valid. A deliberate session leave and host removal revoke its proof.

Live interaction windows follow the existing in-memory limits: short public danmaku and feedback projections expire while the separate archive remains. Clearing the public queue marks those items as cleared in that projection while keeping their history; removing an item writes a moderation tombstone so it is excluded from later projections without deleting its archive row. No archive retention or cleanup policy is configured yet. Media payloads, raw session tokens, passwords, host tokens, and transport queues are not stored. The lightweight `/api/media-diagnostics` counters remain process-local and reset at startup; they are not durable activity statistics.

Text control operations run through a bounded serial executor. In database mode, each durable state transaction commits before its ACK or broadcast is sent. The app holds one PostgreSQL advisory lock; a second active app for the same database is rejected. A failed transaction or lost lock fails the app closed and drops staged output rather than claiming success. Binary media continues to relay without per-packet database writes.

The opt-in database integration test refuses any database except the dedicated `laitse_poc_test` database, creates a random per-run schema, and drops only that schema during cleanup:

```sh
PG_TEST_DATABASE_URL='postgresql://user:password@127.0.0.1:55433/laitse_poc_test' npm run test:persistence
```

That test is local POC evidence. It does not validate PostgreSQL hosting, production backup/retention, capacity, or Cloud Run deployment.

[POC-06-R002](docs/poc/evidence/POC-06-R002/README.md) records the verified local persistence slice: core tests, actual PostgreSQL integration, an ACK-before-SIGKILL diagnostic, same-volume container restart, and two trusted Firefox pages restoring their original identities, chat, feedback and current password gate. Its browser reproduction uses `node scripts/database-restart-browser.mjs` with the `PG_BROWSER_*` environment values documented there; the runner owns its application processes and expects a fresh disposable test database. Full POC and production readiness remain separate.

To use local HTTPS and WSS, create an isolated development CA and localhost certificate, then start the same application with both certificate paths:

```sh
npm run tls:dev
TLS_CERT_FILE=.scratch/t01/tls/localhost-cert.pem \
TLS_KEY_FILE=.scratch/t01/tls/localhost-key.pem \
npm start
```

The generated certificate covers `localhost`, `127.0.0.1`, and `::1`. The CA and private keys stay in ignored `.scratch/t01/tls/`; setup does not change a macOS or browser-wide trust store. HTTP mode is provided for quick local development. HTTPS/WSS is used for browser evidence.

For a later real-phone LAN check, pass the host machine's current LAN IP. The script validates it as a literal IP address, keeps the localhost SANs, reuses the existing local CA, and replaces only the leaf certificate when the requested IP is missing. It also writes `local-ca.cer` for device import. To isolate a one-off certificate from the default T01 files, set an output directory under `.scratch/`:

```sh
npm run tls:dev -- --host 192.168.1.23
# or, for an isolated certificate set:
npm run tls:dev -- --host 192.168.1.23 --output-dir .scratch/t02/tls
```

`--force` deletes the selected TLS directory and creates a new CA and leaf; any device or browser that trusted the old CA must trust the new one separately. The script never edits trust stores. Transfer only `local-ca.cer` (or `local-ca.pem`) to the device. Never transfer `local-ca-key.pem` or `localhost-key.pem`.

## Browser evidence

Install Playwright's Firefox build into the ignored tool directory, with NSS `certutil` available on `PATH`:

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/.tools/playwright-browsers" npm exec -- playwright install firefox
```

Keep the HTTPS server running, then run:

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/.tools/playwright-browsers" \
E2E_OUTPUT_DIR=.scratch/t01/e2e-run \
npm run test:e2e
```

The script launches two independent Firefox processes with isolated temporary profiles. Each Firefox child also receives private `MOZ_APP_DATA` and `MOZ_LOCAL_APP_DATA` directories under its run output; `$HOME`, existing Firefox data, and system settings are unchanged. This follows the workaround in [Mozilla Bug 2069536](https://bugzilla.mozilla.org/show_bug.cgi?id=2069536) for bare-executable launches on macOS 27. It imports the local CA only into those two per-run NSS databases, uses ordinary certificate verification, and fails if HTTPS is not trusted. It does not use `ignoreHTTPSErrors` or certificate-ignore browser flags. It records Node/npm, macOS, Firefox, API status, both clients' observed member/event state, and two screenshots under the chosen `.scratch/t01/` output directory. Set `HEADLESS=0` to show the two windows while the run executes. This is two-client local evidence, not a browser compatibility or mobile-device result.

## Control protocol and bounds

The server exposes two fixed rooms: `lobby` (`Local test room`) and `studio`. A client must join one room with a display name of 1–32 printable characters. The local space is limited to eight connected members. Room reactions accept only `wave`, `clap`, or `heart`; audio and screen use separate explicit subscribe, start, and stop requests. The server assigns a process-wide sequence number to join, leave, and reaction events and sends them only to current members of that room.

WebSocket connections must have an Origin matching the request's scheme and host. Malformed, unknown, or invalid control frames close the connection. Regular text controls remain limited to 1 KiB, capability reports keep their separate 8 KiB limit, accepted reactions are limited to 10 per connection per second, and the shared outbound socket queue is capped at 1.5 MiB. Audio keeps its 24-byte LTA1 header and 4 KiB Opus payload limit. Screen video uses a separate 24-byte LTS1 header with a maximum 512 KiB payload; the WebSocket parser allows that bounded frame size while application checks preserve the smaller text limits. Screen publication is limited to one publisher, VP8, 1280×720, 15 fps, and 1.5 Mbit/s. The page keeps only the most recent 20 room events for display.

Capability reports use a separate, fixed schema and an application-level 8 KiB limit; regular room controls remain limited to 1 KiB. A joined connection can explicitly send one report, which the server associates with its own connection ID, joined member, room, observation ID, and server time. The server validates reports and keeps the latest 64 in a process-local read cache; PostgreSQL mode also archives each accepted observation and resolves it by ID after restart. `GET /api/observations/:id` is unauthenticated in this local POC; the random observation ID is a lookup key, not an authorization system. Keep this server on a private development LAN and stop it after the test. The codec and API values are browser-reported; the server does not independently verify them.

## T02 browser capability check and phone setup

This is a capability inventory, not a media test. After joining the room, choose **探測此瀏覽器** and then **送出觀測**. The page checks secure-context state, API presence, small WebCodecs codec configurations, `MediaRecorder.isTypeSupported`, `MediaSource.isTypeSupported`, and `canPlayType` hints. It does not call `getUserMedia()` or `getDisplayMedia()`, request microphone/camera/screen permission, create a recording, decode media, or start playback. A `canPlayType` hint and a supported config do not prove that capture or playback works.

For a quick desktop check, use `npm run build` and `npm start`, open `http://127.0.0.1:4173`, join, and press the two capability buttons above. Loopback HTTP is useful for this local UI check; it is not a substitute for the phone’s trusted HTTPS path.

For a scripted desktop HTTPS smoke, keep the HTTPS server running as described above, then run `node scripts/t02-smoke.mjs` from another terminal with the pinned Node runtime and `certutil` on `PATH`. Results and a screenshot go to ignored `.scratch/t02/desktop-smoke/`. Set `T02_CA_CERT` if using a certificate directory other than the default `.scratch/t01/tls`. The [R004 matrix](docs/poc/evidence/POC-00-R004/browser-matrix.md) contains actual desktop results and explicitly unknown mobile rows.

To prepare a later phone check:

1. Put the phone and development computer on the same private Wi-Fi network. Find the computer's current LAN IP and create a leaf certificate for it, for example `npm run tls:dev -- --host 192.168.1.23`.
2. Start the built app on the LAN interface with the certificate and key paths:

   ```sh
   HOST=0.0.0.0 PORT=4173 \
   TLS_CERT_FILE=.scratch/t01/tls/localhost-cert.pem \
   TLS_KEY_FILE=.scratch/t01/tls/localhost-key.pem \
   npm start
   ```

3. Transfer only `.scratch/t01/tls/local-ca.cer` to a phone you control. On iPhone/iPad, install the certificate profile, then enable its SSL/TLS trust under **Settings > General > About > Certificate Trust Settings**. See [Apple's manual certificate trust instructions](https://support.apple.com/en-ie/102390). On Android, find the certificate install controls under **Security & privacy > More security settings > Encryption & credentials**; labels vary by manufacturer and version. The [Pixel certificate guide](https://support.google.com/pixelphone/answer/2844832?hl=en) documents that flow and credential removal. Check the actual browser by opening `https://<LAN-IP>:4173` and confirming that it loads without a certificate warning and reports `安全內容：是`.
4. Join the room, run the probe, review the matrix, and explicitly send the observation. Remove the development CA/profile from the phone when finished.

The phone's browser may apply trust differently; an installed CA alone is not evidence that a particular browser trusts the site. A real-device check is still required. This POC has no authentication, and the LAN-bound server exposes its page, room, and observation lookup to devices that can reach it. Do not expose it to a public network. The report records only a bounded user-agent string, platform string, client observation time, fixed probe results, and server-assigned connection/member/room metadata; it does not collect camera/microphone data or a client-supplied connection ID.

## T03 live audio and synthetic browser smoke

For a desktop audio path, start the app with trusted local HTTPS/WSS as described above, then open it in two separate browsers. Join the same room in each browser. On the receiving browser, press **開始收聽** first; this user gesture resumes its AudioContext and subscribes that socket to audio. On the speaking browser, press **開始麥克風** and allow the normal browser permission prompt. The UI reports denial, blocked context, missing device, unsupported codec, and other startup failures without showing an active-publisher state. Press **停止麥克風** to release the microphone and encoder and stop new relay frames. The receiver can press **停止收聽** to unsubscribe and release its decoder, playback queue, AudioWorklet, and AudioContext.

The profile is fixed to mono Opus, 48 kHz, 32 kbit/s, and 20 ms frames. The server forwards bounded compressed bytes to joined members who explicitly subscribed. It does not decode, transcode, retain, or record audio; it keeps only the current publisher generation and subscription flags in process memory. WebSocket packets are not written to disk. Receiver counters show packets sent/received, decoded frames, samples actually emitted by its playback AudioWorklet, queued samples, and RMS calculated from those rendered PCM samples. These counters establish browser pipeline output only; they do not establish that a person heard it or measure end-to-end latency.

For a scripted synthetic desktop run, keep the trusted HTTPS/WSS server running and execute `node scripts/t03-smoke.mjs` with Node 26.13.0 and `certutil` on `PATH`. It launches isolated Firefox profiles with Firefox's synthetic media-stream preference enabled, imports the local CA only into those profiles, joins two independent Firefox processes, starts listening before publishing, and checks that the receiver's playback worklet emits non-silent samples. A separate synthetic-only profile attempts the denied-permission path when the configured Firefox permission setting can verify it; the report marks denial verification as unavailable if the browser does not expose that outcome. The script does not select or record a real microphone, and its result is not real-mic or human-listening evidence. Output and screenshots stay in ignored `.scratch/t03/`.

For a real human listening demonstration, run the ordinary browser steps above with a user-controlled microphone and another participant's speakers/headphones. Headphones help avoid feedback when both pages are on the same computer. This has not been performed by the synthetic smoke. Mobile browsers, cross-device quality, weak networks, long runs, end-to-end latency, and deployment remain outside this T03 check.

## T04 desktop dual-receiver observation

Keep the same trusted HTTPS/WSS server running and run `node scripts/t04-smoke.mjs` with Node 26.13.0 and `certutil` on `PATH`. It opens three independent Firefox processes: one synthetic publisher and two desktop receivers. Receiver A starts first; receiver B joins the active stream later, unsubscribes while A continues, then subscribes again. The script checks that both receivers decode and render non-silent samples, waits for the actual unsubscribe and stream-ended server acknowledgements, downloads each receiver's observation JSON, and saves a focused audio-panel screenshot under ignored `.scratch/t04/desktop-smoke/`. Every Firefox profile uses `media.navigator.streams.fake=true`; only the isolated publisher profile simulates microphone permission. No hardware microphone, real recording, certificate-ignore flag, or system trust change is used.

For a manual desktop walkthrough, open three pages on the same trusted local HTTPS URL and join the same room. On both receiver pages click **開始收聽**; on the speaker page click **開始麥克風**. Once both receivers show playback samples and nonzero RMS, click **下載音訊觀測** on each receiver. The existing [LAN certificate and phone setup steps](#t02-browser-capability-check-and-phone-setup) apply when a real device check is scheduled; the T04 smoke itself remains desktop-only.

Each downloaded JSON includes fixed Opus settings, bounded browser user-agent/platform strings, secure-context status, current publisher/receiver generations, and controller counters. Sent packets accumulate for the page lifetime; receive/decode/render counters accumulate for the listening session across stream generations. Packet gaps are counted only between accepted consecutive sequence numbers after the first accepted packet of the observed generation. Gaps are not audible-interruption measurements. `receiverBufferMs` is the instantaneous queued-sample estimate and is not end-to-end latency; the report keeps `endToEndLatencyMs` null and marks human listening and physical-device evidence as not collected. The page cannot determine whether a publisher source was synthetic or a real microphone.

This is a short synthetic desktop core demonstration under DEC-010. Physical phones, real microphones, human listening, cross-device quality and end-to-end latency remain untested. The original 20-minute/two-run/p95 targets were not executed; they remain references for later quality work rather than hard gates for this light demonstration.

## T05 in-room screen share

For the real browser entry, start the app on trusted local HTTPS/WSS as above and open two independent browsers. Join the same room in both. In the viewer page, press **開始觀看分享**; current T06 code also supports subscribing while the publisher is active and waits for a new keyframe. On the publisher page, press **開始分享畫面** and choose a window, tab, or display in the browser's own picker. The application does not choose a source or persist a permission. The viewer should see decoded pixels in the preview. Press **停止分享** on the publisher and verify that the preview clears. Audio controls remain separate: start listening before starting the microphone; stopping either source leaves the other source active. Stopping the viewer also clears its preview.

The capture button calls `getDisplayMedia()` directly in the user action and requests up to 15 capture frames per second; the browser's actual track width, height, and frame rate are shown separately from the VP8 encode target (maximum 1280×720, 15 fps, 800 kbit/s). The actual encoded dimensions, delivered/decoded/rendered frame counts, recent render fps, encoder/decoder queue high-water values, and socket buffered-byte high-water value are available in the panel and **下載畫面觀測** JSON. The render fps is the receiver browser's recent 5-second rolling frame count, updated when a frame is rendered. Track settings are browser-reported and do not establish that a physical display was used. The report stores no image pixels; end-to-end latency, server CPU/memory, and physical-source attribution remain unavailable in the browser report.

For the automated desktop smoke, keep the trusted HTTPS/WSS server running and run `node scripts/t05-smoke.mjs` with Node 26.13.0 and `certutil` on `PATH`. It opens three isolated Firefox processes for one publisher and two viewers. The test injects a changing canvas stream by replacing `getDisplayMedia()` before the app loads; this is explicitly synthetic-source evidence, not proof of the native browser chooser or a physical screen. It also checks simulated capture denial, the synthetic track-stop state path (native stop does not fire an ended event), separate audio/screen stopping, and preview clearing. Output JSON and screenshots stay under ignored `.scratch/t05/`.

The VP8 frames are relayed as bounded opaque binary chunks; the app uses a 24-byte LTS1 header carrying generation, sequence, timestamp, and key/delta type. The publisher forces a keyframe at start and periodically every two seconds. When capture submissions are skipped for encoder/socket pressure, the next submitted frame is a keyframe; an oversized frame or an outbound queue over 1.5 MiB stops sharing to keep queues bounded. The server does not decode, transcode, retain, or record screen content. Later viewers are told that late-join synchronization is not implemented in this step. See the [W3C Screen Capture specification](https://www.w3.org/TR/screen-capture/) and [W3C WebCodecs specification](https://www.w3.org/TR/webcodecs/) for the browser APIs used here.

## T06 late join and audio/video clock

Join the same room in three desktop browsers if you want one publisher and two viewers. A viewer can press **開始觀看分享** and **開始收聽** after the publisher is already sharing and speaking. The server sends the active screen generation, VP8 dimensions and publisher clock ID, then asks that publisher for a keyframe. It forwards no screen deltas to the new viewer until that keyframe arrives; it keeps no frame history. Audio remains a separate subscription and starts with live packets.

The publisher timestamps screen frames from its document performance clock when a frame is copied to the encoding canvas. Audio capture timestamps come from AudioWorklet context frames mapped to that same performance clock with one anchor after the capture context resumes. This is an approximate browser graph mapping; physical microphone/input latency is unknown. The server adds the same publisher connection ID as a top-level clock ID to audio and screen stream announcements. The receiver synchronizes only when those IDs match.

The receiver AudioWorklet reports the source timestamp of samples it actually copied to output, along with the corresponding receiver graph time, near every 20 ms; each report records its actual frame-count window (normally about 21.33 ms at 48 kHz). A fresh `AudioContext.getOutputTimestamp()` pair maps graph time to the browser output-device clock; when it is unavailable or stale, the app uses a local graph estimate. These mappings have no calibrated error bound. The VP8 renderer holds up to 16 decoded frames (covering the existing 500 ms PCM buffer plus bounded output-clock lead at 15 fps), selects only a frame at or behind the sampled audio playhead, and closes discarded frames. Native decode submissions are separately capped at eight pending requests to allow bounded keyframe initialization bursts. Future frames wait briefly for the sampled playhead; missing, stale, stopped, or different-publisher audio falls back to standalone latest-frame display. This does not claim physical-speaker or human-perceived synchronization.

To replace a source, press **更換分享來源** and choose a new source in the browser picker. The old screen stream stops first, its receiver canvas clears, and the new dimensions start under a new generation and encoder. A brief blank is expected; audio stays active. VP8 is the only tested screen codec in this POC. Unsupported codec/configuration is surfaced as a browser error; there is no Recorder/MSE fallback negotiation.

The **下載畫面觀測** JSON now includes sync mode, same-clock status, the last sampled source-clock scheduling difference, and a bounded set of receiver audio-pulse timestamps. The scheduling difference is not a measured human A/V offset. For common-marker evidence, keep the publisher, microphone and screen controls active and run the short synthetic smoke below; it compares AudioWorklet pulse observations with color-coded pixels sampled from the decoded receiver canvas on the same receiver performance clock. The script reports raw paired-cycle offsets, the actual AudioWorklet observation window per event, observed RAF sampling interval, and a null mapping error bound. A short sample does not establish p95 quality.

For the synthetic desktop smoke, keep the trusted HTTPS/WSS server running and run `node scripts/t06-smoke.mjs` with Node 26.13.0 and `certutil` on `PATH`. It uses three isolated Firefox processes; an AudioContext oscillator provides the synthetic Opus input, and an animated canvas provides synthetic VP8 video. The publisher starts both streams before viewer B joins. The run checks late join/keyframe delivery, matching clock IDs, actual audio-master scheduling, 1280×720 target and replacement dimensions/generation, unsubscribe/re-subscribe, independent stop behavior, and a handful of same-receiver marker cycles. Reports, downloaded observation JSON and screenshots stay under ignored `.scratch/t06/`. It does not use hardware microphone or native display capture and does not run the original p95/two-run quality acceptance.

## T07 pixel characters and two rooms

The room picker lists the backward-compatible `lobby` room and the `studio` room. Join either from the visible room buttons. The single WebSocket returns the existing room snapshot plus an authoritative `space.snapshot` containing the public room catalogue and the recipient's own room characters, IDs, and grid positions. The other room remains listed with `membersVisible: false` and no member data. Its name and ID are public catalogue metadata; its member count, names, IDs, and positions are hidden.

Focus the map and press the arrow keys or W/A/S/D to request one grid step at a time. The server chooses the participant from the connection, enforces the 16×10 room bounds and movement rate, and broadcasts the accepted position. The direction pad offers the same operation without precise canvas input. The Phaser scene draws two distinct room zones and original 16×20 pixel character textures from an authored palette; it downloads no art. `Phaser.AUTO` uses WebGL when available and falls back to Canvas, and the page reports Phaser's actual renderer. Render diagnostics are written after Phaser's `POST_RENDER` event and include the current Phaser object coordinates and texture key.

The **Reduce motion** checkbox starts from the operating system preference and can be changed manually. When enabled, position updates snap to their server destination without movement tweens. On a room change, the audio and screen panels unmount first so their controllers stop capture, unsubscribe and stop publishing before the room-switch message is sent. The server clears old relay participation and registers the connection in its new room. T07 originally treated studio as spatial-only; T08 adds independent media relays to both rooms.

For the short desktop flow, build and start the trusted HTTPS/WSS app, then run `node scripts/t07-smoke.mjs` with Node 26.13.0, Firefox, and `certutil` on `PATH`. It uses two isolated Firefox profiles without requesting microphone or screen permissions. It checks real key input on a focused map, server-acknowledged position matching the other client's actual Phaser render, explicit room changes, leave/rejoin, empty-room visibility, and reduced-motion settling. JSON, raw WebSocket controls, Phaser render diagnostics, and screenshots are written under ignored `.scratch/t07/desktop-smoke/`. This is desktop evidence only; phone/browser support remains untested.

## T08 media in both rooms

Join two publishers and their listeners in `lobby` and `studio`. Each listener must press **開始收聽** and **開始觀看分享** in its own room. Each publisher separately starts its microphone and screen source. Audio and screen bytes travel over the existing WebSocket and stay in the publisher's server-selected room; the server does not decode, transcode, store, or record them. A room switch unmounts both media panels, stops publishing and unsubscribes before sending `room.switch`. The new room does not resume any media automatically; press the receive controls again and restart any source deliberately.

The local diagnostic endpoint is `GET /api/media-diagnostics`. It reports bounded per-room counters for media/control messages queued by the server, denied protocol attempts, authoritative room send checks, and cross-room send attempts denied by the room guard. These counters contain no names or connection IDs. A zero guard-block count is not delivery proof; raw receiver WebSocket packets and decoded browser output show which publisher reached which receiver.

For a short synthetic desktop run, start the app with trusted local HTTPS/WSS and run `node scripts/t08-smoke.mjs` using Node 26.13.0, installed Playwright Firefox, and `certutil` on `PATH`. It launches four isolated Firefox processes for two publishers and two receivers, injects distinct synthetic audio oscillators and screen colors, checks rendered receiver output and source-matched packet hashes, switches one receiver, and uses separate Node WebSocket clients to try forged room/identity/role fields and unauthorized binary publication. Bounded reports and screenshots go to ignored `.scratch/t08/desktop-smoke/`. This is synthetic local desktop evidence, not a real microphone, human-listening, phone, account-authentication, or quality result.

The server assigns connection and participant IDs and derives the current room from that connection's accepted join/switch messages. Those IDs are not verified account identities. Without `HOST_CONTROL_TOKEN`, the app keeps the legacy anonymous local POC behavior: any joined member may publish, host controls are unavailable, and the room-lock startup setting still applies. Keep the development server on a private machine or LAN.

## DEC-011-A space audio policy POC

The fixed `lobby` room is displayed as **Open area** and applies proximity eligibility to audio only. The current local demonstration uses an inclusive Euclidean radius of 6 avatar-grid units; the server reads both positions from its space model and checks the current positions again before forwarding every binary audio packet. Moving either the publisher or receiver can stop delivery and clear the receiver's active decoder/worklet queue; the listener stays enabled and resumes when it returns in range. Screen sharing and member visibility are not distance-filtered.

The fixed `studio` room is displayed as **Meeting room** and sends audio to every subscribed member in that room regardless of distance. Room membership still isolates audio. The UI labels both policies and calls the 6-unit open-area radius a provisional demo setting. Existing one-publisher-per-room behavior remains in place.

For a short real-browser demonstration, run the app on the already trusted local HTTPS/WSS setup and execute `node scripts/space-policy-smoke.mjs` with Node 26.13.0, Playwright Firefox, `certutil`, and `.scratch/t01/tls/local-ca.pem` available. It launches three isolated Firefox processes, injects a synthetic oscillator through the test-only `getUserMedia()` replacement, moves the distant receiver with the visible controls, then switches all three clients to the meeting room and restarts audio by hand. The report stores authoritative position snapshots, control transitions, bounded opaque LTA1 packet hashes, receiver decode/render windows, errors, and two screenshots under `.scratch/space-policy/desktop-smoke/`; it does not store audio payloads.

This POC does not implement room doors, password entry, multi-source mixing, distance-based volume changes, authenticated identities, phone support, real microphones, or human listening. The 6-unit radius is an experiment value rather than a final product setting.

## DEC011-BC meeting room door and password POC

The Phaser map now draws a marked door between the open area and meeting room. Click the door, use the **Enter … through door** button, or focus the map and press **Enter**. The room buttons and direct first join use the same server entry check. If the meeting room is unlocked, entry needs no password. If it is locked, the page asks for the password and sends it only in that join or room-switch WebSocket message. The room catalogue and snapshots expose only the public `isLocked` boolean; they contain no password or verifier.

Lock state defaults to the server process startup configuration. Leave `MEETING_ROOM_PASSWORD` unset or empty to start unlocked; set a non-empty value before starting the server to start locked. Without `HOST_CONTROL_TOKEN`, restart the server whenever changing the password or lock state. There is no public REST toggle or password-management endpoint. The server creates a random salt and derives a 32-byte scrypt verifier at startup; neither the configured value nor verifier is sent in public room data, persisted in application records, included in URLs, or logged. Each startup reads the environment setting.

For a browser demonstration, start the server with the intended configuration, then run `node scripts/room-access-smoke.mjs` using Node 26.13.0, Firefox, `certutil`, and `.scratch/t01/tls/local-ca.pem`. Set `ROOM_ACCESS_EXPECT_LOCKED=0` for an unlocked server or `1` for a locked server. In locked mode also set `ROOM_ACCESS_TEST_PASSWORD` to the same temporary value used for `MEETING_ROOM_PASSWORD`; the script removes both variables from the Firefox process environment and never writes the value to its report. Run the two modes with separate server startups. Evidence is saved under `.scratch/room-access/unlocked/` or `.scratch/room-access/locked/`, unless `ROOM_ACCESS_OUTPUT_DIR` selects another directory inside `.scratch/room-access/`.

The script uses two isolated Firefox profiles. It checks the Phaser scene door by clicking its canvas coordinates, tests locked rejection and retry, confirms unlocked entry/exit, and uses a synthetic oscillator to verify an admitted meeting-room listener receives and renders Opus. A separate Node WebSocket probe sends missing and wrong passwords, forged lock/role/identity fields, and opaque audio/screen frames before admission; rejected clients receive no room snapshots, member events, or media bytes. The trace records message type, target room, whether a password field was present, bounded opaque audio packet hashes, and room/position snapshots; it never records control-frame text or password/verifier data.

This remains a local POC: password checks use synchronous scrypt and a basic five-attempt-per-connection rolling-minute limit. Opening a locked door keeps the current room and media active until a password is submitted. On a submitted room switch, local media controllers stop before the server verifies the password; if the password is wrong, the participant stays in the original room and can retry, but must manually restart media they had been using. Fresh WebSocket connections get a separate attempt window. Host authorization is a server-start secret for a shared local POC, not account identity or verified-user authorization; production identity, recovery policy, and brute-force protection remain future work.

## T09 host controls and live meeting room lock POC

To enable managed mode, start the server with `HOST_CONTROL_TOKEN` set to a private random value of 32–256 UTF-8 bytes. The host enters that value in the in-room management panel after joining. The server accepts the claim only over the existing WebSocket after room entry. It does not use the room password as a host token, and it never places either secret in a URL, public room catalogue, snapshot, response, server log, or smoke report. With no `HOST_CONTROL_TOKEN`, the page says it is in anonymous mode and joined members retain the previous open publishing behavior.

Host access belongs to the current WebSocket connection and room. A room switch clears host access; the host must claim again in the new room. A host can grant or revoke microphone and screen publishing for a current room member, or remove that member's current connection. Revocation stops active server relays, notifies the source page to stop its real capture tracks, clears receiver decoders, and blocks later audio and screen frames at the server. The member can still receive room media after losing publish permission. Removal disconnects only the selected anonymous connection; without accounts, a person can rejoin as a new temporary identity.

While in the meeting room, a host can set or change its password to lock new entries, or unlock it. Existing members stay in the room, and all join and switch paths use the same live server gate. The room catalogue and member snapshots update immediately. The open area does not have a lock control. **End activity** stops publishing in the current room, clears publisher grants, and keeps the room and its members; the host may start a new activity afterward.

For a short managed-mode browser run, start the server with the same private `HOST_CONTROL_TOKEN` used by the smoke runner, then run `node scripts/host-control-smoke.mjs` with Node 26.13.0, Playwright Firefox, `certutil`, and `.scratch/t01/tls/local-ca.pem`. Set `HOST_CONTROL_EXPECT_ENABLED=1`, `HOST_CONTROL_TEST_TOKEN` to the same temporary token, `HOST_CONTROL_TEST_PASSWORD` to a temporary meeting-room password for the dynamic lock retry, and `HOST_CONTROL_OUTPUT_DIR` to a directory under `.scratch/t09/`. The script strips all of these credentials from the Firefox process environment and from its reports, then enters only the two test credentials through the page controls. It uses isolated Firefox profiles with injected synthetic audio and screen sources and records bounded public permission/status observations and screenshots. This does not verify account identity, physical microphone/display selection, phones, human listening, production recovery, or deployment security.

## T10 room interactions and public danmaku POC

After joining a room, the interaction panel separates three official feedback buttons (**👍 讚**, **👂 我想聽**, **💡 這個實用**), plain-text chat, fixed emoji stickers, and the separate **公開彈幕** form. Only an explicit public-danmaku submission appears in the public presentation area. Chat and stickers remain in the room history. The legacy `wave`, `clap`, and `heart` room-presence events remain available for the earlier protocol check; they are separate from these three feedback types.

The server derives the room and participant from the current WebSocket membership. `interaction.submit` accepts only the selected kind and its corresponding content fields; client-supplied room or role fields are rejected. Chat is limited to 300 Unicode code points, public danmaku to 60, and the fixed sticker set is `✨`, `👏`, `❤️`, `🎉`, and `🌱`. Text is rendered as React text; this slice does not accept HTML or uploaded images. These are local POC rules, not durable accounts; PostgreSQL mode archives chat history as described above.

In managed mode, the current connection's T09 host claim exposes four separate controls: pause or resume public display, allow or block new public danmaku, clear the public queue, and remove one item from both the room history and public queue. Pausing hides display while accepting new items into the bounded queue; blocking rejects new danmaku while chat and feedback continue. Resume only exposes unexpired items. Hosts use the existing T09 token field; there is no second host credential or display route.

The deliberately small local limits are: 50 history items retained for 5 minutes, 20 public items with an 8-second expiry, rolling feedback counts and distinct participants over 60 seconds with at most 512 retained feedback records per room, and 2,048 deduplication records held for 10 minutes. A connection may send up to 10 interactions per second and one feedback event per second. Duplicate sender/event-ID payloads return an ACK without rebroadcasting or recounting; reusing an ID with different content or in another room is rejected. If the bounded deduplication cache is full, new events are rejected until retained IDs expire rather than evicting a still-valid ID. These fixture values are adjustable engineering choices, not approved product defaults. In process-memory mode all state clears when the server process stops; PostgreSQL mode restores active projections within these same TTL and item bounds while retaining the separate archive.

The display uses the server timestamp in each state update with elapsed local monotonic time to hide expired items while waiting for the next server update. This is a local display estimate, not a cross-device clock calibration or latency measurement.

For focused server contracts, run `node --test tests/interactions.integration.test.mjs` with Node 26.13.0. The short three-Firefox smoke expects a trusted local HTTPS server on `https://localhost:4173`, Playwright Firefox, `certutil`, and the local CA. Set `HOST_CONTROL_TOKEN` on the server, then give the same temporary value to `INTERACTION_TEST_HOST_TOKEN` for the runner. Optional `INTERACTION_BASE_URL`, `INTERACTION_CA_CERT` (or `CA_CERT`), and `INTERACTION_OUTPUT_DIR` select the URL, CA, and report directory; the output directory must remain under `.scratch/t10/`. The runner launches two studio pages and one lobby page, strips host credentials from Firefox's environment, does not put credentials in URLs or reports, and saves its event/counter/error report and screenshots under the selected output directory. It does not test 100-event latency, a p95 target, phones, real people, production retention, or a full T10/POC-03 gate.

## Data classification and limitations

- **Fixed, versioned setup:** the lobby/studio catalogue, room names, movement grid, and media routing policies are source constants in `src/server/space.ts`; PostgreSQL stores current door/password verifier and interaction presentation settings, not an editable room catalogue.
- **PostgreSQL system information:** when `DATABASE_URL` is set, room gate revisions, participant ID/role/mode/last room position, short-lived proof digests, interaction archive/dedup/moderation state, control events, capability observations, and activity counters persist in PostgreSQL. On boot, only a participant who later presents a valid unexpired proof becomes online; other saved participant rows do not appear as ghosts. Host claims and publisher grants always start inactive.
- **Execution-time media and diagnostics:** current sockets, subscriptions, audio/screen publisher generations, transport budgets, byte/frame diagnostics, playback counters, and screen preview pixels remain process- or page-local. Raw media payloads are not stored. A disconnect stops its streams; the app restart does not restore a publisher or subscription automatically.
- **Not implemented in this POC:** authenticated accounts, account-bound private access, verified human roles, production backup/retention, capacity guarantees, phone verification, multi-instance media routing, or durable media storage. A single-app advisory lock rejects a second active PostgreSQL-backed process; this is not multi-instance support. Physical A/V quality and mobile support remain untested.

## Focused commands

```sh
npm run typecheck
npm run test:integration
node --test tests/*.test.mjs
npm run build
npm run licenses
```

For focused T08 contracts, run `node --test tests/room-isolation.integration.test.mjs tests/space.integration.test.mjs tests/audio.integration.test.mjs tests/screen.integration.test.mjs tests/server.integration.test.mjs`. The Node WebSocket clients exercise per-room media routing, redacted space snapshots, room switches, forged fields, and unauthorized binary publication. `node scripts/t08-smoke.mjs` separately uses actual Firefox processes for synthetic browser playback and decoded screen output. Neither replaces real-device media, account authentication, or capacity experiments.

## Recorded verification

[POC-00-R001](docs/poc/evidence/POC-00-R001/README.md) preserves the original Firefox launch failure. R002 records the final two-browser acceptance with private application-data directories; the authoritative status and remaining stage requirements are in [the execution log](docs/poc/execution-log.md). On macOS an automation sandbox may prevent Firefox from launching; run the test from a normal local terminal. Do not substitute certificate-ignore flags. Runtime dependencies remain stable releases; the diagnostic prerelease browser was rejected and is unused.

[T03 POC-01-R001](docs/poc/evidence/POC-01-R001/README.md) records synthetic Opus encode/relay/decode/render, simulated denial, stop, and the first-run cleanup failure and correction. Real microphone and human listening remain pending. `npm run test:integration` retains the original T01 subset; `node --test tests/*.test.mjs` covers all current local POC integration and clock cases.

[T04 POC-01-R002](docs/poc/evidence/POC-01-R002/README.md) records actual dual-receiver synthetic playback, late join, isolated unsubscribe/re-subscribe, stop, and downloaded observations. Physical phone and human-listening evidence remain pending.


T05 local evidence: [POC-02-R001](docs/poc/evidence/POC-02-R001/README.md) records a short three-Firefox synthetic audiovisual flow and a separate native Chrome tab-capture flow. For native capture, put the publisher tab in the foreground before clicking **開始分享畫面**; a background document can return `Invalid state`. Native Chrome tab capture rendered at 1280×630 in this run, and Chrome’s own **停止分享** cleared the receiver. This does not establish desktop/window capture, native-microphone quality, phone support, late join, or audio/video synchronization.


[T06 POC-02-R002](docs/poc/evidence/POC-02-R002/README.md) records the current synthetic desktop late-join/source-replacement/same-publisher audio-master flow. The final short browser run passes core operations; three same-receiver marker offsets were 64.77, 151.71, and 129.35 ms with uncalibrated mapping error. This does not establish the original 150 ms/p95 quality gate or physical-device support. Earlier failed runs and buffer/initialization fixes are preserved alongside the result.

[T07 POC-03-R001](docs/poc/evidence/POC-03-R001/README.md) records the two-Firefox WebGL avatar/room flow, focused keyboard movement, leave/rejoin and reduced motion. Phone and full cross-room media remain pending.

[T08 POC-03-R002](docs/poc/evidence/POC-03-R002/README.md) records two-room synthetic media, packet-source isolation, switch/reset, and six rejected external probes. Account authentication/private entry and physical-device quality remain pending. T07 shared-map visibility is historical; the current map hides other-room members.

[DEC011-A POC-03-R003](docs/poc/evidence/POC-03-R003/README.md) records the current Open area proximity/Meeting room whole-room audio flow. The 6-grid radius is provisional; doors/passwords and physical-device quality remain pending. Use `scripts/space-policy-smoke.mjs` for this version; older smoke scripts preserve historical names/policies.

[DEC011-BC POC-03-R004](docs/poc/evidence/POC-03-R004/README.md) records the meeting-room door/password flow in unlocked and locked startup configurations, including raw scene-door input diagnostics and the canvas-bounds correction. The gate is local POC access control; live host management and real-device quality remain pending.

[T09 POC-03-R005](docs/poc/evidence/POC-03-R005/README.md) records managed host claims, live password lock/unlock, synthetic A/V grants and stopping on revocation/end, external unauthorized controls, usage and limits. The host token must differ from the room password. Root review also corrected the pixel door to redraw its LOCKED/OPEN state when the live catalogue changes.

[T10 POC-03-R006](docs/poc/evidence/POC-03-R006/README.md) records core room interaction usage, bounded deduplication and retention, host display controls, three-browser evidence and the incomplete latency/quality gate. Public text is presented in a fixed in-room region in this slice; the standalone display, participation modes and moving overlay remain later integration work.

### T11: direct room links, participation modes, and read-only display

The main page accepts a room and mode in its query string, for example `/?room=studio&mode=interaction`; omitted or unrecognized modes default to `watch`. A direct link still asks for a display name and uses the same room password gate as a normal join. After joining, a participant can change between **觀看＋互動** and **只互動** on the same connection. The interaction mode stops local publishing sources and clears both audio and screen subscriptions before the server acknowledges the change. Returning to watch mode does not start a source, subscribe, or play audio automatically; use the media controls again. Existing avatar movement, room selection, reactions, and text interactions remain available in interaction mode. The local playback-volume choice and unsent chat/danmaku drafts survive mode changes.

The read-only room display is available at `/?view=display&room=studio`. It remains behind the normal room password gate, automatically subscribes to shared video, and shows public feedback totals and current public danmaku. It does not start audio playback or offer publishing, host, reaction, or message controls. The QR shown after joining contains only the current public URL with its room and `mode=interaction`; it never includes room passwords or host tokens. QR support uses the pinned local `qrcode-generator` package and does not call a remote service. The participant self-status panel exposes server-side audio and screen subscription flags plus cumulative WebSocket enqueue bytes and frames for that connection; those counters do not prove browser receipt or decoding.

For the short synthetic three-Firefox participation smoke, start the app on trusted local HTTPS with managed host controls and the intended meeting-room password, then run `node scripts/participation-smoke.mjs` using Node 26.13.0, Firefox, `certutil`, and the local development CA. Set `PARTICIPATION_TEST_HOST_TOKEN` to the server's host token, `PARTICIPATION_TEST_ROOM_PASSWORD` to its meeting-room password, and optionally `PARTICIPATION_BASE_URL`, `PARTICIPATION_CA_CERT`, or `PARTICIPATION_OUTPUT_DIR` for the local endpoint and evidence directory. The script removes these credentials from Firefox's environment, enters them only through the existing room/host controls, decodes the displayed QR from its actual canvas pixels, and keeps reports and screenshots under `.scratch/t11/`. This synthetic run does not test phone cameras, physical media devices, human listening, long-term reliability, or the complete POC-03 acceptance criteria.

T11 desktop core evidence is saved in [POC-03-R007](docs/poc/evidence/POC-03-R007/README.md): production build/typecheck, 42 Node cases, and the three-Firefox synthetic flow passed, including five live-source zero-media windows, display privacy and nine read-only rejection probes, and QR pixel decoding followed by gated entry. The first harness failures and corrections are retained. Phones, human listening, durability, and full POC-03 remain unverified.

### T12: control connection recovery

After a participant or read-only display joins, the server may issue a short-lived opaque control-session token. The browser keeps it in that tab's `sessionStorage`; it is not added to a URL or QR code. If `sessionStorage` is unavailable, recovery works only while the current page remains open. In memory mode the server holds the session in process memory and expires it ten minutes after its WebSocket disconnects. In PostgreSQL mode it saves only a SHA-256 proof digest and a ten-minute active lease refreshed every minute; after restart the lease is cleared from active ownership and the same proof can resume only while its saved expiry is still valid. The local store is capped at 512 sessions and refuses new resumable joins when full rather than evicting an unexpired session.

An unexpected control-socket close triggers up to eight retries, starting near 250 ms and capped near two seconds with jitter. The participant or display status shows the reconnect state and offers manual retry after the automatic attempts stop. Refreshing the same tab also attempts recovery. The server chooses the saved participant ID, room, role, and participation mode, then sends a fresh room and interaction snapshot. A direct room URL that does not match the saved entry context clears that local recovery candidate and uses the normal join flow instead. The browser updates the room URL after an accepted room switch so a later refresh points to the latest room.

Every recovery checks the current room gate revision. If the revision changed and the room is currently locked, the page asks for the current room password before it rejoins; if the room is unlocked, the server records the new revision without asking for a password. Resume keeps the same temporary participant ID so the server's bounded interaction-event deduplication still recognizes a repeated event ID. The server removes expired danmaku from the public presentation queue; the separate bounded chat history may still contain previously sent text. The client does not replay mutations that lacked an acknowledgement. Removing a participant invalidates its recovery token. Leaving from an active room connection also invalidates it; cancelling while disconnected clears the tab's copy and lets the detached server record expire under its idle TTL.

The original T12 R001 behavior restored only control state: media subscriptions were disposed on disconnect, and a resumed display waited for the operator to start watching again. T13 extends the current client with same-page restoration of a participant's prior receive intent after a fresh room snapshot and participation snapshot. Host claims and publisher grants are still cleared on disconnect, and this local connection credential is not account authentication or durable identity.

Run the focused server contracts with `node --test tests/control-reconnect.integration.test.mjs`. For the short real-browser flow, first start the local HTTPS/WSS server in managed mode with the intended `HOST_CONTROL_TOKEN` and a locked meeting room, then run `node scripts/control-reconnect-smoke.mjs` using Node 26.13.0, Firefox, `certutil`, and the trusted local CA. Set `RECONNECT_TEST_HOST_TOKEN` and `RECONNECT_TEST_ROOM_PASSWORD`; `RECONNECT_BASE_URL`, `RECONNECT_CA_CERT`, `RECONNECT_OUTPUT_DIR`, and `HEADLESS=0` are optional. `RECONNECT_INCLUDE_DISPLAY=0` omits its optional display-browser check. Reports and screenshots stay under `.scratch/t12/`. The smoke runner does not start or stop the server. A controlled socket close is a desktop control-recovery demonstration, not physical-network or weak-network evidence; this T12 check does not verify media decoding, phones, accounts, durable identity, production recovery, or deployment. Its display subscription expectation now follows T13 same-page video intent; the original R001 result remains historical.

T12 desktop control evidence: [POC-04-R001](docs/poc/evidence/POC-04-R001/README.md). Production build/typecheck, 47 Node cases and the first three-Firefox flow passed. The smoke restores the starting test-room password on success; after an interrupted/failed standalone run, restart the disposable local server to restore startup configuration. This run does not prove media recovery or physical network behavior.

### T13: same-page media receive recovery

After a participant has manually started audio listening or screen watching, an unexpected WebSocket disconnect can restore those same receive subscriptions when the same page reconnects to the same room in `watch` mode. The client waits for the new socket's room snapshot and participation snapshot, then subscribes once; fresh relay stream metadata, decoder/controller state, and screen keyframe gating are used for the new connection. A changed resumed room, `interaction` mode, explicit room switch, manual stop, or leave clears the prior receive intent. Returning from `interaction` to `watch` still requires manual subscription.

Audio recovery may subscribe while the browser keeps its AudioContext suspended. The page shows that state and offers **繼續收聽** as a normal browser gesture; it does not bypass autoplay policy or wait indefinitely for `AudioContext.resume()` before restoring the receiver subscription. Audio volume is kept only in the current page. A full page refresh does not persist media intent and still requires the user to start media again.

Only receiver intent can resume. A microphone or display capture source is never reopened, and prior host claims or publisher grants are never restored. The read-only display retains its normal video auto-watch on first join and can restore that same-page video intent after a reconnect; it never starts audio. This is a short local desktop core check, not mobile, real-device, weak-network, long-run, p95, or deployment evidence.

The focused run passed seven receiver-intent/WebSocket recovery cases and five existing media-timeline cases. These checks cover the client intent seam and in-process server protocol, not browser decoding or rendering. For the short synthetic browser recovery flow, run `node scripts/media-recovery-smoke.mjs` against the trusted local HTTPS/WSS server using Node 26.13.0, Firefox, `certutil`, and the local CA. The operator starts/stops the server; the script creates/closes its isolated Firefox profiles and writes bounded evidence below `.scratch/t13/`.

Set `MEDIA_RECOVERY_TEST_HOST_TOKEN` and `MEDIA_RECOVERY_TEST_ROOM_PASSWORD` to the managed test server's values; optional variables are `MEDIA_RECOVERY_BASE_URL`, `MEDIA_RECOVERY_CA_CERT`, `MEDIA_RECOVERY_OUTPUT_DIR`, and `HEADLESS=0`. `MEDIA_RECOVERY_TEST_SCOPE=publisher` runs only the initial playback and focused sender-close/manual-restart leg. [POC-04-R002](docs/poc/evidence/POC-04-R002/README.md) records 54 passing Node cases/build and separate successful receiver and publisher legs. Three full-script failures and narrow fixes are retained; the final combined script was syntax checked but not rerun end-to-end. Firefox resumed audio automatically here; the gesture branch and 20-run/p95/device targets remain unverified.

### T14: slow-receiver isolation and bounded media queues

All server WebSocket sends for a connection share one application send budget across control messages, audio, and screen frames. The effective byte check is the larger of `ws.bufferedAmount` and bytes still awaiting send callbacks, plus the next message, against 1.5 MiB; these two observations are not added together. A send callback still pending at 1,000 ms closes only that socket with server close code `1013`. `participation.inspect` still accepts only its existing small self-inspection request; its response adds the current connection's pending callback count/bytes/oldest age, callback high-water values, raw `ws.bufferedAmount` high-water, effective byte/age limits, and budget close reason. These counters describe application send callbacks and the `ws` queue only, not OS/TCP buffering or peer receipt.

On the receiver, the existing eight-pending VP8 decode limit and 16 decoded-frame limit remain. Each decoded video frame also records local `performance.now()` enqueue time; frames at least 500 ms old are closed and pruned before rendering or when a new decoded frame arrives. The audio decoder closes only its own WebSocket with client application code `4003` when eight decode requests are already pending, allowing the existing T12/T13 session and receive-intent recovery path to get fresh stream metadata and media. A sender's capture source and publisher permission are not reopened by receiver recovery.

The AudioWorklet keeps the existing 24,000-sample PCM cap and rejects any single PCM batch larger than that cap. Queued PCM is dropped after 500 ms of AudioWorklet graph-time residence. Graph time stops while an AudioContext is suspended; the existing suspend/restart path clears decoder and PCM queue state. The 1,000 ms application callback-age and 500 ms local video/PCM residence limits are candidate engineering values added in this step; no verified POC-00 media-age hard value was available, so they are not prelocked values or product quality commitments. Audio graph residence and decoded-video `performance.now()` residence are local queue measurements, not source, network, background wall-clock, or end-to-end media age. The slow receiver's existing VP8 pending-decode guard still stops that receiver's watch and clears its decoder when saturated; it does not discard arbitrary delta frames and continue decoding.

Run the focused deterministic queue/budget contracts with `node --test tests/transport-budget.test.mjs tests/playback-queue.test.mjs` using the repository's pinned Node 26.13.0. For the three-Firefox synthetic demonstration, start the trusted local HTTPS/WSS server with the intended managed host token and locked meeting-room password, then run `node scripts/slow-receiver-smoke.mjs`. Set `SLOW_RECEIVER_TEST_HOST_TOKEN` and `SLOW_RECEIVER_TEST_ROOM_PASSWORD`; optional settings are `SLOW_RECEIVER_OUTPUT_DIR` (defaults to `.scratch/t14/acceptance`), `SLOW_RECEIVER_BASE_URL` (defaults to `https://localhost:4173`), `SLOW_RECEIVER_CA_CERT` (defaults to `.scratch/t01/tls/local-ca.pem`), and `HEADLESS=0` to show Firefox. The script uses three isolated trusted Firefox profiles and a slow-receiver-only Playwright server-to-browser hold capped at 256 KiB and 128 messages; it explicitly closes both test-route endpoints with application code `4003` at its 500 ms age limit and drops held driver data. The healthy receiver is checked for repeated increasing samples/frames and a responsive control acknowledgement during the hold; the slow receiver is checked after reconnect for fresh control/configuration and actual playback. This route demonstration exercises an independently bounded driver queue and T13 recovery; server send-pressure policy is checked separately through deterministic socket/callback seams; it does not induce the client audio decoder's eight-pending saturation branch. These application-layer checks do not establish real TCP loss, phone or OS background behavior, human listening, p95 quality, capacity, long-run stability, or full POC-04 acceptance.

### T15: integrated two-room recovery and revocation

`node scripts/integrated-session-smoke.mjs` runs a short integration scenario against an already running trusted local HTTPS/WSS application. Start the app in managed mode with `HOST_CONTROL_TOKEN` and `MEETING_ROOM_PASSWORD`; pass matching `INTEGRATED_TEST_HOST_TOKEN` and `INTEGRATED_TEST_ROOM_PASSWORD` to the runner. It requires the pinned Node 26.13.0, Firefox, `certutil`, and the local CA. Optional settings are `INTEGRATED_BASE_URL` (default `https://localhost:4173`), `INTEGRATED_CA_CERT` (default `.scratch/t01/tls/local-ca.pem`), `INTEGRATED_OUTPUT_DIR` (default `.scratch/t15/acceptance`), and `HEADLESS=0`. The runner does not start or stop the application server.

The four isolated Firefox profiles represent a meeting-room host receiving a granted participant's synthetic Opus/VP8, plus an open-area host publishing to a nearby receiver. The short flow checks both rooms playing, a controlled application connection close and fresh receive recovery, then host revocation and a revoked publisher reconnecting without reopening sources or restoring publishing permission. The healthy room is observed throughout the affected stages. Generated audio/canvas tracks and route injection exist only in the test runner; they do not use physical capture devices or change system CA trust.

This demonstrates the integrated operations and how to repeat them locally. A controlled application socket close is a timeout simulation, not a measured Cloud Run request timeout or TCP weak network. The short scenario does not establish 65-minute endurance, real phone/background behavior, physical network recovery, human listening, p95, capacity, or full POC-04 acceptance. Use the latest run's evidence under `docs/poc/evidence/` for the actual duration, failures, observations, and remaining work.

`INTEGRATED_HOLD_SECONDS` optionally extends real active-room time (0–4200 seconds, default 0). This run did not execute that extended branch; a 65-minute attempt also needs a suitable external process timeout and additional observation.

### T16: small single-room media fan-out

Start the managed local HTTPS/WSS app with `HOST_CONTROL_TOKEN` and `MEETING_ROOM_PASSWORD`, then run `node scripts/single-room-fanout-smoke.mjs` with matching `FANOUT_TEST_HOST_TOKEN` and `FANOUT_TEST_ROOM_PASSWORD` in the process environment. Use pinned Node 26.13.0, Firefox, `certutil`, and the existing trusted local CA. Optional settings are `FANOUT_BASE_URL` (default `https://localhost:4173`), `FANOUT_CA_CERT` (default `.scratch/t01/tls/local-ca.pem`), `FANOUT_OUTPUT_DIR` (default `.scratch/t16/acceptance`), and `HEADLESS=0`. The runner expects an already running app and cleans up its own Firefox profiles.

The short scenario starts one synthetic Opus/VP8 publisher in the meeting room, first with one real Firefox receiver, then with three. It checks actual decoded AudioWorklet/canvas output and each receiver's traffic, normal unsubscribe without interrupting the other receivers, and publisher stop. Sources are generated oscillator/canvas tracks; the receivers really decode and render. There are no socket-only load clients. Reports distinguish application send counters, received bytes, and rendered media; local queue observations are not end-to-end latency.

This is a small local feasibility check. It does not establish 10/25/50-person capacity, 20-minute stability, physical capture or human listening, phone behavior, p95, or Cloud Run performance. See the latest POC-05 run for the actual participant count, stage times, test results, hardware, and measurement limits.

### T17: small two-room mixed participation

Start the managed trusted local HTTPS/WSS app with `HOST_CONTROL_TOKEN` and `MEETING_ROOM_PASSWORD`, then run `node scripts/two-room-mixed-smoke.mjs` with matching `MIXED_TEST_HOST_TOKEN` and `MIXED_TEST_ROOM_PASSWORD` in the process environment. Use pinned Node 26.13.0, Firefox, `certutil`, and the existing local CA. Optional settings are `MIXED_BASE_URL` (default `https://localhost:4173`), `MIXED_CA_CERT` (default `.scratch/t01/tls/local-ca.pem`), `MIXED_OUTPUT_DIR` (default `.scratch/t17/acceptance`), and `HEADLESS=0`. The runner expects an already running server and cleans up its own Firefox profiles.

Six isolated Firefox instances represent one publisher, one actual audio/video receiver, and one interaction-only participant in each room. The sources are generated oscillator/canvas tracks; receivers really decode and render. The short flow compares media receipt with server self-inspection, checks that interaction-only participants receive no media while feedback remains usable, and exercises watch → interaction-only → watch with explicit manual receive controls. Media-message hashes support source separation without retaining raw media. This is a small local core check, not a 50-person, 20-minute, physical-device, p95, or Cloud Run capacity result; use the latest POC-05 run for actual scope, outcomes, failures, and limits.

### T18: owned-process restart and recovery semantics

Build the app first with pinned Node 26.13.0. `node scripts/process-restart-smoke.mjs` owns the lifecycle of its local application child processes; run it with the target port free, rather than starting another server there first. It must refuse an existing service and only stop processes it spawned. Set `RESTART_TEST_HOST_TOKEN`, `RESTART_TEST_ROOM_PASSWORD` (startup password A), `RESTART_TEST_LIVE_PASSWORD` (a distinct runtime password B), and the local `TLS_CERT_FILE` / `TLS_KEY_FILE` in the process environment. Firefox, `certutil`, and the trusted local CA are required. Optional settings are `RESTART_BASE_URL` (default `https://localhost:4173`), `RESTART_CA_CERT`, `RESTART_OUTPUT_DIR` (default `.scratch/t18/acceptance`), and `HEADLESS=0`.

The three-browser scenario observes active synthetic Opus/VP8 and room control across a real application stop and a new process start with the same startup configuration. It distinguishes fixed scene reconstruction, rejection of old resume credentials, new participant identities, fresh host claims, manually restarted sources, and data that is absent after restart. Changing the live room password before the restart makes the difference between startup configuration and unsaved runtime state observable.

This describes the historical 2026-11-05 T18/R001 run, before PostgreSQL persistence was implemented: that run observed process-memory loss and remains valid evidence of its tested build. The PostgreSQL 18 local path is documented above; it does not rewrite T18's result or establish production backups, database hosting, or Cloud Run recovery. Keep credentials out of command history and retained evidence.
