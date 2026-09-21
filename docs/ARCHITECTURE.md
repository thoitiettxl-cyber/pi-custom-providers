# Architecture

## Purpose

Ship custom chat providers for earendil/Pi 0.86.x as **one installable package**, tracking omp via thin wrappers + Dependabot.

| Provider id | Folder | Style |
|-------------|--------|-------|
| `cursor` | `providers/cursor` | Hybrid bun-shim + omp `streamCursor` |
| `devin` | `providers/devin` | Hybrid bun-shim + omp `streamDevin` |
| `google-antigravity` | `providers/gemini-antigravity` | Node-native CCA SSE |
| `google-gemini-cli` | `providers/google-gemini-cli` | Thin omp |
| `gitlab-duo` | `providers/gitlab-duo` | Thin omp |
| `gitlab-duo-agent` | `providers/gitlab-duo-agent` | Thin omp |
| `openai-codex-device` | `providers/openai-codex-device` | Thin omp |
| `muse-code` | `providers/muse-code` | Thin omp |
| `zai-coding-plan` | `providers/zai-coding-plan` | Thin omp |
| `xai-omp` | `providers/xai-omp` | Thin omp stream + **native** SuperGrok OAuth |

## TypeSafe (2026-09-20)

- `update_strategy=dependabot_omp_deps`
- `wrapper_style=thin_omp_reexport`
- `scope_add=missing_minus_pi_builtins`

## Thin wrappers

`shared/omp-thin.ts`:

1. `getProviderDefinition(id)` from `@oh-my-pi/pi-ai/registry` → login / refresh / getApiKey
2. Adapt earendil `OAuthLoginCallbacks` → omp controller
3. `streamSimple` → literal dynamic import of omp stream export + event retarget
4. Models from `@oh-my-pi/pi-catalog` `models.json`

Do **not** vendor full oauth/stream copies when omp exports the hooks.

**Exception — `xai-omp`:** auth uses `shared/xai-oauth-native.ts` (Pi-compatible SuperGrok device OAuth) via `ThinProviderOptions.oauthFactory`, because Node/jiti often cannot load omp registry TS exports. Stream still imports omp `streamOpenAIResponses`.

## Dependencies

```json
"dependencies": {
  "@oh-my-pi/pi-ai": "^18.2.6",
  "@oh-my-pi/pi-catalog": "^18.2.6"
},
"peerDependencies": {
  "@earendil-works/pi-ai": "*",
  "@earendil-works/pi-agent-core": "*",
  "@earendil-works/pi-coding-agent": "*",
  "@earendil-works/pi-tui": "*",
  "typebox": "*"
}
```

Caret + Dependabot ⇒ `pi update --extensions` on unpinned git install advances omp without manual re-ports.

## Bun vs Node

Published Pi uses Node+jiti. Install `shared/bun-shim.ts` before omp imports. Some streams (e.g. gitlab-duo-agent WebSocket) may still prefer a real Bun host — document per provider README.
