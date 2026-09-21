# pi-custom-providers

Custom chat providers for **earendil/Pi 0.86.x** in one installable package. Hybrid providers (cursor/devin/antigravity) plus **thin `@oh-my-pi` wrappers** for OAuth browser/device flows Pi does not ship first-party.

| Provider | Login | Stream |
|----------|-------|--------|
| **Cursor** | `/login cursor` | Hybrid bun-shim + omp `streamCursor` |
| **Devin** | `/login devin` | Hybrid bun-shim + omp `streamDevin` |
| **Gemini Antigravity** | `/login google-antigravity` | Node-native CCA SSE |
| **Google Gemini CLI** | `/login google-gemini-cli` | Thin omp `streamGoogleGeminiCli` |
| **GitLab Duo** | `/login gitlab-duo` | Thin omp `streamGitLabDuo` |
| **GitLab Duo Agent** | `/login gitlab-duo-agent` | Thin omp `streamGitLabDuoWorkflow` |
| **Codex (device)** | `/login openai-codex-device` | Thin omp `streamOpenAICodexResponses` |
| **Muse Code** | `/login muse-code` | Thin omp `streamOpenAIResponses` |
| **Z.AI Coding Plan** | `/login zai-coding-plan` | Thin omp `streamAnthropic` |
| **xAI Grok (omp)** | `/login xai-omp` | Thin omp `streamOpenAIResponses` (full catalog) |

**Pi range:** 0.86.x (`peerDependencies: "*"`). **omp:** `@oh-my-pi/pi-ai` + `pi-catalog` in **`dependencies` with caret** (`^18.2.6`).

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

Thin wrappers call omp registry login + stream exports (`shared/omp-thin.ts`). Hybrid cursor/devin still use bun-shim under Node+jiti; prefer a Bun host if a stream still needs Bun-only APIs.

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

## Smoke

```bash
bun install
bun run smoke:node    # Node+jiti load all factories (no secrets)
bun run test          # unit tests for hybrid providers
```

## License

MIT — see [LICENSE](./LICENSE).
