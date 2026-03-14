#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="${ROOT_DIR}/frontend_v2"
MAX_BUILD_ATTEMPTS="${MAX_BUILD_ATTEMPTS:-3}"
MAX_BUILD_SECONDS="${MAX_BUILD_SECONDS:-240}"

cd "${FRONTEND_DIR}"

clean_build_artifacts() {
  # Move heavy `.next` tree out of the way quickly.
  # Avoid recursive stale cleanup because problematic stale dirs can block.
  if [ -d ".next" ]; then
    local stale_dir
    stale_dir=".next_stale_$(date +%s)"
    if mv ".next" "${stale_dir}" 2>/dev/null; then
      echo "Moved stale .next to ${stale_dir}"
    else
      echo "WARN: could not move .next quickly; keeping existing tree."
    fi
  fi
  rm -rf node_modules/.cache
  rm -f tsconfig.tsbuildinfo
}

is_transient_next_failure() {
  local log_file="$1"
  grep -Eq "pages-manifest\.json|_document\.js|webpack-runtime\.js|Cannot find module './[0-9]+\.js'|_ssgManifest\.js|_buildManifest\.js|ENOENT: no such file or directory, open '.*\\.next/static/.*/_(ssg|build)Manifest\\.js'|ENOENT: no such file or directory, open '.*\\.next/server/pages/_app\\.js\\.nft\\.json'|ENOENT: no such file or directory, open '.*\\.next/server/.+\\.nft\\.json'" "${log_file}"
}

validate_build_artifacts() {
  local has_server_dir=0
  local has_runtime=0
  local has_static=0
  local has_route_manifest=0
  local has_root_routes_manifest=0

  [ -d ".next/server" ] && has_server_dir=1
  [ -f ".next/server/webpack-runtime.js" ] && has_runtime=1
  [ -d ".next/static" ] && has_static=1
  [ -f ".next/routes-manifest.json" ] && has_root_routes_manifest=1

  # Next.js App Router builds may not emit pages-manifest.json.
  # Accept any known route-manifest shape from app/pages router builds.
  if [ -f ".next/server/pages-manifest.json" ] \
    || [ -f ".next/server/app-paths-manifest.json" ] \
    || [ -f ".next/server/app-path-routes-manifest.json" ] \
    || [ -f ".next/build-manifest.json" ]; then
    has_route_manifest=1
  fi

  [ "${has_server_dir}" -eq 1 ] \
    && [ "${has_runtime}" -eq 1 ] \
    && [ "${has_static}" -eq 1 ] \
    && [ "${has_route_manifest}" -eq 1 ] \
    && [ "${has_root_routes_manifest}" -eq 1 ]
}

echo "==> Next build guard: cleaning stale build artifacts"
clean_build_artifacts

echo "==> Building frontend (max attempts: ${MAX_BUILD_ATTEMPTS})"
export NEXT_TELEMETRY_DISABLED=1
BUILD_LOG_TMP="$(mktemp)"

build_ok=0
attempt=1
while [ "${attempt}" -le "${MAX_BUILD_ATTEMPTS}" ]; do
  echo "==> Build attempt ${attempt}/${MAX_BUILD_ATTEMPTS}"
  : > "${BUILD_LOG_TMP}"
  build_exit=0
  set +e
  npm run build > "${BUILD_LOG_TMP}" 2>&1 &
  build_pid=$!
  build_start_ts=$(date +%s)
  last_heartbeat_ts=${build_start_ts}
  while kill -0 "${build_pid}" 2>/dev/null; do
    now_ts=$(date +%s)
    elapsed=$((now_ts - build_start_ts))
    heartbeat_elapsed=$((now_ts - last_heartbeat_ts))
    if [ "${heartbeat_elapsed}" -ge 20 ]; then
      echo "   build still running... ${elapsed}s/${MAX_BUILD_SECONDS}s"
      last_heartbeat_ts=${now_ts}
    fi
    if [ "${elapsed}" -ge "${MAX_BUILD_SECONDS}" ]; then
      echo "ERROR: build timed out after ${MAX_BUILD_SECONDS}s; killing hung Next build."
      pkill -TERM -P "${build_pid}" 2>/dev/null || true
      kill -TERM "${build_pid}" 2>/dev/null || true
      sleep 1
      pkill -KILL -P "${build_pid}" 2>/dev/null || true
      kill -KILL "${build_pid}" 2>/dev/null || true
      wait "${build_pid}" 2>/dev/null || true
      build_exit=124
      break
    fi
    sleep 1
  done
  if [ "${build_exit}" -eq 0 ]; then
    wait "${build_pid}"
    build_exit=$?
  fi
  set -e
  cat "${BUILD_LOG_TMP}"
  if [ "${build_exit}" -eq 0 ]; then
    if validate_build_artifacts; then
      build_ok=1
      break
    fi
    echo "WARN: build command succeeded but required artifacts are missing."
  else
    if [ "${build_exit}" -eq 124 ]; then
      echo "WARN: timed-out Next build treated as transient instability."
    elif ! is_transient_next_failure "${BUILD_LOG_TMP}"; then
      echo "ERROR: next build failed with a non-transient error."
      rm -f "${BUILD_LOG_TMP}"
      exit 1
    fi
    echo "WARN: transient Next build failure detected."
  fi

  if [ "${attempt}" -lt "${MAX_BUILD_ATTEMPTS}" ]; then
    echo "==> Retrying after clean..."
    clean_build_artifacts
  else
    echo "ERROR: next build unstable after ${MAX_BUILD_ATTEMPTS} attempts."
  fi
  attempt=$((attempt + 1))
done

rm -f "${BUILD_LOG_TMP}"

if [ "${build_ok}" -ne 1 ]; then
  exit 1
fi

echo "==> Validating generated server artifacts"
if ! validate_build_artifacts; then
  echo "ERROR: build artifacts invalid after successful build."
  exit 1
fi

echo "==> Next build guard passed"
