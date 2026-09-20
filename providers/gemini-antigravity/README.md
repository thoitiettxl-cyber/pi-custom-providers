# custom-provider-gemini-antigravity

## Pi 0.86.1 / Node host note (Bun is not defined)

Published `@earendil-works/pi` 0.86.1 loads extensions with **Node + jiti**.
`@oh-my-pi/pi-ai` is Bun-only (`Bun.env`, `import.meta.dir`, `import "bun"`), so
importing `streamGoogleGeminiCli` under Node throws `Bun is not defined` and
Continuity Memory reports
`@oh-my-pi/pi-ai streamGoogleGeminiCli unavailable (previous import failed)`.

This package streams Cloud Code Assist with a **Node-native fetch/SSE** client
(`cca-native.ts`) and does **not** require `@oh-my-pi/pi-ai` at runtime.
`@oh-my-pi/pi-catalog` remains an optional soft dependency for model discovery.

After pulling this fix on your machine:

```bash
cd ~/workspace/pi-gemini-antigravity-extension   # or your install path
bun install   # or npm install
# restart pi /reload extensions
```

No separate `dist` build is required (Pi loads the TypeScript sources via jiti/Bun).

Earendil pi extension that registers **Google Antigravity** as a chat provider:

1. **`/login google-antigravity`** — Google OAuth authorization-code + PKCE via `https://accounts.google.com/o/oauth2/v2/auth`, local callback `http://127.0.0.1:51121/oauth-callback`, token exchange `POST https://oauth2.googleapis.com/token` (form body; client id/secret from oh-my-pi `auth/google-antigravity.kdl`). After exchange: Cloud Code Assist project discovery (`loadCodeAssist` / `onboardUser` → `projectId`).
2. **Chat** — `streamSimple` wraps `@oh-my-pi/pi-ai` `streamGoogleGeminiCli` with `provider: "google-antigravity"` and `api: "google-gemini-cli"` → `https://daily-cloudcode-pa.googleapis.com`.

Credentials use **structured** api-key JSON `{ token, projectId, refreshToken, expiresAt, email }` (same shape `parseGeminiCliCredentials` expects). Never commit tokens.

## Install

From the earendil-works/pi repo root (bun preferred):

```bash
cd packages/coding-agent/examples/extensions/custom-provider-gemini-antigravity
bun install
```

Load for one session:

```bash
pi -e ./packages/coding-agent/examples/extensions/custom-provider-gemini-antigravity
```

Or auto-load via symlink:

```bash
ln -sfn "$(pwd)/packages/coding-agent/examples/extensions/custom-provider-gemini-antigravity" ~/.pi/agent/extensions/gemini-antigravity
```

Named entry: `gemini-antigravity.ts` re-exports the package default.

## Usage

1. Start pi with the extension loaded.
2. Run **`/login google-antigravity`** (display name **Antigravity**) — open the Google URL; the agent prefers local callback port **51121**. If that port cannot bind, paste the callback URL when prompted.
3. **`/model`** → pick a `google-antigravity/...` model (default family: `gemini-3.1-pro`; also curated `gemini-3-flash`, `gemini-3.1-flash-lite`). Bare pro ids map to wire id `gemini-3.1-pro-low` (CCA returns 404 for bare `gemini-3.1-pro`).
4. Chat as usual — tools go through CCA function-calling → standard `toolcall_*` events.
5. Optional: **`/antigravity-provider-info`** — registration + `streamGoogleGeminiCli` import probe (never prints tokens).

**Refresh:** Google refresh_token exchange preserves `projectId`. If refresh fails or `projectId` is missing, run `/login google-antigravity` again.

## What works vs deferred

| Feature | Status |
|--------|--------|
| `/login google-antigravity` (PKCE + local callback 51121) | Implemented |
| Paste-URL fallback when bind fails | Implemented |
| Token refresh + projectId preserve | Implemented |
| Project discovery (loadCodeAssist / onboardUser) | Implemented |
| Structured api key (`token` + `projectId`) | Implemented |
| `streamSimple` → `streamGoogleGeminiCli` | Wired via `@oh-my-pi/pi-ai` |
| Curated models `gemini-3.1-pro` / `gemini-3-flash` / `gemini-3.1-flash-lite` | Implemented |
| Optional catalog model list | Best-effort via `@oh-my-pi/pi-catalog` |
| Quota ranking / multi-account | **Deferred** |
| Live `fetchAvailableModels` discovery UI | **Deferred** |
| First-class provider inside `packages/ai` | Not done (extension preferred) |

Live CCA turns require a Google account after `/login`. Typecheck/tests do not call Google with secrets.

## Layout

- `index.ts` — `pi.registerProvider("google-antigravity", …)`
- `gemini-antigravity.ts` — named re-export entry
- `oauth.ts` — login / refresh / structured getApiKey / project discovery
- `stream.ts` — earendil ↔ omp `streamGoogleGeminiCli` adapter
- `models.ts` — curated models + optional catalog load

## Dev checks

```bash
bun install
bun run check   # tsc --noEmit
bun test        # oauth/PKCE smoke + streamGoogleGeminiCli import
```
