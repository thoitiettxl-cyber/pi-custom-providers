# Changelog

## Unreleased

### Added
- Thin omp OAuth wrappers: `google-gemini-cli`, `gitlab-duo`, `gitlab-duo-agent`, `openai-codex-device`, `muse-code`, `zai-coding-plan` (`shared/omp-thin.ts`).
- `@oh-my-pi/pi-ai` + `pi-catalog` moved to **dependencies** with caret `^18.2.6`.
- `.github/dependabot.yml` for `@oh-my-pi/*`; `scripts/sync-omp-version.mjs`.
- README “Staying current with omp”; `docs/SKIPPED-PROVIDERS.md`.

### TypeSafe
- `dependabot_omp_deps` + `thin_omp_reexport` + `missing_minus_pi_builtins` (jev-1.13.0).

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
