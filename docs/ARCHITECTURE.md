# Architecture

## Purpose

Ship custom chat providers for earendil/Pi 0.86.x as **one installable package**. Streams are **native** (no `@oh-my-pi/pi-ai/providers/*` stream imports). omp supplies catalog `models.json` + OAuth login hooks where not replaced by local oauth.

| Provider id | Folder | Stream engine |
|-------------|--------|---------------|
| `cursor` | `providers/cursor` | Native HTTP/2 Connect + protobuf (`cursor-native.ts`) |
| `devin` | `providers/devin` | Native Connect HTTP/1.1 + protobuf (`devin-native.ts`) |
| `google-antigravity` | `providers/gemini-antigravity` | Native CCA SSE (`cca-native.ts`) |
| `google-gemini-cli` | `providers/google-gemini-cli` | Native CCA SSE (`gemini-cli-native.ts`) |
| `gitlab-duo` | `providers/gitlab-duo` | Native Anthropic Messages (`shared/native-anthropic-messages.ts`) |
| `gitlab-duo-agent` | `providers/gitlab-duo-agent` | Native Anthropic Messages (HTTP gateway; Duo Workflow WS deferred) |
| `openai-codex-device` | `providers/openai-codex-device` | Native Codex Responses SSE (`codex-native.ts`) |
| `muse-code` | `providers/muse-code` | Native OpenAI Responses (`shared/native-openai-responses.ts`) |
| `zai-coding-plan` | `providers/zai-coding-plan` | Native Anthropic Messages |
| `xai-omp` | `providers/xai-omp` | Native OpenAI Responses + **native** SuperGrok OAuth |

## TypeSafe

- `update_strategy=dependabot_omp_deps` (OAuth/catalog)
- `stream_strategy=native_fetch_sse_or_connect`
- `scope_add=missing_minus_pi_builtins`

## Thin wrappers

`shared/omp-thin.ts`:

1. Optional `getProviderDefinition(id)` from `@oh-my-pi/pi-ai/registry` → login / refresh / getApiKey
2. Adapt earendil `OAuthLoginCallbacks` → omp controller
3. **`streamSimple` must be native** (preferred); `loadStreamFn` deprecated
4. Models from `@oh-my-pi/pi-catalog` `models.json` via fs

**Exception — `xai-omp`:** auth uses `shared/xai-oauth-native.ts` via `oauthFactory`.

Cursor/Devin use catalog protobuf codecs (`@oh-my-pi/pi-catalog/discovery/*-proto`) — still no `pi-ai/providers/*` stream import.

## Dependencies

```json
"dependencies": {
  "@oh-my-pi/pi-ai": "^18.2.6",
  "@oh-my-pi/pi-catalog": "^18.2.6",
  "jiti": "^2.7.0"
}
```

## Bun vs Node

Published Pi uses Node+jiti. Native streams avoid Bun-only omp provider modules. `shared/bun-shim.ts` remains for any residual omp OAuth/catalog TS loads under Node.
