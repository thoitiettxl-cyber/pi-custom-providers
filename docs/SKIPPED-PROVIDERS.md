# Skipped omp auth providers (TypeSafe: `missing_minus_pi_builtins`)

Re-scanned `@oh-my-pi/pi-catalog` `rules/auth/*.kdl` (login `oauth-code` / `device-code` / `custom`).

## Already in this package
- `cursor`, `devin`, `google-antigravity`

## Pi 0.86.1 first-party OAuth (do not duplicate)
- `anthropic`, `openrouter`, `kimi-code`≈`kimi-coding`, `xai` / `xai-oauth`, `github-copilot`, `openai-codex` (browser), `google-vertex` (ADC)

## Skipped from the candidate list
| Id | Why |
|----|-----|
| `firepass` | `login "api-key"` only — not oauth/browser/device |
| `qwen-portal` | `login "api-key"` only |
| `stencil` | oauth-code but **not a model provider** (omp-hosted Stencil services) |
| `xai-oauth` | Pi already ships `xai` OAuth |

## Deferred custom hooks (not in user must-add list)
Documented for a later pass: `alibaba-coding-plan`, `alibaba-token-plan`, `kilo`, `perplexity`, `xiaomi`, `cloudflare-ai-gateway`.

## Added this pass
`google-gemini-cli`, `gitlab-duo`, `gitlab-duo-agent`, `openai-codex-device`, `muse-code`, `zai-coding-plan`.
