# Contributor notes (agents)

- **Host:** earendil/Pi **0.86.x** loads extensions with **Node + jiti** (not Bun). Always smoke with Node/jiti.
- **Peers only:** never put `@earendil-works/pi-ai|coding-agent|agent-core|tui` or `typebox` in `dependencies`. Use `peerDependencies: "*"`. Local tests may pin them in `devDependencies`.
- **omp in dependencies:** `@oh-my-pi/pi-ai` + `@oh-my-pi/pi-catalog` with **caret** for **catalog + OAuth login hooks** only. Catalog protobuf (`discovery/*-proto`) OK for Connect codecs.
- **Streams must be native** — do **not** `importOmp("@oh-my-pi/pi-ai/providers/*")` for streaming. Prefer `shared/native-*.ts` or provider `*-native.ts`.
- **Update loop:** Dependabot PRs for `@oh-my-pi/*` → merge → user `pi update --extensions` (unpinned git install). Stream fixes require commits in this repo.
- **Entry:** each provider `index.ts` must `export default` an async `(pi: ExtensionAPI) => …` factory.
- **Manifest:** root `package.json` → `pi.extensions` lists `./providers/<name>` directories.
- **Secrets:** never commit `auth.json`, `.env`, `.env.local`, tokens.
- **Before ship:** `bun run test` (hybrid), `bun run smoke:node`, then commit/push.
- **New oauth provider:** prefer `registerThinOmpProvider` + native `streamSimple`; document skip reasons in `docs/SKIPPED-PROVIDERS.md`.
