#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

prepend_bin_dir() {
  if [ -d "$1" ]; then
    PATH="$1:$PATH"
    export PATH
  fi
}

prepend_bin_dir "$PROJECT_DIR/node_modules/.bin"
prepend_bin_dir "$PWD/node_modules/.bin"
prepend_bin_dir "/opt/homebrew/opt/node@18/bin"
prepend_bin_dir "/opt/homebrew/opt/node@20/bin"
if [ -n "${WORKSPACE_NODE_BIN:-}" ] && [ -x "$WORKSPACE_NODE_BIN" ]; then
  prepend_bin_dir "$(dirname "$WORKSPACE_NODE_BIN")"
fi

ensure_routes_manifest() {
  DIST_DIR="$PROJECT_DIR/.next"
  MANIFEST_FILE="$DIST_DIR/routes-manifest.json"
  mkdir -p "$DIST_DIR"
  if [ ! -f "$MANIFEST_FILE" ]; then
    printf '%s\n' '{"version":4,"caseSensitive":false,"basePath":"","rewrites":{"beforeFiles":[],"afterFiles":[],"fallback":[]},"redirects":[],"headers":[],"skipMiddlewareUrlNormalize":false}' > "$MANIFEST_FILE"
  fi
}

NODE_VERSION=$(node -p "process.versions.node" 2>/dev/null || true)
NODE_MAJOR=$(node -p "Number.parseInt(process.versions.node.split('.')[0], 10)" 2>/dev/null || echo 0)

case "$NODE_MAJOR" in
  18|20|22|24) ;;
  *)
    echo "Unsupported Node.js version ${NODE_VERSION:-unknown}. Install an active Node LTS release (18, 20, 22, or 24), or expose it on PATH." >&2
    exit 1
    ;;
esac

case "${1:-}" in
  next|env|node)
    ensure_routes_manifest
    ;;
esac

exec "$@"
