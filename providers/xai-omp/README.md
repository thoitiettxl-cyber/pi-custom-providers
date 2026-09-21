# xai-omp

Thin wrapper over `@oh-my-pi/pi-ai` for earendil/Pi 0.86.x. Full omp Grok catalog (`xai` + `xai-oauth` union) without colliding with Pi first-party `xai`.

| | |
|--|--|
| Login | `/login xai-omp` |
| Auth | omp `xai-oauth` (SuperGrok OAuth) |
| Stream | omp `streamOpenAIResponses` (+ bun-shim under Node) |
| Catalog | omp `xai` ∪ `xai-oauth` (~34 models) |

OAuth/stream logic is **not vendored** — Dependabot bumps `@oh-my-pi/*` and `pi update --extensions` picks up fixes. Never commit secrets; Pi stores credentials under provider id `xai-omp`.

## Bun host

If the omp stream path still assumes Bun APIs beyond the shim, run Pi under Bun or prefer Node-native providers (e.g. google-antigravity).
