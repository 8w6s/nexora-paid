#!/usr/bin/env bash
# Print Nexora project tree, hiding noise dirs (node_modules, build output,
# editor/cache folders, vendored tooling). Defaults to depth 4 — override with
# `bash scripts/tree.sh 6`.
set -euo pipefail
depth="${1:-4}"
IGNORE='node_modules|.git|dist|.next|.astro|.claude|.mimocode|.dual-graph|.agents|.loop|.keys|.dev-logs|issued|.vscode'

if command -v tree >/dev/null 2>&1; then
  tree -I "$IGNORE" -L "$depth" --dirsfirst
else
  # Portable fallback using find: prune the noise dirs, print the rest.
  find . -maxdepth "$depth" -type d \(
      -name node_modules -o -name .git -o -name dist -o -name .next \
      -o -name .astro -o -name .claude -o -name .mimocode -o -name .dual-graph \
      -o -name .agents -o -name .loop -o -name .keys -o -name .dev-logs \
      -o -name issued -o -name .vscode \
    \) -prune -o -print | sort
fi