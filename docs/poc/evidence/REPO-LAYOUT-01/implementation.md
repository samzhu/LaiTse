# REPO-LAYOUT-01 implementation handoff

Date: 2026-11-06

## Changes

- Moved the runnable POC assets into `poc/`: `src/`, `public/`, `scripts/`, `tests/`, `db/`, `vite.config.ts`, all three `tsconfig*.json` files, `index.html`, `compose.yaml`, and `.env.example`.
- Added `poc/package.json` with the existing exact dependency versions. The root `package.json` is now a private npm workspace root for `poc` and forwards the existing `build`, `start`, `typecheck`, test, TLS, e2e, and license commands. `package-lock.json` remains the only lockfile and now records both workspace manifests.
- Added `apps/web/README.md` to mark the future MVP app as not implemented. Added a short POC usage guide at `poc/README.md`; the root README and historical guide were handled by the root writer.
- Added `poc/scripts/lib/project-paths.mjs` with separate `repositoryRoot` and `pocRoot` exports. Each script entrypoint explicitly calls `enterRepositoryRootForLegacyScript()` to keep historical `.scratch/`, `.tools/`, and repository-relative environment path behavior stable from arbitrary caller directories. Process/database restart scripts resolve and spawn `poc/dist/server/index.js` with `pocRoot` as cwd; dependency inventory reads the POC manifest and the single root lockfile.
- Kept relative test imports and migration lookup relationships intact. The app's default static client directory now resolves beside the compiled server output, or to `poc/dist/client` when loaded from source, rather than following an unrelated caller cwd.
- Added ignore entries for `poc/dist/` and `.scratch/layout01/`. Local env documentation identifies the root `.env` and sample host token as POC-only settings and directs anonymous PG tests to the dedicated `laitse_poc_test` database.

## Path mapping

- `src/` → `poc/src/`
- `public/` → `poc/public/`
- `scripts/` → `poc/scripts/`
- `tests/` → `poc/tests/`
- `db/` → `poc/db/`
- `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.server.json`, `index.html`, `compose.yaml`, `.env.example` → same names under `poc/`
- `package.json` remains at root as the private workspace entry; former POC manifest is now `poc/package.json`; root `package-lock.json` remains the only lockfile.

## Evidence

- `npm install --package-lock-only --ignore-scripts --no-audit --no-fund --offline` using the pinned Node 26.13.0 toolchain completed successfully. A static readback confirmed the root workspace and lockfile workspace entry, and exact dependency/devDependency maps match `poc/package.json`.
- Root `npm run build` passed through `npm run --workspace=poc build`; client and server typecheck passed, Vite emitted `poc/dist/client`, and TypeScript emitted `poc/dist/server`. Vite reported its existing large-chunk advisory for Phaser.
- `node --check` passed for all 31 `poc/scripts/**/*.mjs` modules.
- Importing `project-paths.mjs` from `/private/tmp` returned the repository and POC roots and left the caller process cwd unchanged. Legacy CLI entrypoints opt into the repository cwd explicitly.
- Saved and read back this handoff at `.scratch/layout01/implementation.md`.

## Not run / limits

- No unit/integration test suite, PostgreSQL suite, browser run, app server, Docker/DB command, or manual 4173/4174 service was started. Root owns npm ci, full PG suite, and isolated 4175 browser validation.
- No Git mutation was performed. Existing ignored root `dist/`, root `node_modules/`, `.tools/`, `.scratch/`, and any root `.env` were not moved or deleted; the build output is under `poc/dist/`.
- The MVP remains unimplemented; no MVP package or product code was added. Product behavior, auth/anonymous access, media handling, and persistence semantics were not intentionally changed.
