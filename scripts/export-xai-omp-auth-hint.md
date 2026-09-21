# Copying a refreshed `xai-omp` grant (no chat paste)

SuperGrok OAuth **rotates the refresh token** on each successful refresh. If agent/CI/box smoke refreshed the shared grant, your laptop’s stored refresh token is revoked (`invalid_grant`).

## Prefer one of

1. **Re-login on your machine:** in Pi, run `/login xai-omp` (web OAuth only — no API-key path).
2. **Copy the post-refresh entry** from the machine that refreshed (e.g. the box) into your local `~/.pi/agent/auth.json`.

## Safe copy procedure

On the **machine that refreshed** (box/CI):

```bash
# Confirm access is still valid (prints lengths + expires ISO — never tokens)
node scripts/check-xai-omp-auth.mjs
```

Then copy **only** the `xai-omp` object (and optionally keep `xai` / `xai-oauth` in sync if you use first-party `xai`) via a private channel:

- `scp` / shared secret manager / password manager secure note
- Or open both `auth.json` files locally and replace the `xai-omp` JSON object

**Never** paste access/refresh tokens into chat, issues, or commit them.

## Do not

- Refresh the **same** SuperGrok grant from two machines at once (each refresh invalidates the previous refresh token).
- Share one refresh token across concurrent agent + laptop sessions.
- Commit `auth.json`.

After copy, restart Pi or `/reload`, then `/model xai-omp/grok-4.6` (or picker).
