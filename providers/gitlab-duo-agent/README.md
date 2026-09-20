# gitlab-duo-agent

Thin wrapper over `@oh-my-pi/pi-ai` for earendil/Pi 0.86.x.

| | |
|--|--|
| Login | `/login gitlab-duo-agent` |
| Flow | GitLab OAuth (vscode callback) |
| Stream | omp `streamGitLabDuoWorkflow` (+ bun-shim under Node) |

OAuth/stream logic is **not vendored** — Dependabot bumps `@oh-my-pi/*` and `pi update --extensions` picks up fixes.

## Bun host

If the omp stream path still assumes Bun APIs beyond the shim, run Pi under Bun or prefer Node-native providers (e.g. google-antigravity).
