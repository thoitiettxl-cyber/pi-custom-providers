# pi-custom-providers

Custom chat providers for **earendil/Pi 0.86.x** in one installable package. Hybrid providers (cursor/devin/antigravity) plus **thin `@oh-my-pi` wrappers** for OAuth browser/device flows Pi does not ship first-party.

| Provider | Login | Stream |
|----------|-------|--------|
| **Cursor** | `/login cursor` | Native Connect TBD — clear error (no omp fallback) |
| **Devin** | `/login devin` | Native Connect TBD — clear error (no omp fallback) |
| **Gemini Antigravity** | `/login google-antigravity` | Node-native CCA SSE |
| **Google Gemini CLI** | `/login google-gemini-cli` | Native CCA TBD — clear error (no omp fallback) |
| **GitLab Duo** | `/login gitlab-duo` | Native Anthropic Messages fetch/SSE |
| **GitLab Duo Agent** | `/login gitlab-duo-agent` | Native WS TBD — clear error (no omp fallback) |
| **Codex (device)** | `/login openai-codex-device` | Native Codex TBD — clear error (no omp fallback) |
| **Muse Code** | `/login muse-code` | Native OpenAI Responses fetch/SSE |
| **Z.AI Coding Plan** | `/login zai-coding-plan` | Native Anthropic Messages fetch/SSE |
| **xAI Grok (SuperGrok OAuth)** | `/login xai-omp` | Native OpenAI Responses fetch/SSE (`api.x.ai/v1`) |

**Pi range:**Pi range:** 0.86.x (`peerDependencies: "*"`). **omp:** `@oh-my-pi/pi-ai` + `pi-catalog` in **`dependencies` with caret** (`^18.2.6`).

Skipped providers + reasons: **[docs/SKIPPED-PROVIDERS.md](./docs/SKIPPED-PROVIDERS.md)**.

## Install (keep unpinned)

```bash
PI_SKIP_VERSION_CHECK=1 pi install git:github.com/thoitiettxl-cyber/pi-custom-providers
# local:
PI_SKIP_VERSION_CHECK=1 pi install /absolute/path/to/pi-custom-providers
```

Do **not** pin `@commit` / `@sha` if you want `pi update --extensions` to move HEAD and reinstall deps.

> Security: Pi packages run with full system access. Review source before installing third-party packages.

Vietnamese quick start: **[INSTALL-VI.md](./INSTALL-VI.md)**. Architecture: **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)**.

## Staying current with omp

Product rule: when omp fixes a provider (e.g. cursor stream/oauth), you should **not** re-port code. Loop:

1. **omp publishes** a new `@oh-my-pi/pi-ai` / `pi-catalog` on npm.
2. **Dependabot** (`.github/dependabot.yml`) opens a PR bumping those caret deps on this repo’s `main`.
3. Maintainer merges the PR (or runs `node scripts/sync-omp-version.mjs --write` + `chore(deps): bump @oh-my-pi/pi-ai`).
4. User with an **unpinned** git install runs:

```bash
pi update --extensions
```

That pulls the new commits and reinstalls `dependencies`, so thin wrappers and hybrid shims load the fixed omp modules.

Thin wrappers may still use omp registry **login** hooks (`shared/omp-thin.ts` + catalog `models.json`). **Streams are native fetch/SSE** (`shared/native-openai-responses.ts`, `shared/native-anthropic-messages.ts`, antigravity `cca-native.ts`) — no `@oh-my-pi/pi-ai/providers/*` stream imports. **`xai-omp`** auth is native SuperGrok device OAuth (`shared/xai-oauth-native.ts`). Cursor/Devin/Codex/Duo-Agent/Gemini-CLI report a clear native-unavailable error (omp stream fallback disabled).

## Login notes

| Command | Notes |
|---------|--------|
| `/login cursor` | Deep-control + poll `api2.cursor.sh` |
| `/login devin` | PKCE + local callback `127.0.0.1:59653` |
| `/login google-antigravity` | PKCE + `127.0.0.1:51121`; stores `projectId` |
| `/login google-gemini-cli` | Gemini CLI OAuth + project hook (omp) |
| `/login gitlab-duo` | GitLab PKCE; override client via `GITLAB_*` env |
| `/login gitlab-duo-agent` | vscode:// callback — paste URL if needed |
| `/login openai-codex-device` | Headless/device Codex (Pi also has browser `openai-codex`) |
| `/login muse-code` | Meta device-code + minted API key |
| `/login zai-coding-plan` | zcode:// / paste; mints Z.AI key |
| `/login xai-omp` | SuperGrok device OAuth (same tokens as `xai`); catalog `xai-oauth` (~9); **refresh rotates token — do not share grant across machines concurrently**; see `providers/xai-omp/README.md` |

## Smoke

```bash
bun install
bun run smoke:node    # Node+jiti load all factories (no secrets)
bun run test          # unit tests for hybrid providers
bun run check:xai-omp-auth   # usable xai-omp? expires ISO + lengths only (no token dump)
```

Live PONG (uses access if still valid; avoids refresh when possible): `bun scripts/smoke-xai-omp-pong.mjs`. Full `pi -p` one-shot has hung historically — prefer extension-path smoke above.

## License

MIT — see [LICENSE](./LICENSE).
