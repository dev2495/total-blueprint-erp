#!/bin/sh
set -eu

prepend_bin_dir() {
  if [ -d "$1" ]; then
    PATH="$1:$PATH"
    export PATH
  fi
}

prepend_bin_dir "/opt/homebrew/opt/node@20/bin"
prepend_bin_dir "/opt/homebrew/opt/node@18/bin"

NODE_VERSION=$(node -p "process.versions.node" 2>/dev/null || true)
NODE_MAJOR=$(node -p "Number.parseInt(process.versions.node.split('.')[0], 10)" 2>/dev/null || echo 0)

if [ "$NODE_MAJOR" -lt 18 ] || [ "$NODE_MAJOR" -ge 21 ]; then
  echo "Unsupported Node.js version ${NODE_VERSION:-unknown}. Install Node 18 or 20, or expose it on PATH." >&2
  exit 1
fi

exec "$@"
