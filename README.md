# pi-custom-providers

Custom chat providers for **earendil/Pi 0.86.x** in one installable package. **All streamSimple paths are native fetch/SSE or Connect** — no `@oh-my-pi/pi-ai/providers/*` stream imports. omp is used for OAuth login hooks (where needed) and catalog `models.json` only.

**Bridge boundary:** handlers must not import omp provider streams. Enforce with `bun run check:boundary` before ship (also wired as `pretest`). Continuity stream bugs are fixed here, not in Continuity — see [docs/CONTINUITY-BOUNDARY.md](./docs/CONTINUITY-BOUNDARY.md) and [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

| Provider | Login | Stream engine | Notes |
|----------|-------|---------------|-------|
| **Cursor** | `/login cursor` | Native Connect HTTP/2 + protobuf (`cursor-native.ts`) | `AgentService/Run` → `api2.cursor.sh`; local `exec-handlers` |
| **Devin** | `/login devin` | Native Connect HTTP/1.1 + protobuf (`devin-native.ts`) | `GetChatMessage` → `server.codeium.com` |
| **Gemini Antigravity** | `/login google-antigravity` | Native CCA SSE (`cca-native.ts`) | daily-cloudcode-pa + sandbox fallback |
| **Google Gemini CLI** | `/login google-gemini-cli` | Native CCA SSE (`gemini-cli-native.ts`) | `cloudcode-pa.googleapis.com` + GeminiCLI headers |
| **GitLab Duo** | `/login gitlab-duo` | Native Anthropic Messages fetch/SSE | AI Gateway Anthropic proxy |
| **GitLab Duo Agent** | `/login gitlab-duo-agent` | Native Anthropic Messages fetch/SSE | Same HTTP gateway path; full Duo Workflow WS deferred |
| **Codex (device)** | `/login openai-codex-device` | Native Codex Responses fetch/SSE (`codex-native.ts`) | `chatgpt.com/backend-api/codex/responses`; WS/compaction deferred |
| **Muse Code** | `/login muse-code` | Native OpenAI Responses fetch/SSE | `api.meta.ai/v1` |
| **Z.AI Coding Plan** | `/login zai-coding-plan` | Native Anthropic Messages fetch/SSE | |
| **xAI Grok (SuperGrok OAuth)** | `/login xai-omp` | Native OpenAI Responses fetch/SSE | `api.x.ai/v1`; native SuperGrok device OAuth |

**Pi range:** 0.86.x (`peerDependencies: "*"`). **omp:** `@oh-my-pi/pi-ai` + `pi-catalog` in **`dependencies` with caret** (`^18.2.6`) for catalog + OAuth hooks only.

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

Product rule: when omp fixes **OAuth / catalog**, Dependabot bumps `@oh-my-pi/*` and you pull via `pi update --extensions`. **Streams are vendored native** in this repo — omp stream fixes are not auto-picked up (by design: Node-safe, no Bun-only provider streams).

1. **omp publishes** a new `@oh-my-pi/pi-ai` / `pi-catalog` on npm.
2. **Dependabot** opens a PR bumping caret deps.
3. Maintainer merges (or `node scripts/sync-omp-version.mjs --write`).
4. User with an **unpinned** git install runs `pi update --extensions`.

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
| `/login xai-omp` | SuperGrok device OAuth; catalog `xai-oauth` (~9); **refresh rotates token — do not share grant across machines concurrently**; see `providers/xai-omp/README.md` |

## Smoke

```bash
bun install
bun run check:boundary       # fail if providers/native import omp pi-ai/providers
bun run smoke:node           # Node+jiti load all factories (no secrets)
bun run test                 # check:boundary (pretest) + hybrid unit tests
bun run check:xai-omp-auth   # usable xai-omp? expires ISO + lengths only (no token dump)
```

Live PONG (uses access if still valid; avoids refresh when possible): `bun scripts/smoke-xai-omp-pong.mjs`. Full `pi -p` one-shot has hung historically — prefer extension-path smoke above.

Cursor / Devin live AgentService turns need `/login` on the box; without auth, smoke still asserts register + native module/proto load.

## License

MIT — see [LICENSE](./LICENSE).
