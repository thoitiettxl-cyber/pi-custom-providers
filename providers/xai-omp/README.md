# xai-omp

Thin wrapper over `@oh-my-pi/pi-ai` for earendil/Pi 0.86.x. SuperGrok **OAuth-web** catalog (`xai-oauth`, ~9 picker models) without colliding with Pi first-party `xai`. Does **not** union the paid API-key `xai` bucket (~31).

| | |
|--|--|
| Login | `/login xai-omp` |
| Auth | omp `xai-oauth` (SuperGrok OAuth) |
| Stream | omp `streamOpenAIResponses` (+ bun-shim under Node) |
| Catalog | omp `xai-oauth` only (~9 models) |

OAuth/stream logic is **not vendored** — Dependabot bumps `@oh-my-pi/*` and `pi update --extensions` picks up fixes. Never commit secrets; Pi stores credentials under provider id `xai-omp`.

## Bun host

If the omp stream path still assumes Bun APIs beyond the shim, run Pi under Bun or prefer Node-native providers (e.g. google-antigravity).
