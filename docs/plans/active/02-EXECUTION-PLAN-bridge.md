# Execution plan: Bridge architecture enforcement

Depends on: `01-ARCHITECTURE-bridge.md`  
Repo: `pi-custom-providers`

## Phase 0 — Spec (this PR start)

- [x] Write `01-ARCHITECTURE-bridge.md`
- [x] Write this execution plan
- [x] Rewrite `docs/ARCHITECTURE.md` as the canonical short map (link to plans)
- [x] Update `AGENTS.md` + root `README.md` with layer + Continuity rule

## Phase 1 — Boundary enforcement (code)

- [x] 1. Add `scripts/check-bridge-boundary.mjs`:
   - Scan `providers/**/*.ts`, `shared/native-*.ts`, `shared/xai-oauth-native.ts`
   - Fail on any match of `@oh-my-pi/pi-ai/providers` (static import, dynamic string, or `importOmp("...providers...")`)
   - Allowlist: none (codecs stay under `@oh-my-pi/pi-catalog`)
- [x] 2. Wire `"check:boundary": "node scripts/check-bridge-boundary.mjs"` in `package.json`
- [x] 3. Call it from `"test"` / `pretest`; document in AGENTS.md
- [x] 4. In `shared/omp-thin.ts`: remove `loadStreamFn` / `createOmpStreamSimple`; missing native `streamSimple` throws

## Phase 2 — Docs alignment

1. Per-provider README one-liner: "handler → bridge streamSimple → native adapter; omp = catalog/OAuth only" *(follow-up)*
- [x] 2. `CHANGELOG.md` entry under Unreleased
- [x] 3. `docs/CONTINUITY-BOUNDARY.md` (short) stating Continuity must not be patched for stream/Bun issues

## Phase 3 — Verify

1. `bun run check:boundary` → exit 0
2. `bun run smoke:node` → exit 0
3. `bun run test` (hybrid) as available
4. Commit on branch `docs/bridge-architecture`, open PR, merge when green

## Phase 4 — Follow-ups (out of this PR unless cheap)

- Prefer more `oauthFactory` native ports when omp registry breaks under jiti (pattern: `xai-oauth-native.ts`)
- Dependabot-only bumps for `@oh-my-pi/*`; never bump by rewriting streams
- Continuity dual-authority work stays in `pi-continuity-work-memory` plans, not here

## Done when

- Spec files merged
- Boundary script green in CI/local
- No omp stream imports remain enforceable by script
- PR linked from chat
