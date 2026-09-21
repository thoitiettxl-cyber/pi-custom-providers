# Changelog

## Unreleased

### Fixed
- **baseUrl on custom models:** `toProviderModels` / `registerThinOmpProvider` always stamp provider default `baseUrl` (and `api`) onto every model when the catalog entry omits them — fixes Pi `validateExtensionProvider` error `"baseUrl" is required when defining custom models` (seen on `gitlab-duo` after empty/partial catalog).
- **Catalog resolve after `pi install`:** `resolveModelsJsonPath` no longer uses export-fragile `require.resolve(.../package.json)`; walks `require.resolve.paths` + parent `node_modules` so git install layouts under `~/.pi/agent/git/...` find `@oh-my-pi/pi-catalog`.
- Hybrid providers (`cursor`, `devin`, `gemini-antigravity` + CCA native) now set per-model `baseUrl`/`api` explicitly.
- Thin providers ship `fallbackModels` with `baseUrl` when the omp catalog bucket is empty.
- Smoke (`scripts/smoke-node-jiti.mjs`) calls earendil `validateExtensionProvider` and asserts every model has `baseUrl`.

### Notes / residual risk
- If `~/.pi/agent/models.json` defines the same provider with custom `models` and no `baseUrl`, Pi's `applyModelsJson` still throws **before** extension defaults apply — add `baseUrl` there or remove the block.


### Changed
- **`xai-omp`:** OAuth-web catalog only — `catalogId: "xai-oauth"` (~9 SuperGrok picker models). Removed `extraCatalogIds: ["xai"]` (no paid API-key `xai` union ~31). `ompProviderId` set to `xai-oauth` for SuperGrok stream shaping. Fallback models limited to oauth catalog ids (dropped `grok-code-fast-1`).

### Added
- **`xai-omp` thin provider:** SuperGrok OAuth-web catalog (`xai-oauth` only) via `registerThinOmpProvider`; provider id does not collide with Pi first-party `xai`. Login `/login xai-omp` (omp auth `xai-oauth`). `ThinProviderOptions` gains `extraCatalogIds`, `catalogLimit`, optional `storeCredentialsAs` (docs hint — Pi stores under provider id).
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
