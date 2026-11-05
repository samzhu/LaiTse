# DEC-012 PostgreSQL implementation handoff

Date: 2026-11-05

## Implemented

PostgreSQL 18 is an optional local persistence mode for system information. With no `DATABASE_URL`, the existing process-memory mode remains available. With a URL, startup connects, applies the schema, hydrates saved state, checks the saved host-management mode against the environment, and acquires a PostgreSQL advisory lock before serving. The health endpoint reports the selected persistence mode and availability.

The persistence seam is `PostgresPersistence` in `src/server/persistence.ts`. The app serializes text control operations through a bounded executor. In PostgreSQL mode, output is staged while a control state transaction is pending; ACKs and broadcasts flush only after the persistence transaction commits. The staged output has byte and frame-count caps. On a transaction or lock loss, the app closes and drops staged output. Binary media stays on its existing relay path and has no per-packet database writes. Room-list reads wait for the control executor before returning the current state.

`db/migrations/001_system_persistence.sql` defines the durable tables. Current room catalogue and media routing stay fixed in source. The saved data includes room lock verifier/salt and revision, interaction presentation settings, participant identity/role/mode/last position, resumable session digests and leases, interaction archive and dedup, moderation and host-action audit, capability observations, control event history, sequence numbers, and room activity counters.

## Important data behavior

- Room passwords are stored as salted verifiers. Raw session proofs are not stored; the database holds SHA-256 digests. Host tokens are not saved. The saved managed-host-mode boolean must match whether `HOST_CONTROL_TOKEN` is configured at startup; a mismatch fails startup. A configured host token may rotate while that boolean remains true.
- Startup clears active connection ownership. It does not create online members or restore host claims/publisher grants. A participant becomes online only after a valid proof is presented and current admission is rechecked. A successful resume restores the saved participant ID, mode, and last position. Leave/removal revokes the proof.
- Active database sessions use a ten-minute lease refreshed every minute. Restart recovery is valid only before the saved lease expires. This is a bounded crash-recovery lease; it is not the old in-memory store's exact disconnect-relative timeout behavior. Tests set expiry timestamps directly instead of waiting ten minutes.
- Interaction history rows are retained separately from their live projections. Public danmaku/feedback TTL and the top-50 history view control hydration, not archive deletion. `clearQueue` marks public projection items cleared while preserving history. `remove` writes a tombstone and excludes that item from later projections without deleting its archive row. The archive currently has no retention/compaction job.
- The room activity counters and sequence values persist without being re-added on restart. `/api/media-diagnostics`, transport queues, sockets, publisher/subscriber state, and raw media remain process/page-local.

## Local operation

