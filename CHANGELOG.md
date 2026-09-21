# Changelog

## Unreleased

### Added
- **Remaining native streams (no omp stream fallback):**
  - `google-gemini-cli` → `gemini-cli-native.ts` (CCA fetch/SSE, GeminiCLI headers, `cloudcode-pa.googleapis.com`)
  - `openai-codex-device` → `codex-native.ts` (Codex `/codex/responses` SSE + account-id/beta headers)
  - `gitlab-duo-agent` → native Anthropic Messages via GitLab AI Gateway (full Duo Workflow WS deferred; documented)
  - `cursor` → `cursor-native.ts` HTTP/2 Connect `AgentService/Run` + catalog protobuf + local exec-handlers
  - `devin` → `devin-native.ts` Connect HTTP/1.1 `GetChatMessage` + catalog protobuf
- Removed unused `shared/native-unavailable-stream.ts`.
- Docs: README provider table, INSTALL-VI, ARCHITECTURE, SKIPPED-PROVIDERS, AGENTS, per-provider READMEs.

### Notes
- Live smoke: xai-omp + google-antigravity when auth present; cursor/devin skip live without auth but register + proto load must pass `smoke:node`.

## 0.86.1 — 2026-09-20

### Added
- Installable Pi package (`pi-package`) with `pi.extensions` for cursor, devin, and gemini-antigravity.
- Peer-only `@earendil-works/*` + `typebox` (Pi jiti aliases; not bundled).
- Optional `@oh-my-pi/*` for cursor/devin stream shim path.
- Docs: README (EN), INSTALL-VI.md, docs/ARCHITECTURE.md, AGENTS.md, MIT LICENSE.
- Scripts: `link-extensions.sh` (dev symlink), `smoke-node-jiti.mjs`, `smoke-stream-pong.mjs`.

### Notes
- Primary install path: `pi install .` / `pi install git:github.com/thoitiettxl-cyber/pi-custom-providers`.
- Symlink workflow remains for local development.
- Cursor/Devin live stream still hybrid (bun-shim + optional omp); Node-native Connect TBD.
- Gemini Antigravity uses Node-native CCA SSE (`cca-native.ts`).
