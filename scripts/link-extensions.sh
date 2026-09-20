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

link_one cursor "$ROOT/providers/cursor"
link_one devin "$ROOT/providers/devin"
link_one gemini-antigravity "$ROOT/providers/gemini-antigravity"

# Convenience standalone paths expected by runbooks (best-effort)
if [[ -d /workspace ]]; then
  ln -sfn "$ROOT/providers/cursor" /workspace/pi-cursor-extension 2>/dev/null || true
  ln -sfn "$ROOT/providers/devin" /workspace/pi-devin-extension 2>/dev/null || true
  echo "linked /workspace/pi-cursor-extension and /workspace/pi-devin-extension (if permitted)"
fi

echo "Note: primary install path is: PI_SKIP_VERSION_CHECK=1 pi install \"$ROOT\""
