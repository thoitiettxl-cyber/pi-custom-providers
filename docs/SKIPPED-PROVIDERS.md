# Skipped omp auth providers (TypeSafe: `missing_minus_pi_builtins`)

Re-scanned `@oh-my-pi/pi-catalog` `rules/auth/*.kdl` (login `oauth-code` / `device-code` / `custom`).

## Already shipped (native streams)

| Id | Stream |
|----|--------|
| `cursor` | Native HTTP/2 Connect AgentService |
| `devin` | Native Connect GetChatMessage |
| `google-antigravity` | Native CCA SSE |
| `google-gemini-cli` | Native CCA SSE (Gemini CLI wire) |
| `gitlab-duo` | Native Anthropic Messages |
| `gitlab-duo-agent` | Native Anthropic Messages HTTP gateway (full Duo Workflow WS deferred) |
| `openai-codex-device` | Native Codex Responses SSE (WS/compaction deferred) |
| `muse-code` | Native OpenAI Responses |
| `zai-coding-plan` | Native Anthropic Messages |
| `xai-omp` | Native OpenAI Responses + native SuperGrok OAuth |

## Pi 0.86.1 first-party OAuth (do not duplicate)

- `anthropic`, `openrouter`, `kimi-code`≈`kimi-coding`, `github-copilot`, `openai-codex` (browser), `google-vertex` (ADC)
- Pi still ships first-party thin **`xai`** (~3 models / API-key path). This repo ships **`xai-omp`** (SuperGrok OAuth-web `xai-oauth` catalog ~9).

## Skipped from the candidate list

| Id | Why |
|----|-----|
| `firepass` | `login "api-key"` only — not oauth/browser/device |
| `qwen-portal` | `login "api-key"` only |
| `stencil` | oauth-code but **not a model provider** (omp-hosted Stencil services) |
| `xai-oauth` (as provider id) | Not registered under that id — use package provider **`xai-omp`** |

## Deferred custom hooks (not in must-add list)

`alibaba-coding-plan`, `alibaba-token-plan`, `kilo`, `perplexity`, `xiaomi`, `cloudflare-ai-gateway`.

## Deferred stream depth (shipped subset)

| Provider | Shipped | Deferred |
|----------|---------|----------|
| `gitlab-duo-agent` | AI Gateway Anthropic HTTP chat | Full ambient Duo Workflow WebSocket |
| `openai-codex-device` | `/codex/responses` SSE | WebSocket transport, compaction v2, attestation |
| `cursor` | AgentService/Run text + local exec-handlers | Full omp CursorExecHandlers / MCP / quota UI |
| `devin` | GetChatMessage text/tools | AssignModel router edge cases / full compaction |
