# Architecture

Canonical map for **pi-custom-providers**. Detailed rationale: [plans/active/01-ARCHITECTURE-bridge.md](./plans/active/01-ARCHITECTURE-bridge.md). Execution checklist: [plans/active/02-EXECUTION-PLAN-bridge.md](./plans/active/02-EXECUTION-PLAN-bridge.md). Continuity dual-authority: [CONTINUITY-BOUNDARY.md](./CONTINUITY-BOUNDARY.md).

## Four layers (MyInjector analogy)

| Layer | Owns | Must NOT |
|-------|------|----------|
| **Entry** | Root `package.json` `pi.extensions` + each `providers/*/index.ts` default export — register models, oauth, `streamSimple` | Import omp `pi-ai` provider stream modules |
| **Bridge** | Stable contract: earendil `ExtensionAPI` + `streamSimple(model, context, options)` → Pi assistant events; public shapes of `shared/native-*.ts` and `shared/xai-oauth-native.ts` | Host Bun internals; Continuity internals |
| **Adapter** | `shared/omp-thin.ts` (catalog + optional omp OAuth), `omp-import` / `bun-shim`, `*-native.ts` HTTP/SSE/Connect → events | Continuity; feature policy; dual omp+native streams |
| **Handler** | `providers/<id>/*` wiring (minus `*-native`, which is Adapter) | `@oh-my-pi/pi-ai/providers/*` |

Analog: MyInjector `Entry` / `bridge.*` / adapters / `IHook` vs libxposed — freeze the bridge so omp/Pi bumps do not rewrite handlers.

## Continuity dual-authority

| Authority | Owns | Does not own |
|-----------|------|--------------|
| **This repo** | Provider registration, OAuth adapters, **native streams**, catalog from omp `models.json` | Session memory, workflow eligibility |
| **omp** | Catalog JSON, optional OAuth hooks, Connect protobuf codecs | Runtime stream used by Pi |
| **Pi host** | ExtensionAPI, auth.json, jiti | omp pins inside this package |
| **pi-continuity-work-memory** | Memory pipeline, skills, workflow eligibility | Provider stream implementation |

Stream / Bun / omp-provider bugs → fix **here** (native adapter). Never patch Continuity for them. See [CONTINUITY-BOUNDARY.md](./CONTINUITY-BOUNDARY.md).

## Hard invariants

1. **No** `@oh-my-pi/pi-ai/providers` under `providers/**/*.ts`, `shared/native-*.ts`, or `shared/xai-oauth-native.ts` (enforced by `bun run check:boundary`).
2. Every registered provider passes a **native** `streamSimple`. `loadStreamFn` without `streamSimple` hard-errors.
3. omp may appear only for: catalog `models.json`, OAuth login/refresh (unless `oauthFactory`), Connect protobuf codecs under `pi-catalog`.
4. Peer-only `@earendil-works/pi-*` and `typebox`.
5. Smoke on **Node + jiti** before ship (`smoke:node`; `smoke:pong` when creds exist).

## Provider → stream engine

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

## Adapter notes

`shared/omp-thin.ts` is **Adapter** (catalog + OAuth), not a stream host:

1. Optional `getProviderDefinition(id)` from `@oh-my-pi/pi-ai/registry` → login / refresh / getApiKey
2. Adapt earendil `OAuthLoginCallbacks` → omp controller
3. **`streamSimple` required** (native); bare `loadStreamFn` throws
4. Models from `@oh-my-pi/pi-catalog` `models.json` via fs

**Exception — `xai-omp`:** auth uses `shared/xai-oauth-native.ts` via `oauthFactory`.

Cursor/Devin use catalog protobuf codecs (`@oh-my-pi/pi-catalog/discovery/*-proto`) — still no omp provider stream import.

## Bun vs Node

Published Pi uses Node+jiti. Native streams avoid Bun-only omp provider modules. `shared/bun-shim.ts` remains for residual omp OAuth/catalog TS loads under Node.

## Before ship

```bash
bun run check:boundary
bun run smoke:node
bun run test
```
