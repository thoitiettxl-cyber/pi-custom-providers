# pi-extension-custom-provider-devin (0.86.1)

Part of `/workspace/pi-custom-providers` Bun workspace. Hybrid stream: **bun-shim + optional @oh-my-pi**; Node-native Connect pending (`devin-native.ts`).

Peers: `@earendil-works/pi-ai` / `pi-coding-agent` **0.86.1**.

# custom-provider-devin

Earendil pi extension that registers **Devin** as a chat provider:

1. **`/login devin`** — OAuth authorization-code + PKCE via `https://app.devin.ai/auth/cli/continue`, local callback `http://127.0.0.1:59653/callback`, token exchange `POST https://api.devin.ai/auth/cli/token` with JSON `{ code, code_verifier }` (from oh-my-pi `auth/devin.kdl`).
2. **Chat** — `streamSimple` wraps `@oh-my-pi/pi-ai` `streamDevin` (Connect + protobuf `GetChatMessage` → `https://server.codeium.com`).

Credentials are stored by pi the same way as other OAuth providers (never commit tokens). Optional env fallback: `DEVIN_API_KEY`. Session tokens are normalized with the `devin-session-token$` prefix (same as oh-my-pi `normalizeDevinSessionToken`).

## Install

From the earendil-works/pi repo root (bun preferred):

```bash
cd packages/coding-agent/examples/extensions/custom-provider-devin
bun install
```

Load for one session:

```bash
# from repo root (after monorepo deps are installed)
pi -e ./packages/coding-agent/examples/extensions/custom-provider-devin
```

Or auto-load via symlink:

```bash
ln -sfn "$(pwd)/packages/coding-agent/examples/extensions/custom-provider-devin" ~/.pi/agent/extensions/devin
```

There is also a named entry `devin.ts` that re-exports the package default.

## Usage

1. Start pi with the extension loaded (see above).
2. Run **`/login devin`** — open the URL, sign in / select account; the agent prefers the local callback on port **59653**. If that port cannot bind, paste the callback URL when prompted.
3. **`/model`** → pick a `devin/...` model (e.g. `devin/swe-1-6`, `devin/swe-1-6-fast`).
4. Chat as usual — tools go through Devin’s protobuf `toolCalls` → standard `toolcall_*` events (pi’s normal tool loop).
5. Optional: **`/devin-provider-info`** — registration + `streamDevin` import probe (never prints tokens).

**Refresh:** Devin auth policy is `refresh "none"`. When the session expires, run `/login devin` again (or set `DEVIN_API_KEY`).

## What works vs deferred

| Feature | Status |
|--------|--------|
| `/login devin` (PKCE + local callback 59653) | Implemented |
| Paste-URL fallback when bind fails | Implemented |
| Token refresh | **N/A** (`refresh "none"` — re-login) |
| `streamSimple` → `streamDevin` | Wired via `@oh-my-pi/pi-ai` |
| Cursor-style `execHandlers` | **Not applicable** — Devin does not use that channel |
| Tools via protobuf ChatToolCall | Handled inside `streamDevin` → standard toolcall events for pi |
| Curated models `swe-1-6` / `swe-1-6-fast` | Implemented |
| Optional catalog model list | Best-effort via `@oh-my-pi/pi-catalog` |
| Quota / usage UI | **Deferred** |
| First-class provider inside `packages/ai` | Not done (extension preferred for this deliverable) |

Live Cascade turns require a real Devin account after `/login`. Typecheck/tests do not call Devin with secrets.

## Layout

- `index.ts` — `pi.registerProvider("devin", …)`
- `devin.ts` — named re-export entry
- `oauth.ts` — login / refresh-none / session-token normalize (oh-my-pi endpoints only)
- `stream.ts` — earendil ↔ omp stream adapter (no execHandlers)
- `models.ts` — curated models + optional catalog load

## Dev checks

```bash
bun install
bun run check   # tsc --noEmit
bun test        # oauth/PKCE smoke + streamDevin import
```