`.env.example` uses `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `DATABASE_URL`, `HOST`, `PORT`, `MEETING_ROOM_PASSWORD`, and `HOST_CONTROL_TOKEN`. Its database password is an explicit local-only sample; copy it to ignored `.env` and replace the sample before use.

```sh
cp .env.example .env
# Edit .env and replace the sample password.
docker compose up -d postgres
npm run build
npm start
```

Compose uses `postgres:18.6-bookworm`, loopback host port `55432`, the `laitse-postgres18-data` named volume, and a TCP readiness check against `127.0.0.1`. `docker compose down` leaves the named volume intact. PostgreSQL is not required when `DATABASE_URL` is unset.

The exact runtime dependency is `pg@8.23.1`; `@types/pg@8.23.1` is a development dependency. `npm start` uses Node 26's `--env-file-if-exists=.env` to read the local environment file.

## PostgreSQL integration test

`tests/postgres.integration.test.mjs` is opt-in through `PG_TEST_DATABASE_URL`. It refuses any database name other than the dedicated `laitse_poc_test`, creates two random per-run schemas, and drops only those schemas. It does not drop, truncate, or recreate a database. The command is:

```sh
PG_TEST_DATABASE_URL='postgresql://user:password@127.0.0.1:55433/laitse_poc_test' npm run test:persistence
```

The test scenarios cover:

- persisted room password B surviving restart when startup still supplies A, plus current gate revalidation;
- same participant ID, mode, and position after proof resume; revoked and explicitly expired proofs are rejected;
- session digests rather than bearer values, host and publisher rights inactive after restart, and host grants/revokes recorded;
- chat, feedback statistics, danmaku TTL projection, clear-queue history, removal tombstone, deduplication, and counters without recounting on replay;
- saved capability observation and control events; a second active app rejected by the advisory lock;
- mismatch when a managed database restarts without the host token; transaction failure discards staged join output and writes no participant; and startup failure when the database is unreachable.

I ran the test's syntax check but did not connect it to PostgreSQL. The integration run, Docker startup, hard process-kill recovery, lock-backend termination, and browser restart scenario remain root-owned acceptance work. A graceful app restart is covered in the test source; it is not evidence of a hard-crash scenario. Root owns `scripts/database-restart-browser.mjs` and a separate lock/crash diagnostic; those files are outside this writer's scope.

## Verification performed by PG-IMPL

Runtime used: `.tools/node-v26.13.0-darwin-arm64/bin/node` v26.13.0 and npm 11.20.0.

- `npm run typecheck`: passed using the pinned Node 26.13.0 runtime.
- Pure-memory focused tests: 14/14 passed across `control-reconnect`, `interactions`, `room-access`, and `host-control` integration test files.
- `node --check tests/postgres.integration.test.mjs`: passed.
- PostgreSQL integration test, Docker/Compose, build, full existing suite, and browser acceptance: not run by this writer. Root owns those checks.

## Scope release and fingerprints

Source, database migration, PostgreSQL test, Compose, environment sample, and package manifest/lock were saved, read back, and stopped by PG-IMPL before root began its build/runtime work. These hashes identify the files at that source handoff; root may subsequently update its owned files during acceptance. They are not claims about any later root edits.

| File at PG-IMPL source handoff | SHA-256 |
| --- | --- |
| `src/server/app.ts` | `c512a23c59b19825307a930ca0575317b7621598d29318f3d2663fb2e17b1364` |
| `src/server/control-resume.ts` | `bf80cbdd9dd2e061a1a4b6d55d6ccf9ebc2f0128e287cb124a5b2624ae8b3a3c` |
| `src/server/interactions.ts` | `9a77d29c314568725d3c858312ffa88fff8609c6b4a4dffd6fe52af995429294` |
| `src/server/index.ts` | `88bfeb2e9c6fa36b4c8fe10ccacea7ab0587188e010c3bfda3bc9afbf27681df` |
| `src/server/persistence.ts` | `2189062d756dfd43de804c75f0a13d91646879b7dc7a904f43e13a2d4b5c26ae` |
| `src/server/room-access.ts` | `1aaf5f3f2ac16735d1c0f1e57fdb31f799ef5f57a54c4e94657812da10fa229f` |
| `src/server/serial-executor.ts` | `ab997f63f62f5534c39ed31538961fa80a44cb54686acb97891055120378dda9` |
| `src/server/space.ts` | `210c137248b5972a4f12b369e4d551dc07acea649b94255faf23096080be777b` |
| `db/migrations/001_system_persistence.sql` | `96567869e8b53649e3fbb26e3994dd3c4fd497cb2daa86277fe302285091ae18` |
| `tests/postgres.integration.test.mjs` | `54265e88b2530f2802ba63b448b254c7ca9a9998663bd8ea7989d73c6885dcbb` |
| `compose.yaml` | `e332b6e9059c22773cb829bd1223fbbaed92714c2183adb3aa650d05fd10963b` |
| `.env.example` | `f898ed01244502c74e588e7a194d892ee680076de05e28a430ea17f388f56850` |
| `package.json` | `495d54b24d9f9213af262a15b49b2c37e61ab71d56e8fb8f92f401946efe80a1` |
| `package-lock.json` | `00cc298a122ec085794e406c3e962326fd608031481a28f4dfe448c76ddb0eb4` |

This authoring note is local ignored handoff material. Its own final hash is reported with the readback to the coordinator rather than embedded recursively here.
