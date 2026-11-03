# LaiTse local POC baseline

This is the T01/T02/T03 local POC baseline. One Fastify process serves the built React page, the health and room APIs, and a WebSocket endpoint. The room flow is deliberately small: participants can join one local room and observe the same member list and bounded control events. T03 adds a native Opus publish path through that same socket for members who explicitly start listening.

This is an experiment, not the product or the MVP. It creates no cloud resources and uses no external service. Its state is volatile process memory.

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

Direct runtime packages are `fastify@5.12.8`, `@fastify/websocket@11.3.6`, `@fastify/static@10.1.8`, `react@19.3.1`, and `react-dom@19.3.1`. The client build, type checking, integration harness, and Playwright browser script use pinned development packages in `package.json`. Project metadata declares Apache-2.0 to match the existing `LICENSE` file.

## Build and run

With the pinned Node runtime on `PATH`:

```sh
npm run typecheck
npm run test:integration
npm run build
npm start
```

By default the app listens on `http://127.0.0.1:4173`. It serves the built page at `/`, a health response at `/api/health`, the fixed room catalogue at `/api/rooms`, and the control WebSocket at `/ws`. `HOST` and `PORT` can change the listen address. The default binds only to loopback.

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

The server accepts one fixed room, `lobby` (`Local test room`). A client must join with a display name of 1–32 printable characters. The room is limited to eight connected members. Room reactions accept only `wave`, `clap`, or `heart`; T03 audio controls separately handle explicit subscribe, start, and stop requests. The server assigns a process-wide sequence number to join, leave, and reaction events and broadcasts them to current room members.

WebSocket connections must have an Origin matching the request's scheme and host. Malformed, unknown, or invalid control frames close the connection. Regular control frames are limited to 1 KiB, accepted reactions to 10 per connection per second, and slow receivers are closed once queued output exceeds 64 KiB. T03 binary frames use a separate fixed audio header and are accepted only from the current publisher. The page keeps only the most recent 20 room events for display.

Capability reports use a separate, fixed schema with an 8 KiB WebSocket frame limit; regular room controls remain limited to 1 KiB. A joined connection can explicitly send one report, which the server associates with its own connection ID, joined member, room, observation ID, and server time. The server validates and stores at most the latest 64 reports in process memory. `GET /api/observations/:id` is unauthenticated in this local POC; the random observation ID is a lookup key, not an authorization system. Keep this server on a private development LAN and stop it after the test. The codec and API values are browser-reported; the server does not independently verify them.

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

## Data classification and limitations

- **Fixed, versioned setup:** the one-room catalogue and its display name are source constants in `src/server/app.ts`; a build from the same source reconstructs them.
- **Execution-time data:** current members, connection membership, the event sequence, active audio publisher generation, and explicit audio subscriptions exist in server process memory. A disconnect removes that participant and stops its stream. These values clear when the server process stops or is replaced. The visible recent-event list and playback counters exist only in page memory and clear when the page reloads or the participant leaves.
- **Not durable:** there is no database, file persistence, identity system, authorization/role model, event history, or cross-process coordination. A future multi-instance Cloud Run deployment would give instances separate memory and can lose all current state on replacement. This local result does not establish a persistence or Cloud Run recovery design.
- **Not implemented in this ticket:** screen sharing, avatar movement, authentication, room management, production capacity, and phone verification. T03's local one-publisher audio path does not establish mobile support, multi-instance media routing, or durable media storage.

## Focused commands

```sh
npm run typecheck
npm run test:integration
node --test tests/*.test.mjs
npm run build
npm run licenses
```

The focused integration suite exercises the API and real WebSocket connections from Node clients, including room membership, shared sequenced events, invalid origins, invalid messages, and payload bounds. The Playwright script separately uses actual Firefox browser processes for the two-client page flow. It does not replace later real-device media or capacity experiments.

## Recorded verification

[POC-00-R001](docs/poc/evidence/POC-00-R001/README.md) preserves the original Firefox launch failure. R002 records the final two-browser acceptance with private application-data directories; the authoritative status and remaining stage requirements are in [the execution log](docs/poc/execution-log.md). On macOS an automation sandbox may prevent Firefox from launching; run the test from a normal local terminal. Do not substitute certificate-ignore flags. Runtime dependencies remain stable releases; the diagnostic prerelease browser was rejected and is unused.

[T03 POC-01-R001](docs/poc/evidence/POC-01-R001/README.md) records synthetic Opus encode/relay/decode/render, simulated denial, stop, and the first-run cleanup failure and correction. Real microphone and human listening remain pending. `npm run test:integration` retains the original T01 subset; `node --test tests/*.test.mjs` covers all current T01–T03 core integration cases.
