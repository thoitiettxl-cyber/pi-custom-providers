# Contributor notes (agents)

- **Host:** earendil/Pi **0.86.1** loads extensions with **Node + jiti** (not Bun). Always smoke with Node/jiti.
- **Peers only:** never put `@earendil-works/pi-ai|coding-agent|agent-core|tui` or `typebox` in `dependencies`. Use `peerDependencies: "*"`. Local tests may pin them in `devDependencies` (Pi install uses `npm install --omit=dev`).
- **omp in dependencies:** `@oh-my-pi/pi-ai` + `@oh-my-pi/pi-catalog` with **caret** ranges. Prefer thin wrappers via `shared/omp-thin.ts` — do not vendor oauth/stream when omp exports hooks.
- **Update loop:** Dependabot PRs for `@oh-my-pi/*` → merge → user `pi update --extensions` (unpinned git install).
- **Entry:** each provider `index.ts` must `export default` an async `(pi: ExtensionAPI) => …` factory.
- **Manifest:** root `package.json` → `pi.extensions` lists `./providers/<name>` directories.
- **Secrets:** never commit `auth.json`, `.env`, `.env.local`, tokens.
- **Before ship:** `bun run test` (hybrid), `bun run smoke:node`, then commit/push.
- **New oauth provider:** prefer `registerThinOmpProvider`; add workspace + `pi.extensions`; document skip reasons in `docs/SKIPPED-PROVIDERS.md`.
