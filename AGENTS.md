# Contributor notes (agents)

- **Host:** earendil/Pi **0.86.1** loads extensions with **Node + jiti** (not Bun). Always smoke with Node/jiti.
- **Peers only:** never put `@earendil-works/pi-ai|coding-agent|agent-core|tui` or `typebox` in `dependencies`. Use `peerDependencies: "*"`. Local tests may pin them in `devDependencies` (Pi install uses `npm install --omit=dev`).
- **omp in dependencies:** `@oh-my-pi/pi-ai` + `@oh-my-pi/pi-catalog` with **caret** ranges for **catalog + OAuth login hooks** only. **Streams must be native** (`shared/native-openai-responses.ts`, `shared/native-anthropic-messages.ts`, or provider `*-native.ts` / clear unavailable) — do **not** `importOmp("@oh-my-pi/pi-ai/providers/*")` for streaming.
- **Update loop:** Dependabot PRs for `@oh-my-pi/*` → merge → user `pi update --extensions` (unpinned git install).
- **Entry:** each provider `index.ts` must `export default` an async `(pi: ExtensionAPI) => …` factory.
- **Manifest:** root `package.json` → `pi.extensions` lists `./providers/<name>` directories.
- **Secrets:** never commit `auth.json`, `.env`, `.env.local`, tokens.
- **Before ship:** `bun run test` (hybrid), `bun run smoke:node`, then commit/push.
- **New oauth provider:** prefer `registerThinOmpProvider`; add workspace + `pi.extensions`; document skip reasons in `docs/SKIPPED-PROVIDERS.md`.
