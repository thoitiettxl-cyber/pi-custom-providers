# pi-extension-custom-provider-cursor (0.86.1)

Part of `/workspace/pi-custom-providers` Bun workspace. Hybrid stream: **bun-shim + optional @oh-my-pi**; Node-native Connect pending (`cursor-native.ts`).

Peers: `@earendil-works/pi-ai` / `pi-coding-agent` **0.86.1**.

# custom-provider-cursor

Earendil pi extension that registers **Cursor** as a chat provider:

1. **`/login cursor`** — OAuth via `https://cursor.com/loginDeepControl` + poll `https://api2.cursor.sh/auth/poll` (ported from oh-my-pi `registry/oauth/cursor.ts`).
2. **Chat** — `streamSimple` wraps `@oh-my-pi/pi-ai` `streamCursor` (HTTP/2 Connect + protobuf `AgentService/Run` → `https://api2.cursor.sh`).

Credentials are stored by pi the same way as other OAuth providers (never commit tokens). Optional env fallback: `CURSOR_ACCESS_TOKEN` / `CURSOR_API_KEY`.

## Install

From the earendil-works/pi repo root:

```bash
cd packages/coding-agent/examples/extensions/custom-provider-cursor
npm install
```

Load for one session:

```bash
# from repo root (after monorepo deps are installed)
pi -e ./packages/coding-agent/examples/extensions/custom-provider-cursor
```

Or auto-load via symlink:

```bash
ln -sfn "$(pwd)/packages/coding-agent/examples/extensions/custom-provider-cursor" ~/.pi/agent/extensions/cursor
```

There is also a named entry `cursor.ts` that re-exports the package default.

## Usage

1. Start pi with the extension loaded (see above).
2. Run **`/login cursor`** — open the URL, approve CLI access; the agent polls until tokens arrive (no paste code).
3. **`/model`** → pick a `cursor/...` model (e.g. `cursor/default`, `cursor/claude-4.5-sonnet`).
4. Chat as usual — file/shell tools work via the local `execHandlers` bridge.
5. Optional: **`/cursor-provider-info`** — registration + `streamCursor` import probe (never prints tokens).

Token refresh uses `POST https://api2.cursor.sh/auth/exchange_user_api_key`.

## What works vs deferred

| Feature | Status |
|--------|--------|
| `/login cursor` (loginDeepControl + poll) | Implemented (setTimeout sleep, not Bun.sleep) |
| Token refresh | Implemented |
| `streamSimple` → AgentService Run | Wired via `@oh-my-pi/pi-ai` `streamCursor` with `externalToolExecutor=true` **and** local `execHandlers` |
| Default tools via exec bridge | **Implemented** — `read`, `ls`, `grep`, `write`, `delete`, `shell` (+ `shellStream` alias) in `exec-handlers.ts` (Node fs / child_process; `process.cwd()` default) |
| Curated + optional catalog models | Implemented |
| Quota UI / usage surfaces | **Deferred** |
| Full omp `CursorExecHandlers` (approval UI, MCP resources, todos, `pi_*` modern frames) | **Deferred** (extension bridge is local Node only; not the live AgentTool registry) |
| First-class provider inside `packages/ai` | Not done (extension preferred for this deliverable) |

Live AgentService turns require a real Cursor account after `/login`. Typecheck/tests do not call Cursor with secrets.

## Layout

- `index.ts` — `pi.registerProvider("cursor", …)`
- `cursor.ts` — named re-export entry
- `oauth.ts` — login / refresh (oh-my-pi endpoints only)
- `stream.ts` — earendil ↔ omp stream adapter (wires default `execHandlers`)
- `exec-handlers.ts` — local Cursor-compatible execHandlers bridge
- `models.ts` — curated models + optional catalog load

## Dev checks

```bash
npm install
npm run check   # tsc --noEmit
npm test        # oauth + streamCursor import + exec-handlers unit tests
```

Optional live smoke (needs a valid Cursor access token):

```bash
bun ./cursor-tool-smoke.mjs
```
