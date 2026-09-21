#!/usr/bin/env bash
# Secondary developer workflow: symlink providers into ~/.pi/agent/extensions.
# Prefer: pi install .   (or pi install git:github.com/thoitiettxl-cyber/pi-custom-providers)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT="${HOME}/.pi/agent/extensions"
mkdir -p "$EXT"

link_one() {
  local name="$1"
  local src="$2"
  ln -sfn "$src" "$EXT/$name"
  echo "linked $EXT/$name -> $src"
}

for name in cursor devin gemini-antigravity google-gemini-cli gitlab-duo gitlab-duo-agent openai-codex-device muse-code zai-coding-plan xai-omp; do
  link_one "$name" "$ROOT/providers/$name"
done

echo "Note: primary install path is: PI_SKIP_VERSION_CHECK=1 pi install \"$ROOT\""
echo "Keep git install unpinned (no @commit) so: pi update --extensions"
