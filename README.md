# pi-custom-providers

Custom chat providers for **earendil/Pi 0.86.x** in one installable package:

| Provider | Login | Models | Stream |
|----------|-------|--------|--------|
| **Cursor** | `/login cursor` | Cursor Agent models | Hybrid bun-shim + optional `@oh-my-pi` (`streamCursor`); Node Connect TBD |
| **Devin** | `/login devin` | Cascade / Devin models | Hybrid bun-shim + optional `@oh-my-pi` (`streamDevin`); Node Connect TBD |
| **Gemini Antigravity** | `/login google-antigravity` | Gemini via Cloud Code Assist | **Node-native** CCA SSE (`cca-native.ts`) |

**Pi range:** designed for **0.86.1** (`peerDependencies: "*"` per Pi package docs; ship-tested on 0.86.1).

## Install (primary)

### Local path

```bash
PI_SKIP_VERSION_CHECK=1 pi install /absolute/path/to/pi-custom-providers
# or from the repo:
cd pi-custom-providers && PI_SKIP_VERSION_CHECK=1 pi install .
```

### Git (after this repo is on GitHub)

```bash
PI_SKIP_VERSION_CHECK=1 pi install git:github.com/thoitiettxl-cyber/pi-custom-providers
# optional pin:
PI_SKIP_VERSION_CHECK=1 pi install git:github.com/thoitiettxl-cyber/pi-custom-providers@v0.86.1
```

Restart Pi or `/reload`. Then log in per provider (below).

> Security: Pi packages run with full system access. Review source before installing third-party packages.

### Developer symlink (secondary)

```bash
bun install                 # optional: local tests / optional @oh-my-pi
bash scripts/link-extensions.sh
```

Symlinks `providers/*` into `~/.pi/agent/extensions/`. Prefer `pi install` for a clean install recorded in settings.

Vietnamese quick start: **[INSTALL-VI.md](./INSTALL-VI.md)**. Architecture: **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)**.

## Login per provider

| Command | Notes |
|---------|--------|
| `/login cursor` | Deep-control + poll `api2.cursor.sh` |
| `/login devin` | PKCE + local callback `127.0.0.1:59653` (paste-URL fallback) |
| `/login google-antigravity` | PKCE + local callback `127.0.0.1:51121/oauth-callback` (paste-URL fallback); stores `projectId` |

Pick a model with `/model cursor/…`, `/model devin/…`, or `/model google-antigravity/…`.

Status commands (no tokens printed): `/cursor-provider-info`, `/devin-provider-info`, `/antigravity-provider-info`.

## Architecture (short)

- Root `package.json` → `pi.extensions`: `./providers/cursor`, `./providers/devin`, `./providers/gemini-antigravity`.
- Each folder has `index.ts` that `export default` an extension factory.
- **Peer-only** `@earendil-works/*` + `typebox` — Pi jiti-aliases them; not shipped in install `node_modules`.
- **Optional** `@oh-my-pi/*` for cursor/devin stream shim (installed when available).
- See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Add a provider

1. Copy `providers/cursor` (or another) → `providers/<name>/`.
2. Implement `index.ts` → `export default async function (pi) { pi.registerProvider(...) }`.
3. Add the folder to root `workspaces` and `pi.extensions`.
4. Keep earendil imports as **peers** only; third-party runtime in `dependencies` / `optionalDependencies`.
5. Document OAuth + stream engine in that folder’s README.
6. `bun run test` + `bun run smoke:node`.

## Troubleshooting (Bun / Node)

| Symptom | Cause | Fix |
|---------|--------|-----|
| `ReferenceError: Bun is not defined` | omp / Bun-only code under Node+jiti | Ensure `bun-shim.ts` runs before omp import; antigravity should use native stream |
| `previous import failed` | jiti cached a failed dynamic import | Restart Pi / clear temp extension cache; fix root cause first |
| Provider missing after install | Wrong manifest path or not reloaded | Confirm `pi list`, restart Pi, check `pi.extensions` directories exist |
| Cursor/Devin stream fails, Antigravity works | No omp optional install or no auth | `npm ls @oh-my-pi/pi-ai` in package tree; `/login cursor\|devin`; native Connect still TBD |
| Huge `node_modules` | earendil in `dependencies` | Move to `peerDependencies: "*"`; Pi install uses `--omit=dev` |

Local unit tests need Bun (`bun test`). Runtime under published Pi is **Node + jiti**.

## Smoke

```bash
bun install
bun run test:cursor
bun run test:devin
bun run test:antigravity
bun run smoke:node    # load all three factories via Node+jiti (no secrets)
bun run smoke:pong    # live PONG when auth exists (google-antigravity likely)
```

## License

MIT — see [LICENSE](./LICENSE).
