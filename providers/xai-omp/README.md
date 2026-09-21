# xai-omp

Thin wrapper over `@oh-my-pi/pi-ai` for earendil/Pi 0.86.x. SuperGrok **OAuth-web** catalog (`xai-oauth`, ~9 picker models) without colliding with Pi first-party `xai`. Does **not** union the paid API-key `xai` bucket (~31).

| | |
|--|--|
| Login | `/login xai-omp` |
| Auth | **Native** Pi-compatible SuperGrok device OAuth (same client/tokens as first-party `xai`) — does **not** use omp registry |
| Stream | native OpenAI Responses (`shared/native-openai-responses.ts`) (+ bun-shim under Node) |
| Catalog | omp `xai-oauth` only (~9 models) |

Copying an existing Pi `xai` oauth entry to `xai-omp` in `auth.json` still works (same tokens). Refresh no longer needs `@oh-my-pi/pi-ai/registry`. Stream still tracks omp via Dependabot; run `pi update --extensions` after bumps. Never commit secrets; Pi stores credentials under provider id `xai-omp`.

## Bun host

Stream is native fetch/SSE (Node-safe). OAuth is native SuperGrok device flow.


## Refresh-token rotation (multi-machine)

SuperGrok OAuth **rotates the refresh token** on each successful refresh. If you (or CI/box smoke) refresh the **same** grant on machine A, machine B’s stored refresh token is revoked and Pi reports:

`invalid_grant: Refresh token has been revoked`

**After agent/CI/box refreshed the shared grant:**

1. On your machine run `/login xai-omp` again, **or**
2. Copy the **post-refresh** `xai-omp` object from the machine that refreshed into your `~/.pi/agent/auth.json` (replace the whole entry). Check usability without dumping secrets:

```bash
node scripts/check-xai-omp-auth.mjs
```

Details: [scripts/export-xai-omp-auth-hint.md](../../scripts/export-xai-omp-auth-hint.md).

**Do not** refresh the same grant concurrently on two machines, paste tokens into chat, or commit `auth.json`. Web OAuth only — no API-key path.
