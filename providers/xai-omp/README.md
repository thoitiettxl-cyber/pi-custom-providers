# xai-omp

Thin wrapper over `@oh-my-pi/pi-ai` for earendil/Pi 0.86.x. SuperGrok **OAuth-web** catalog (`xai-oauth`, ~9 picker models) without colliding with Pi first-party `xai`. Does **not** union the paid API-key `xai` bucket (~31).

| | |
|--|--|
| Login | `/login xai-omp` |
| Auth | **Native** Pi-compatible SuperGrok device OAuth (same client/tokens as first-party `xai`) — does **not** use omp registry |
| Stream | omp `streamOpenAIResponses` (+ bun-shim under Node) |
| Catalog | omp `xai-oauth` only (~9 models) |

Copying an existing Pi `xai` oauth entry to `xai-omp` in `auth.json` still works (same tokens). Refresh no longer needs `@oh-my-pi/pi-ai/registry`. Stream still tracks omp via Dependabot; run `pi update --extensions` after bumps. Never commit secrets; Pi stores credentials under provider id `xai-omp`.

## Bun host

If the omp stream path still assumes Bun APIs beyond the shim, run Pi under Bun or prefer Node-native providers (e.g. google-antigravity).
