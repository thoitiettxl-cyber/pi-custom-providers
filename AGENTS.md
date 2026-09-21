# Contributor notes (agents)

## Layers (Bridge / MyInjector)

- **Entry** — `pi.extensions` + each `providers/*/index.ts` `export default` async factory.
- **Bridge** — stable `ExtensionAPI` + native `streamSimple(model, context, options)` contract; shared native factory shapes.
- **Adapter** — `shared/omp-thin.ts` (catalog + optional omp OAuth only), `*-native.ts` / `shared/native-*.ts` (HTTP/SSE/Connect → events), shims.
- **Handler** — provider package wiring; must not import `@oh-my-pi/pi-ai/providers/*`.

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) and [docs/plans/active/01-ARCHITECTURE-bridge.md](./docs/plans/active/01-ARCHITECTURE-bridge.md).

## Continuity dual-authority

Stream / Bun / omp-provider bugs are fixed **in this repo** (native adapter). Do **not** patch `pi-continuity-work-memory` for provider stream issues. See [docs/CONTINUITY-BOUNDARY.md](./docs/CONTINUITY-BOUNDARY.md).

## Rules

- **Host:** earendil/Pi **0.86.x** loads extensions with **Node + jiti** (not Bun). Always smoke with Node/jiti.
- **Peers only:** never put `@earendil-works/pi-ai|coding-agent|agent-core|tui` or `typebox` in `dependencies`. Use `peerDependencies: "*"`. Local tests may pin them in `devDependencies`.
- **omp in dependencies:** `@oh-my-pi/pi-ai` + `@oh-my-pi/pi-catalog` with **caret** for **catalog + OAuth login hooks** only. Catalog protobuf (`discovery/*-proto`) OK for Connect codecs.
- **Streams must be native** — do **not** import omp `pi-ai` provider stream modules. Prefer `shared/native-*.ts` or provider `*-native.ts`. Pass `streamSimple`; bare `loadStreamFn` hard-errors.
- **Update loop:** Dependabot PRs for `@oh-my-pi/*` → merge → user `pi update --extensions` (unpinned git install). Stream fixes require commits in this repo.
- **Manifest:** root `package.json` → `pi.extensions` lists `./providers/<name>` directories.
- **Secrets:** never commit `auth.json`, `.env`, `.env.local`, tokens.
- **New oauth provider:** prefer `registerThinOmpProvider` + native `streamSimple`; document skip reasons in `docs/SKIPPED-PROVIDERS.md`.

## Before ship

1. `bun run check:boundary` — **required** (also runs via `pretest` / `test`)
2. `bun run smoke:node`
3. `bun run test` (hybrid unit tests)
4. Then commit/push
