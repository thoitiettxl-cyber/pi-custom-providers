# Architecture

## Purpose

Ship three custom chat providers for earendil/Pi 0.86.x as **one installable package**:

| Provider id | Folder | Stream engine |
|-------------|--------|---------------|
| `cursor` | `providers/cursor` | Hybrid: bun-shim + optional `@oh-my-pi` `streamCursor` (Node Connect TBD) |
| `devin` | `providers/devin` | Hybrid: bun-shim + optional `@oh-my-pi` `streamDevin` (Node Connect TBD) |
| `google-antigravity` | `providers/gemini-antigravity` | Node-native CCA SSE (`cca-native.ts`) |

## Workspace layout

```
pi-custom-providers/
  package.json          # pi.extensions + peerDeps + optional @oh-my-pi
  providers/
    cursor/             # index.ts export default
    devin/
    gemini-antigravity/
  shared/               # shared helpers (e.g. bun-shim reference)
  scripts/              # link + smoke
  docs/
```

Bun/npm **workspaces** keep one lockfile and shared tooling. Nested provider `package.json` files remain for unit tests and nested `pi.extensions: ["./index.ts"]` discovery.

## Peer-only core libs

Pi bundles and **jiti-aliases** these modules into extensions. Declaring them in `dependencies` wastes disk and can shadow Pi’s copies.

Use:

```json
"peerDependencies": {
  "@earendil-works/pi-ai": "*",
  "@earendil-works/pi-agent-core": "*",
  "@earendil-works/pi-coding-agent": "*",
  "@earendil-works/pi-tui": "*",
  "typebox": "*"
}
```

Local development may pin the same packages under `devDependencies` so `bun test` resolves types/runtime. `pi install` runs `npm install --omit=dev`, so those pins are **not** installed for end users.

Third-party runtime (today: optional `@oh-my-pi/pi-ai` + `pi-catalog`) belongs in `optionalDependencies` / `dependencies`.

## Discovery: `pi install` vs symlink

### Primary — `pi install`

1. User runs `pi install /path/to/pi-custom-providers` or `pi install git:github.com/thoitiettxl-cyber/pi-custom-providers`.
2. Pi records the package in settings and (for git/npm) clones then `npm install --omit=dev`.
3. Root `pi.extensions` lists provider **directories**. Pi expands each directory via smart discovery (`package.json` → `./index.ts` or bare `index.ts`).
4. Each factory calls `pi.registerProvider(...)` + optional `/login` OAuth hooks.

### Secondary — symlink (developers)

`scripts/link-extensions.sh` symlinks each provider folder into `~/.pi/agent/extensions/<name>`. Useful for edit-reload loops without changing settings packages. Prefer `pi install .` for a clean, reproducible install.

## Runtime notes

- **Bun vs Node:** Published Pi uses Node+jiti. Cursor/Devin still import omp streams that assume Bun → `bun-shim.ts` installs a minimal `globalThis.Bun` before dynamic import. Antigravity avoids omp for streaming.
- **Auth:** OAuth credentials live in Pi’s `auth.json` (never in this repo). Live stream smoke needs tokens; unit/load smoke does not.
- **TypeSafe (2026-09-20):** `entry_layout=providers_dir_paths`, `peer_range=*`, `keep_workspaces=true`.

## Extending

1. Add `providers/<id>/` with `index.ts` default export.
2. Append to root `workspaces` and `pi.extensions`.
3. Document login command, API id, and stream engine.
4. Run unit tests + `scripts/smoke-node-jiti.mjs`.
