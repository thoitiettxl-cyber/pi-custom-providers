# Changelog

## Unreleased

### Changed
- **Native streams (Gemini-style fetch/SSE):** all providers stop using `@oh-my-pi/pi-ai/providers/*` for streaming.
  - Added `shared/native-openai-responses.ts` (xai-omp, muse-code) and `shared/native-anthropic-messages.ts` (zai-coding-plan, gitlab-duo).
  - `gemini-antigravity` remains on `cca-native.ts`.
  - `cursor` / `devin` / `google-gemini-cli` / `openai-codex-device` / `gitlab-duo-agent`: Connect/WS wires too large — clear native-unavailable error, **no omp stream fallback**.
  - `registerThinOmpProvider` accepts native `streamSimple` (preferred over `loadStreamFn`).
  - `scripts/smoke-xai-omp-pong.mjs` uses native Responses stream.
  - Do **not** touch Continuity (reset to 305e3e87 on dev-next).


### Fixed
- **Continuity memory / interactive path under Node:** expand `import.meta.dir`/`path` rewrite in `shared/bun-shim.ts` to `@oh-my-pi` `file:` modules (not only jiti `data:` URLs). Forward `sessionId` / `cacheRetention` / `maxTokens` / `reasoningEffort` from Pi `complete` options through `createOmpStreamSimple` so Continuity `PiMemoryProvider.extract` matches the interactive stream path.

- **`pi -p` under Node:** loading `@oh-my-pi/pi-ai` TypeScript from `node_modules/.bun` failed with `Stripping types is currently unsupported for files under node_modules`. Added `shared/omp-import.ts` (`importOmp`) — real Bun uses native `import()`, Node loads via **jiti**. All provider/shared dynamic `@oh-my-pi/*` imports go through it. `jiti` is a **runtime** dependency so `pi install` gets it.

- **omp stream under Node+jiti (cursor + xai-omp):** `ERR_INVALID_ARG_TYPE` / `path` undefined and `model.compat.*` crashes when Pi loads `@oh-my-pi` streams.
  - `shared/bun-shim.ts`: polyfill `import.meta.dir`/`path` for jiti `data:` modules; stub `bun` / `bun:ffi` / `bun:sqlite`; `Bun.hash.wyhash`; set `PI_CODING_AGENT_DIR` to `~/.pi/agent` before omp import; Bun text `*.md` load hook.
  - `shared/omp-thin.ts`: preserve catalog `compat` + `identity` through `loadCatalogModels` / `toProviderModels`; `createOmpStreamSimple` always passes `compat: model.compat ?? {}` and `identity` (openai-responses requires `model.compat.*`).
  - `providers/cursor`: re-export shared shim; stamp `compat`/`identity` on registered models and `toOmpModel`.
  - gemini-antigravity unchanged (native CCA, no omp stream).

### Docs / guardrails
- **`xai-omp` refresh-token rotation:** refreshing the same SuperGrok OAuth grant on two machines (laptop + agent/CI/box smoke) rotates/revokes the previous refresh token → `invalid_grant`. After any shared-grant refresh, either `/login xai-omp` again on the other machine **or** copy the **post-refresh** `xai-omp` entry from the machine that refreshed (never share one refresh token concurrently). See `providers/xai-omp/README.md`, `INSTALL-VI.md`, `scripts/export-xai-omp-auth-hint.md`.
- **`scripts/check-xai-omp-auth.mjs`:** reports whether box/local `xai-omp` access is usable (expires ISO, lengths only — no token dump) so you know when a copy is possible.

### Fixed
- **`xai-omp` OAuth refresh:** no longer depends on `@oh-my-pi/pi-ai/registry` `getProviderDefinition` (missing under Node/jiti). Native SuperGrok device OAuth in `shared/xai-oauth-native.ts` (same client/tokens as Pi first-party `xai`). `ThinProviderOptions.oauthFactory` skips `makeOmpOAuth` when set. Clearer error if other thin providers hit a missing registry export.

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
