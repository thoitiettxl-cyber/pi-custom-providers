# Contributor notes (agents)

- **Host:** earendil/Pi **0.86.1** loads extensions with **Node + jiti** (not Bun). Always smoke with Node/jiti.
- **Peers only:** never put `@earendil-works/pi-ai|coding-agent|agent-core|tui` or `typebox` in `dependencies`. Use `peerDependencies: "*"`. Local tests may pin them in `devDependencies` (Pi install uses `npm install --omit=dev`).
- **Optional omp:** `@oh-my-pi/*` stays in `optionalDependencies` for cursor/devin shim; antigravity must not require it for stream.
- **Entry:** each provider `index.ts` must `export default` an async `(pi: ExtensionAPI) => …` factory.
- **Manifest:** root `package.json` → `pi.extensions` lists `./providers/<name>` directories (smart discovery → nested `index.ts`).
- **Secrets:** never commit `auth.json`, `.env`, `.env.local`, tokens.
- **Before ship:** `bun run test`, `bun run smoke:node`, isolated `PI_CODING_AGENT_DIR=… pi install .`, then commit/push.
- **New provider:** copy an existing `providers/*` folder, add to root `workspaces` + `pi.extensions`, document OAuth + stream engine in that folder’s README.
