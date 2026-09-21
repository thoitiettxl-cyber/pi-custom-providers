# Skipped omp auth providers (TypeSafe: `missing_minus_pi_builtins`)

Re-scanned `@oh-my-pi/pi-catalog` `rules/auth/*.kdl` (login `oauth-code` / `device-code` / `custom`).

## Already in this package
- `cursor`, `devin`, `google-antigravity`

## Pi 0.86.1 first-party OAuth (do not duplicate)
- `anthropic`, `openrouter`, `kimi-code`≈`kimi-coding`, `github-copilot`, `openai-codex` (browser), `google-vertex` (ADC)
- Pi still ships first-party thin **`xai`** (~3 models / API-key path). This repo ships **`xai-omp`** (SuperGrok OAuth-web `xai-oauth` catalog ~9) — not a duplicate of Pi’s provider id, and not the paid API `xai` bucket.

## Skipped from the candidate list
| Id | Why |
|----|-----|
| `firepass` | `login "api-key"` only — not oauth/browser/device |
| `qwen-portal` | `login "api-key"` only |
| `stencil` | oauth-code but **not a model provider** (omp-hosted Stencil services) |
| `xai-oauth` (as provider id) | Not registered under that id — use package provider **`xai-omp`** (ompAuthId `xai-oauth`, catalog `xai-oauth` only ~9) |

## Deferred custom hooks (not in user must-add list)
Documented for a later pass: `alibaba-coding-plan`, `alibaba-token-plan`, `kilo`, `perplexity`, `xiaomi`, `cloudflare-ai-gateway`.

## Added this pass
`google-gemini-cli`, `gitlab-duo`, `gitlab-duo-agent`, `openai-codex-device`, `muse-code`, `zai-coding-plan`, **`xai-omp`**.
