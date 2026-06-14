#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_PYTHON="${BACKEND_PYTHON:-}"
RUNTIME_DIR="${ROOT_DIR}/.runtime/service-runtime"
LOG_DIR="${RUNTIME_DIR}/logs"
STATE_DIR="${RUNTIME_DIR}/state"
BACKEND_LOG="${LOG_DIR}/backend.log"
FRONTEND_LOG="${LOG_DIR}/frontend.log"
FRONTEND_BUILD_LOG="${LOG_DIR}/frontend_build.log"
BACKEND_PID_FILE="${STATE_DIR}/backend.pid"
FRONTEND_PID_FILE="${STATE_DIR}/frontend.pid"
FRONTEND_MODE_FILE="${STATE_DIR}/frontend.mode"
BOOTSTRAP_LOCK_DIR="${STATE_DIR}/bootstrap.lock"
MAX_RESTARTS="${MAX_RESTARTS:-3}"
FRONTEND_MODE="${FRONTEND_MODE:-prod}" # prod|dev
FRONTEND_PORT="${FRONTEND_PORT:-3001}"
ALLOW_DEV_FALLBACK="${ALLOW_DEV_FALLBACK:-0}" # 1 => fallback to dev if prod build is unstable
ALLOW_SCHEMA_SKIP_ON_TIMEOUT="${ALLOW_SCHEMA_SKIP_ON_TIMEOUT:-0}"
BUILD_MAX_ATTEMPTS="${BUILD_MAX_ATTEMPTS:-2}"
BUILD_TIMEOUT_SECONDS="${BUILD_TIMEOUT_SECONDS:-480}"
CMD="${1:-start}"
NODE18_BIN_DIR=""
BACKEND_SERVER_MODE="${BACKEND_SERVER_MODE:-}"

export SKIP_DOTENV_IMPORT="${SKIP_DOTENV_IMPORT:-1}"
export SKIP_CELERY_IMPORT="${SKIP_CELERY_IMPORT:-1}"
# macOS local gunicorn uses a prefork worker model. Some Python/Objective-C
# dependencies can trip Apple's fork-safety guard under long UI sweeps unless
# this is set before workers fork. Linux/Render ignore this environment value.
if [ "$(uname -s)" = "Darwin" ]; then
  export OBJC_DISABLE_INITIALIZE_FORK_SAFETY="${OBJC_DISABLE_INITIALIZE_FORK_SAFETY:-YES}"
fi
# Local runserver creates short-lived request threads while WCM/machine pages poll.
# Closing DB connections after each request prevents local Postgres slot exhaustion.
export DB_CONN_MAX_AGE="${DB_CONN_MAX_AGE:-0}"

mkdir -p "${LOG_DIR}"
mkdir -p "${STATE_DIR}"

usage() {
  cat <<EOF
Usage: ./start_all.sh [start|verify|stop|restart|clean-restart|status]
Environment:
  FRONTEND_MODE=prod|dev    (default: prod)
  FRONTEND_PORT=3001        (default: 3001, bound on 0.0.0.0 for LAN QA)
  ALLOW_DEV_FALLBACK=1      (default: 0, auto-fallback is disabled unless explicitly enabled)
  ALLOW_SCHEMA_SKIP_ON_TIMEOUT=1 (default: 0, schema skip is disabled unless explicitly enabled)
  BACKEND_SERVER_MODE=runserver|gunicorn (default: gunicorn in prod mode; runserver on macOS dev mode)
  BUILD_MAX_ATTEMPTS=2      (default: 2, prod build attempts before failure)
  BUILD_TIMEOUT_SECONDS=480  (default: 480, timeout per prod build attempt)
  MAX_RESTARTS=3            (default: 3)
  GUNICORN_WORKERS=3        (default: 3)
EOF
}

detect_lan_ip() {
  if command -v ipconfig >/dev/null 2>&1; then
    ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true
    return
  fi
  if command -v hostname >/dev/null 2>&1; then
    hostname -I 2>/dev/null | awk '{print $1}' || true
  fi
}

detect_all_lan_ips() {
  local ips=""
  if command -v ifconfig >/dev/null 2>&1; then
    ips="$(
      ifconfig 2>/dev/null \
        | awk '/inet / {print $2}' \
        | grep -E '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)' \
        | sort -u \
        | paste -sd, -
    )"
  fi
  if [ -z "${ips}" ]; then
    local primary
    primary="$(detect_lan_ip || true)"
    if [ -n "${primary}" ]; then
      ips="${primary}"
    fi
  fi
  echo "${ips}"
}

rotate_log() {
  local file="$1"
  mkdir -p "$(dirname "${file}")"
  if [ -f "$file" ]; then
    local ts
    ts="$(date +%Y%m%d_%H%M%S)"
    mv "$file" "${file}.${ts}" 2>/dev/null || true
  fi
}

pid_running() {
  local pid="$1"
  [[ "${pid}" =~ ^[0-9]+$ ]] && [ "${pid}" -gt 1 ] && kill -0 "${pid}" 2>/dev/null
}

read_pid() {
  local file="$1"
  [ -f "$file" ] || return 0
  local pid
  pid="$(LC_ALL=C awk 'NR==1 {gsub(/[^0-9]/,"",$0); print $0; exit}' "$file" 2>/dev/null || true)"
  if [[ "${pid}" =~ ^[0-9]+$ ]] && [ "${pid}" -gt 1 ]; then
    echo "${pid}"
  fi
}

write_runtime_mode() {
  local file="$1"
  local mode="$2"
  printf '%s\n' "${mode}" > "${file}"
}

read_runtime_mode() {
  local file="$1"
  [ -f "$file" ] || return 0
  head -n 1 "$file" 2>/dev/null || true
}

detect_frontend_mode() {
  local pid="$1"
  local mode_from_state
  mode_from_state="$(read_runtime_mode "${FRONTEND_MODE_FILE}" || true)"
  if pid_running "${pid}"; then
    local cmdline
    cmdline="$(ps -o command= -p "${pid}" 2>/dev/null || true)"
    if echo "${cmdline}" | grep -q "next start -H 0.0.0.0 -p ${FRONTEND_PORT}"; then
      echo "prod"
      return 0
    fi
    if echo "${cmdline}" | grep -q "next-server"; then
      echo "prod"
      return 0
    fi
    if echo "${cmdline}" | grep -Eq "next dev -H 0.0.0.0 -p ${FRONTEND_PORT}|npm run dev"; then
      echo "dev"
      return 0
    fi
  fi
  echo "${mode_from_state:-unknown}"
}

port_pid() {
  local port="$1"
  lsof -ti:"${port}" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

kill_pid_tree() {
  local pid="$1"
  if ! pid_running "$pid"; then
    return
  fi
  pkill -TERM -P "$pid" 2>/dev/null || true
  kill -TERM "$pid" 2>/dev/null || true
  sleep 1
  pkill -KILL -P "$pid" 2>/dev/null || true
  kill -KILL "$pid" 2>/dev/null || true
}

acquire_bootstrap_lock() {
  local waited=0
  while ! mkdir "${BOOTSTRAP_LOCK_DIR}" 2>/dev/null; do
    local holder_pid=""
    if [ ! -f "${BOOTSTRAP_LOCK_DIR}/pid" ]; then
      rm -rf "${BOOTSTRAP_LOCK_DIR}" 2>/dev/null || true
      continue
    fi
    if [ -f "${BOOTSTRAP_LOCK_DIR}/pid" ]; then
      holder_pid="$(head -n 1 "${BOOTSTRAP_LOCK_DIR}/pid" 2>/dev/null || true)"
    fi
    if [ -n "${holder_pid}" ] && ! pid_running "${holder_pid}"; then
      rm -rf "${BOOTSTRAP_LOCK_DIR}" 2>/dev/null || true
      continue
    fi
    if [ "${waited}" -eq 0 ]; then
      echo "Waiting for runtime bootstrap lock${holder_pid:+ held by PID ${holder_pid}}..."
    fi
    sleep 2
    waited=$((waited + 2))
    if [ "${waited}" -ge 180 ]; then
      echo "Timed out waiting for runtime bootstrap lock."
      exit 1
    fi
  done
  printf '%s\n' "$$" > "${BOOTSTRAP_LOCK_DIR}/pid"
}

release_bootstrap_lock() {
  if [ -d "${BOOTSTRAP_LOCK_DIR}" ] && [ "$(head -n 1 "${BOOTSTRAP_LOCK_DIR}/pid" 2>/dev/null || true)" = "$$" ]; then
    rm -rf "${BOOTSTRAP_LOCK_DIR}" 2>/dev/null || true
  fi
}

spawn_detached() {
  local cmd="$1"
  local log_file="$2"
  local pid_file="$3"
  local launcher
  launcher="$(host_python)" || {
    echo "Unable to find a host Python runtime for detached process launch."
    return 1
  }

  local pid
  pid="$(
    DETACH_CMD="${cmd}" DETACH_LOG="${log_file}" "${launcher}" - <<'PY'
import os
import subprocess
import sys

cmd = os.environ["DETACH_CMD"]
log_path = os.environ["DETACH_LOG"]

with open(log_path, "ab", buffering=0) as log_file, open(os.devnull, "rb", buffering=0) as devnull:
    proc = subprocess.Popen(
        ["bash", "-lc", cmd],
        stdin=devnull,
        stdout=log_file,
        stderr=subprocess.STDOUT,
        preexec_fn=os.setsid,
        close_fds=True,
    )

print(proc.pid)
PY
  )"

  if ! [[ "${pid}" =~ ^[0-9]+$ ]]; then
    echo "Detached process launch failed for ${log_file}"
    return 1
  fi

  echo "${pid}" > "${pid_file}"
}

ensure_node18() {
  if [ -x "/opt/homebrew/opt/node@18/bin/node" ]; then
    NODE18_BIN_DIR="/opt/homebrew/opt/node@18/bin"
    export PATH="${NODE18_BIN_DIR}:$PATH"
    hash -r
  fi
  local node_v
  node_v="$(node -v)"
  local major
  major="$(echo "${node_v}" | sed -E 's/^v([0-9]+).*/\1/')"
  if [ "${major}" -lt 18 ] || [ "${major}" -gt 20 ]; then
    echo "Unsupported Node version ${node_v}. Use Node 18/20."
    exit 1
  fi
  echo "Frontend toolchain: node=${node_v} npm=$(npm -v)"
}

host_python() {
  command -v python3 >/dev/null 2>&1 && command -v python3 && return 0
  command -v python >/dev/null 2>&1 && command -v python && return 0
  return 1
}

probe_backend_python() {
  local candidate="$1"
  [ -x "${candidate}" ] || return 1
  local probe
  probe="$(host_python)" || return 1
  "${probe}" - "${candidate}" <<'PY'
import subprocess
import sys

candidate = sys.argv[1]
code = """
import django
import reportlab
import whitenoise
try:
    import psycopg  # noqa: F401
except Exception:
    import psycopg2  # noqa: F401
"""
try:
    completed = subprocess.run(
        [candidate, "-c", code],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=8,
        text=True,
    )
except Exception:
    raise SystemExit(1)
raise SystemExit(0 if completed.returncode == 0 else completed.returncode)
PY
}

resolve_backend_python() {
  local candidates=()
  if [ -n "${BACKEND_PYTHON}" ]; then
    candidates+=("${BACKEND_PYTHON}")
  fi
  candidates+=(
    "${ROOT_DIR}/.venv/bin/python3"
    "${ROOT_DIR}/.venv/bin/python"
    "${ROOT_DIR}/venv_311/bin/python"
    "${ROOT_DIR}/.venv-validate/bin/python"
    "${ROOT_DIR}/../../../venv/bin/python"
    "${ROOT_DIR}/../../../venv/bin/python3"
    "${ROOT_DIR}/../../../venv_311/bin/python"
  )
  for candidate in "${candidates[@]}"; do
    if probe_backend_python "${candidate}"; then
      BACKEND_PYTHON="${candidate}"
      export BACKEND_PYTHON
      echo "Backend runtime: ${BACKEND_PYTHON}"
      return 0
    fi
  done
  echo "No healthy backend Python runtime found."
  echo "Tried: ${candidates[*]}"
  return 1
}

frontend_runtime_prefix() {
  local prefix=""
  if [ -n "${NODE18_BIN_DIR}" ]; then
    prefix="export PATH='${NODE18_BIN_DIR}':\$PATH; hash -r; "
  fi
  printf "%sexport DISABLE_NEXT_WEBPACK_PERSISTENT_CACHE=1; export NEXT_DISABLE_CACHE=1; export MAX_BUILD_SECONDS='${BUILD_TIMEOUT_SECONDS}'; export MAX_BUILD_ATTEMPTS='${BUILD_MAX_ATTEMPTS}'; " "${prefix}"
}

ensure_reportlab() {
  if ! "${BACKEND_PYTHON}" - <<'PY'
import importlib.util
import sys
ok = bool(importlib.util.find_spec("reportlab")) and bool(importlib.util.find_spec("whitenoise"))
sys.exit(0 if ok else 1)
PY
  then
    echo "Required backend packages are missing. Install requirements before starting."
    exit 1
  fi
}

ensure_backend_schema() {
  echo "Applying database migrations..."
  local migrate_log
  migrate_log="$(mktemp)"
  if "${BACKEND_PYTHON}" "${ROOT_DIR}/manage.py" migrate --noinput >"${migrate_log}" 2>&1; then
    cat "${migrate_log}"
    rm -f "${migrate_log}"
    return 0
  fi
  cat "${migrate_log}"
  if [ "${ALLOW_SCHEMA_SKIP_ON_TIMEOUT}" = "1" ] && grep -q "TimeoutError: \[Errno 60\]" "${migrate_log}"; then
    echo "WARN: migrate hit a local filesystem timeout. Continuing startup without forced migrations."
    rm -f "${migrate_log}"
    return 0
  fi
  rm -f "${migrate_log}"
  return 1
}

ensure_backend_static() {
  echo "Collecting backend static assets..."
  local static_log
  static_log="$(mktemp)"
  local stale_root
  stale_root="${ROOT_DIR}/.runtime/backend-static-stale"
  mkdir -p "${stale_root}"
  if [ -d "${ROOT_DIR}/staticfiles" ]; then
    local stale_dir
    stale_dir="${stale_root}/staticfiles_stale_$(date +%s)"
    if mv "${ROOT_DIR}/staticfiles" "${stale_dir}" 2>/dev/null; then
      echo "Moved stale staticfiles to ${stale_dir}"
    else
      rm -rf "${ROOT_DIR}/staticfiles"
    fi
  fi
  mkdir -p "${ROOT_DIR}/staticfiles"
  if "${BACKEND_PYTHON}" "${ROOT_DIR}/manage.py" collectstatic --noinput >"${static_log}" 2>&1; then
    cat "${static_log}"
    rm -f "${static_log}"
    return 0
  fi
  cat "${static_log}"
  rm -f "${static_log}"
  return 1
}

clean_next_artifacts() {
  cd "${ROOT_DIR}/frontend_v2"
  local stale_root
  stale_root="${ROOT_DIR}/.runtime/frontend-next-stale"
  mkdir -p "${stale_root}"

  # Keep cleanup deterministic and fast. Move heavy `.next` aside instantly into
  # a dedicated runtime bucket. Avoid synchronous recursive pruning here because
  # it can stall startup for minutes on large local worktrees.
  if [ -d .next ]; then
    local stale_dir
    stale_dir="${stale_root}/.next_stale_$(date +%s)"
    if mv .next "${stale_dir}" 2>/dev/null; then
      echo "Moved stale .next to ${stale_dir}"
    else
      echo "WARN: could not move .next quickly; leaving existing tree in place."
    fi
  fi
  # Never prune historical .next_stale_* directories inside the hot startup
  # path. On long-lived local worktrees, deleting those hidden artifact sets can
  # stall startup for minutes.
  # Reset TS incremental cache so editor/typecheck does not keep stale `.next/types` entries.
  rm -f tsconfig.tsbuildinfo
  cd "${ROOT_DIR}"
}

clean_python_artifacts() {
  # Optional cache cleanup only. Some local filesystems can make recursive
  # find/delete very slow and block startup; keep default path fast/stable.
  if [ "${CLEAN_PY_CACHE:-0}" != "1" ]; then
    echo "Skipping Python cache cleanup (set CLEAN_PY_CACHE=1 to enable)."
    return 0
  fi
  echo "Cleaning Python cache..."
  find apps config -name "*.pyc" -delete 2>/dev/null || true
  find apps config -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
}

curl_status() {
  local url="$1"
  local code
  code="$(curl --connect-timeout 2 --max-time 8 -s -o /dev/null -w '%{http_code}' "${url}" || true)"
  echo "${code:-000}"
}

curl_body() {
  local url="$1"
  curl --connect-timeout 2 --max-time 8 -s "${url}" || true
}

curl_headers() {
  local url="$1"
  curl --connect-timeout 2 --max-time 12 -s -D - -o /dev/null "${url}" || true
}

curl_headers_retry() {
  local url="$1"
  local attempts="${2:-5}"
  local headers=""
  local attempt
  for attempt in $(seq 1 "${attempts}"); do
    headers="$(curl_headers "${url}")"
    if [ -n "${headers}" ] && echo "${headers}" | awk 'NR==1 {exit ($2 == "" ? 1 : 0)}'; then
      echo "${headers}"
      return 0
    fi
    sleep 1
  done
  echo "${headers}"
}

route_status_retry() {
  local url="$1"
  local attempts="${2:-5}"
  local code=""
  local attempt
  for attempt in $(seq 1 "${attempts}"); do
    code="$(curl_status "${url}")"
    if [ -n "${code}" ] && [ "${code}" != "000" ]; then
      echo "${code}"
      return 0
    fi
    sleep 1
  done
  echo "${code:-000}"
}

probe_route_assets() {
  local route="$1"
  local html
  local attempt
  for attempt in $(seq 1 5); do
    html="$(curl_body "http://127.0.0.1:${FRONTEND_PORT}${route}")"
    if [ -n "${html}" ]; then
      break
    fi
    sleep 1
  done
  if [ -z "${html}" ]; then
    echo "Frontend route returned empty response: ${route}"
    return 1
  fi

  local assets
  # Validate concrete static files only (avoid directory-only matches like /_next/static/chunks/).
  assets="$(echo "${html}" | grep -oE '/_next/static/[^\"'\'' ]+\.(js|css|json|woff2?)' | sort -u | head -n 40)"
  if [ -z "${assets}" ]; then
    echo "Frontend route has no static asset references: ${route}"
    return 1
  fi
  local asset_count
  asset_count="$(echo "${assets}" | sed '/^$/d' | wc -l | tr -d '[:space:]')"
  echo "Asset probe ${route}: found ${asset_count} static assets"

  while IFS= read -r asset; do
    [ -z "${asset}" ] && continue
    asset="${asset%\\}"
    asset="${asset%/}"
    [ -z "${asset}" ] && continue
    local asset_code
    asset_code="$(route_status_retry "http://127.0.0.1:${FRONTEND_PORT}${asset}")"
    if [ "${asset_code}" -lt 200 ] || [ "${asset_code}" -ge 400 ]; then
      echo "Frontend asset invalid on ${route}: ${asset} (${asset_code})"
      return 1
    fi
  done <<< "${assets}"
  echo "Asset probe ${route}: OK"
}

resolve_tracking_probe_id() {
  "${BACKEND_PYTHON}" - <<'PY'
import os
os.environ.setdefault("SKIP_CELERY_IMPORT", "1")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django
django.setup()
from apps.sales.models import SalesOrder
so_id = SalesOrder.objects.order_by("-created_at").values_list("id", flat=True).first()
print(so_id or "")
PY
}

start_backend() {
  echo "[1/3] Booting backend..."
  rotate_log "${BACKEND_LOG}"
  ensure_backend_schema
  local lan_ip
  lan_ip="$(detect_lan_ip || true)"
  local lan_hosts
  lan_hosts="$(detect_all_lan_ips || true)"
  local server_mode="${BACKEND_SERVER_MODE}"
  if [ -z "${server_mode}" ]; then
    if [ "${FRONTEND_MODE}" = "prod" ]; then
      server_mode="gunicorn"
    elif [ "$(uname -s)" = "Darwin" ]; then
      server_mode="runserver"
    else
      server_mode="gunicorn"
    fi
  fi
  local cmd
  if [ "${server_mode}" = "runserver" ]; then
    cmd="cd '${ROOT_DIR}'; export SKIP_DOTENV_IMPORT='${SKIP_DOTENV_IMPORT}'; export SKIP_CELERY_IMPORT='${SKIP_CELERY_IMPORT}'; export DEV_HOST_IP='${lan_ip}'; export DEV_TRUSTED_HOSTS='${lan_hosts}'; retries=0; while true; do \
'${BACKEND_PYTHON}' '${ROOT_DIR}/manage.py' runserver 0.0.0.0:8000 --noreload; \
code=\$?; \
if [ \$code -eq 0 ]; then exit 0; fi; \
retries=\$((retries+1)); \
if [ \$retries -gt ${MAX_RESTARTS} ]; then echo \"backend restart limit reached\"; exit \$code; fi; \
echo \"backend crashed (\$code), restarting \$retries/${MAX_RESTARTS}\"; sleep 2; \
done"
  else
    local workers="${GUNICORN_WORKERS:-3}"
    cmd="cd '${ROOT_DIR}'; export SKIP_DOTENV_IMPORT='${SKIP_DOTENV_IMPORT}'; export SKIP_CELERY_IMPORT='${SKIP_CELERY_IMPORT}'; export DEV_HOST_IP='${lan_ip}'; export DEV_TRUSTED_HOSTS='${lan_hosts}'; retries=0; while true; do \
'${BACKEND_PYTHON}' -m gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers ${workers} --timeout 120 --access-logfile - --error-logfile -; \
code=\$?; \
if [ \$code -eq 0 ]; then exit 0; fi; \
retries=\$((retries+1)); \
if [ \$retries -gt ${MAX_RESTARTS} ]; then echo \"backend restart limit reached\"; exit \$code; fi; \
echo \"backend crashed (\$code), restarting \$retries/${MAX_RESTARTS}\"; sleep 2; \
done"
  fi
  spawn_detached "${cmd}" "${BACKEND_LOG}" "${BACKEND_PID_FILE}"
}

start_frontend() {
  echo "[2/3] Booting frontend (${FRONTEND_MODE})..."
  rotate_log "${FRONTEND_LOG}"
  rotate_log "${FRONTEND_BUILD_LOG}"
  rm -f "${FRONTEND_MODE_FILE}"
  ensure_node18
  local next_dev_args="dev"
  if [ "${NEXT_DEV_TURBOPACK:-0}" = "1" ]; then
    next_dev_args="dev --turbopack"
  fi

  if [ "${FRONTEND_MODE}" = "prod" ]; then
    echo "Building frontend production bundle..."
    if (
      cd "${ROOT_DIR}" && \
      eval "$(frontend_runtime_prefix)" && \
      ./scripts/next_build_guard.sh
    ) > "${FRONTEND_BUILD_LOG}" 2>&1 && [ -f "${ROOT_DIR}/frontend_v2/.next/BUILD_ID" ]; then
      local cmd
      cmd="cd '${ROOT_DIR}/frontend_v2'; $(frontend_runtime_prefix) retries=0; while true; do \
./node_modules/.bin/next start -H 0.0.0.0 -p ${FRONTEND_PORT}; \
code=\$?; \
if [ \$code -eq 0 ]; then exit 0; fi; \
retries=\$((retries+1)); \
if [ \$retries -gt ${MAX_RESTARTS} ]; then echo \"frontend restart limit reached\"; exit \$code; fi; \
echo \"frontend crashed (\$code), restarting \$retries/${MAX_RESTARTS}\"; sleep 2; \
done"
      spawn_detached "${cmd}" "${FRONTEND_LOG}" "${FRONTEND_PID_FILE}"
      write_runtime_mode "${FRONTEND_MODE_FILE}" "prod"
    else
      if [ "${ALLOW_DEV_FALLBACK}" = "1" ]; then
        echo "WARN: prod frontend build did not produce a usable .next/BUILD_ID. Falling back to FRONTEND_MODE=dev for fast local startup."
        local cmd
        cmd="cd '${ROOT_DIR}/frontend_v2'; $(frontend_runtime_prefix) NEXT_DISABLE_CACHE=1 DISABLE_NEXT_WEBPACK_PERSISTENT_CACHE=1 ./node_modules/.bin/next ${next_dev_args} -H 0.0.0.0 -p ${FRONTEND_PORT}"
        spawn_detached "${cmd}" "${FRONTEND_LOG}" "${FRONTEND_PID_FILE}"
        write_runtime_mode "${FRONTEND_MODE_FILE}" "dev-fallback"
      else
        echo "ERROR: prod frontend build failed and fallback is disabled."
        return 1
      fi
    fi
  else
    clean_next_artifacts
    local cmd
    cmd="cd '${ROOT_DIR}/frontend_v2'; $(frontend_runtime_prefix) NEXT_DISABLE_CACHE=1 DISABLE_NEXT_WEBPACK_PERSISTENT_CACHE=1 ./node_modules/.bin/next ${next_dev_args} -H 0.0.0.0 -p ${FRONTEND_PORT}"
    spawn_detached "${cmd}" "${FRONTEND_LOG}" "${FRONTEND_PID_FILE}"
    write_runtime_mode "${FRONTEND_MODE_FILE}" "dev"
  fi
}

wait_for_basic_services() {
  for _ in $(seq 1 60); do
    local backend_code frontend_code
    backend_code="$(curl_status http://127.0.0.1:8000/api/health/)"
    frontend_code="$(curl_status http://127.0.0.1:${FRONTEND_PORT}/login)"
    backend_code="${backend_code:-000}"
    frontend_code="${frontend_code:-000}"
    if [ "${backend_code}" -ge 200 ] && [ "${backend_code}" -lt 400 ] \
      && [ "${frontend_code}" -ge 200 ] && [ "${frontend_code}" -lt 400 ]; then
      echo "Basic service health: backend=${backend_code} frontend=${frontend_code}"
      return 0
    fi
    sleep 2
  done
  return 1
}

verify_services() {
  local tracking_id="$1"
  wait_for_basic_services || return 1
  local requested_frontend_mode="${FRONTEND_MODE}"
  for _ in $(seq 1 60); do
    if curl_body http://127.0.0.1:8000/api/health >/dev/null \
      && curl_body http://127.0.0.1:8000/api/health/ >/dev/null \
      && curl_body http://127.0.0.1:8000/admin/login/ >/dev/null; then
      local frontend_pid actual_frontend_mode
      frontend_pid="$(read_pid "${FRONTEND_PID_FILE}" || true)"
      if ! pid_running "${frontend_pid}"; then
        frontend_pid="$(port_pid "${FRONTEND_PORT}")"
      fi
      actual_frontend_mode="$(detect_frontend_mode "${frontend_pid}")"
      if [ "${requested_frontend_mode}" = "prod" ] && [ "${actual_frontend_mode}" != "prod" ]; then
        echo "Frontend mode mismatch: requested prod but running ${actual_frontend_mode}."
        return 1
      fi

      local login_html
      login_html="$(curl_body http://127.0.0.1:${FRONTEND_PORT}/login)"
      if [ -z "${login_html}" ]; then
        sleep 2
        continue
      fi
      local asset_path
      asset_path="$(echo "${login_html}" | grep -oE '/_next/static/[^\"'\'' ]+\.(js|css|json|woff2?)' | head -n 1)"
      if [ -z "${asset_path}" ]; then
        echo "Frontend /login did not return static asset references."
        return 1
      fi
      local asset_code
      asset_code="$(curl_status "http://127.0.0.1:${FRONTEND_PORT}${asset_path}")"
      if [ "${asset_code}" -lt 200 ] || [ "${asset_code}" -ge 400 ]; then
        echo "Frontend static asset failed: ${asset_path} (${asset_code})"
        return 1
      fi

      local owner_code admin_code interplant_code machine_selector_code planner_code sales_create_code templates_code artworks_code traceability_code audit_center_code rolls_workspace_code settings_code inventory_root_code inventory_bulk_code inventory_bulk_transactions_code inventory_grn_code inventory_job_work_code inventory_ledger_code system_users_code orders_root_code login_route_code sales_root_code engineering_root_code system_root_code dashboard_root_code
      login_route_code="$(route_status_retry http://127.0.0.1:${FRONTEND_PORT}/login)"
      owner_code="$(route_status_retry http://127.0.0.1:${FRONTEND_PORT}/dashboard/owner)"
      admin_code="$(route_status_retry http://127.0.0.1:${FRONTEND_PORT}/dashboard/admin)"
      dashboard_root_code="$(route_status_retry http://127.0.0.1:${FRONTEND_PORT}/dashboard)"
      sales_root_code="$(route_status_retry http://127.0.0.1:${FRONTEND_PORT}/sales)"
      engineering_root_code="$(route_status_retry http://127.0.0.1:${FRONTEND_PORT}/engineering)"
      system_root_code="$(route_status_retry http://127.0.0.1:${FRONTEND_PORT}/system)"
      inventory_bulk_code="$(route_status_retry http://127.0.0.1:${FRONTEND_PORT}/inventory/bulk-v36)"
      inventory_bulk_transactions_code="$(route_status_retry http://127.0.0.1:${FRONTEND_PORT}/inventory/bulk-transactions)"
      inventory_grn_code="$(route_status_retry http://127.0.0.1:${FRONTEND_PORT}/inventory/grn-v36)"
      interplant_code="$(route_status_retry http://127.0.0.1:${FRONTEND_PORT}/inventory/inter-plant)"
      inventory_job_work_code="$(route_status_retry http://127.0.0.1:${FRONTEND_PORT}/inventory/job-work)"
      inventory_ledger_code="$(route_status_retry http://127.0.0.1:${FRONTEND_PORT}/inventory/ledger)"
      machine_selector_code="$(route_status_retry http://127.0.0.1:${FRONTEND_PORT}/production/machine-selector)"
      planner_code="$(route_status_retry http://127.0.0.1:${FRONTEND_PORT}/production/planner)"
      sales_create_code="$(route_status_retry http://127.0.0.1:${FRONTEND_PORT}/sales/orders/create)"
      templates_code="$(route_status_retry http://127.0.0.1:${FRONTEND_PORT}/engineering/templates)"
      artworks_code="$(route_status_retry http://127.0.0.1:${FRONTEND_PORT}/engineering/artworks)"
      traceability_code="$(route_status_retry http://127.0.0.1:${FRONTEND_PORT}/inventory/traceability)"
      audit_center_code="$(route_status_retry http://127.0.0.1:${FRONTEND_PORT}/system/audit)"
      rolls_workspace_code="$(route_status_retry http://127.0.0.1:${FRONTEND_PORT}/inventory/rolls-v36)"
      settings_code="$(route_status_retry http://127.0.0.1:${FRONTEND_PORT}/system/settings)"
      system_users_code="$(route_status_retry http://127.0.0.1:${FRONTEND_PORT}/system/users)"
      inventory_root_code="$(route_status_retry http://127.0.0.1:${FRONTEND_PORT}/inventory)"
      orders_root_code="$(route_status_retry http://127.0.0.1:${FRONTEND_PORT}/orders)"
      echo "Route probes: login=${login_route_code}, owner=${owner_code}, admin=${admin_code}, dashboard=${dashboard_root_code}, sales=${sales_root_code}, engineering=${engineering_root_code}, system=${system_root_code}, inventory-bulk-v36=${inventory_bulk_code}, inventory-bulk-transactions=${inventory_bulk_transactions_code}, inventory-grn-v36=${inventory_grn_code}, inter-plant=${interplant_code}, inventory-job-work=${inventory_job_work_code}, inventory-ledger=${inventory_ledger_code}, machine-selector=${machine_selector_code}, planner=${planner_code}, sales-create=${sales_create_code}, templates=${templates_code}, artworks=${artworks_code}, traceability=${traceability_code}, audit-center=${audit_center_code}, rolls-v36=${rolls_workspace_code}, settings=${settings_code}, system-users=${system_users_code}, inventory=${inventory_root_code}, orders=${orders_root_code}"
      if [ "${login_route_code}" -ge 500 ] || [ "${owner_code}" -ge 500 ] || [ "${admin_code}" -ge 500 ] || [ "${dashboard_root_code}" -ge 500 ] || [ "${sales_root_code}" -ge 500 ] || [ "${engineering_root_code}" -ge 500 ] || [ "${system_root_code}" -ge 500 ] || [ "${inventory_bulk_code}" -ge 500 ] || [ "${inventory_bulk_transactions_code}" -ge 500 ] || [ "${inventory_grn_code}" -ge 500 ] || [ "${interplant_code}" -ge 500 ] || [ "${inventory_job_work_code}" -ge 500 ] || [ "${inventory_ledger_code}" -ge 500 ] || [ "${machine_selector_code}" -ge 500 ] || [ "${planner_code}" -ge 500 ] || [ "${sales_create_code}" -ge 500 ] || [ "${templates_code}" -ge 500 ] || [ "${artworks_code}" -ge 500 ] || [ "${traceability_code}" -ge 500 ] || [ "${audit_center_code}" -ge 500 ] || [ "${rolls_workspace_code}" -ge 500 ] || [ "${settings_code}" -ge 500 ] || [ "${system_users_code}" -ge 500 ] || [ "${inventory_root_code}" -ge 500 ] || [ "${orders_root_code}" -ge 500 ]; then
        echo "Dynamic route failure (login=${login_route_code}, owner=${owner_code}, admin=${admin_code}, dashboard=${dashboard_root_code}, sales=${sales_root_code}, engineering=${engineering_root_code}, system=${system_root_code}, inventory-bulk-v36=${inventory_bulk_code}, inventory-bulk-transactions=${inventory_bulk_transactions_code}, inventory-grn-v36=${inventory_grn_code}, inter-plant=${interplant_code}, inventory-job-work=${inventory_job_work_code}, inventory-ledger=${inventory_ledger_code}, machine-selector=${machine_selector_code}, planner=${planner_code}, sales-create=${sales_create_code}, templates=${templates_code}, artworks=${artworks_code}, traceability=${traceability_code}, audit-center=${audit_center_code}, rolls-v36=${rolls_workspace_code}, settings=${settings_code}, system-users=${system_users_code}, inventory=${inventory_root_code}, orders=${orders_root_code})"
        return 1
      fi

      probe_route_assets "/login" || return 1
      probe_route_assets "/dashboard" || return 1
      probe_route_assets "/dashboard/owner" || return 1
      probe_route_assets "/sales" || return 1
      probe_route_assets "/engineering" || return 1
      probe_route_assets "/system" || return 1
      probe_route_assets "/inventory" || return 1
      probe_route_assets "/inventory/alerts" || return 1
      probe_route_assets "/inventory/bulk-v36" || return 1
      probe_route_assets "/inventory/bulk-transactions" || return 1
      probe_route_assets "/inventory/grn-v36" || return 1
      probe_route_assets "/inventory/inter-plant" || return 1
      probe_route_assets "/inventory/job-work" || return 1
      probe_route_assets "/inventory/ledger" || return 1
      probe_route_assets "/sales/orders/create" || return 1
      probe_route_assets "/engineering/templates" || return 1
      probe_route_assets "/engineering/artworks" || return 1
      probe_route_assets "/master/granules" || return 1
      probe_route_assets "/master/inks" || return 1
      probe_route_assets "/master/packaging" || return 1
      probe_route_assets "/master/pod" || return 1
      probe_route_assets "/master/recipes" || return 1
      probe_route_assets "/master/vendors" || return 1
      probe_route_assets "/orders" || return 1
      probe_route_assets "/orders/create" || return 1
      probe_route_assets "/production/planner" || return 1
      probe_route_assets "/production/machine-selector" || return 1
      probe_route_assets "/inventory/traceability" || return 1
      probe_route_assets "/system/audit" || return 1
      probe_route_assets "/system/governance" || return 1
      probe_route_assets "/system/role-matrix" || return 1
      probe_route_assets "/system/settings" || return 1
      probe_route_assets "/system/users" || return 1
      probe_route_assets "/inventory/rolls-v36" || return 1

      if [ -n "${tracking_id}" ]; then
        local tracking_code
        tracking_code="$(curl_status "http://127.0.0.1:${FRONTEND_PORT}/sales/orders/${tracking_id}/tracking")"
        if [ "${tracking_code}" -ge 500 ]; then
          echo "Tracking route failed (${tracking_code}) for order ${tracking_id}"
          return 1
        fi
      fi

      local me_headers
      me_headers="$(curl_headers_retry http://127.0.0.1:${FRONTEND_PORT}/api/users/me)"
      if echo "${me_headers}" | grep -qi "^Location:"; then
        echo "Redirect loop detected on /api/users/me"
        return 1
      fi
      # Verify core API routes do not enter redirect loops on slash/no-slash forms.
      # These are heavily used by Sales/Template screens.
      for api_path in \
        "/api/master/film-families" \
        "/api/master/film-families/" \
        "/api/master/film-variants" \
        "/api/master/film-variants/" \
        "/api/templates" \
        "/api/templates/"; do
        local api_headers api_code
        api_headers="$(curl_headers_retry "http://127.0.0.1:${FRONTEND_PORT}${api_path}")"
        api_code="$(echo "${api_headers}" | awk 'NR==1 {print $2}')"
        if echo "${api_headers}" | grep -qi "^Location:"; then
          echo "Redirect loop detected on ${api_path}"
          return 1
        fi
        if [ -z "${api_code}" ] || [ "${api_code}" -ge 500 ]; then
          echo "API probe failed on ${api_path} (${api_code:-NO_RESPONSE})"
          return 1
        fi
      done
      return 0
    fi
    sleep 2
  done
  return 1
}

stop_services() {
  local bpid fpid
  bpid="$(read_pid "${BACKEND_PID_FILE}" || true)"
  fpid="$(read_pid "${FRONTEND_PID_FILE}" || true)"
  if [ -n "${bpid}" ]; then
    kill_pid_tree "${bpid}"
    rm -f "${BACKEND_PID_FILE}"
  fi
  if [ -n "${fpid}" ]; then
    kill_pid_tree "${fpid}"
    rm -f "${FRONTEND_PID_FILE}"
  fi
  pgrep -f "${ROOT_DIR}/manage.py runserver 0.0.0.0:8000 --noreload" 2>/dev/null | xargs kill -9 2>/dev/null || true
  pgrep -f "gunicorn config.wsgi:application --bind 0.0.0.0:8000" 2>/dev/null | xargs kill -9 2>/dev/null || true
  pgrep -f "next start -H 0.0.0.0 -p ${FRONTEND_PORT}" 2>/dev/null | xargs kill -9 2>/dev/null || true
  pgrep -f "npm run dev" 2>/dev/null | xargs kill -9 2>/dev/null || true
  pgrep -f "${ROOT_DIR}/frontend_v2" 2>/dev/null | xargs kill -9 2>/dev/null || true
  lsof -ti:8000 | xargs kill -9 2>/dev/null || true
  lsof -ti:"${FRONTEND_PORT}" | xargs kill -9 2>/dev/null || true
  rm -f "${BACKEND_PID_FILE}" "${FRONTEND_PID_FILE}"
  rm -f "${FRONTEND_MODE_FILE}"
}

status_services() {
  local bpid fpid
  bpid="$(read_pid "${BACKEND_PID_FILE}" || true)"
  fpid="$(read_pid "${FRONTEND_PID_FILE}" || true)"
  if ! pid_running "${bpid}"; then
    bpid="$(port_pid 8000)"
  fi
  if ! pid_running "${fpid}"; then
    fpid="$(port_pid "${FRONTEND_PORT}")"
  fi

  if pid_running "${bpid}"; then
    echo "Backend: running (PID ${bpid})"
  else
    echo "Backend: stopped"
  fi

  if pid_running "${fpid}"; then
    local actual_frontend_mode
    actual_frontend_mode="$(detect_frontend_mode "${fpid}")"
    echo "Frontend: running (PID ${fpid}) mode=${actual_frontend_mode} requested=${FRONTEND_MODE}"
  else
    echo "Frontend: stopped"
  fi
}

start_services() {
  resolve_backend_python
  ensure_reportlab
  ensure_backend_static
  stop_services
  clean_python_artifacts
  start_backend
  start_frontend
  echo "[3/3] Waiting for basic service health..."
  if ! wait_for_basic_services; then
    echo "Basic startup health checks failed. See logs."
    exit 1
  fi

  sleep 2
  if ! lsof -ti:8000 >/dev/null 2>&1 || ! lsof -ti:"${FRONTEND_PORT}" >/dev/null 2>&1; then
    echo "Basic health passed but one or more services exited during stability hold."
    exit 1
  fi

  echo "Servers started successfully."
  echo "Runtime logs: ${LOG_DIR}"
  echo "Backend log: ${BACKEND_LOG}"
  echo "Frontend log: ${FRONTEND_LOG}"
  echo "Frontend build log: ${FRONTEND_BUILD_LOG}"
  echo "Run './start_all.sh verify' for deep route/auth/API validation."
  echo "Manual QA: frontend=http://127.0.0.1:${FRONTEND_PORT}/login backend-health=http://127.0.0.1:8000/api/health/"
  local lan_ip
  lan_ip="$(detect_lan_ip | tr -d '[:space:]')"
  if [ -n "${lan_ip}" ]; then
    echo "LAN access: frontend=http://${lan_ip}:${FRONTEND_PORT} backend=http://${lan_ip}:8000"
    echo "LAN QA: login=http://${lan_ip}:${FRONTEND_PORT}/login health=http://${lan_ip}:8000/api/health/"
  else
    echo "LAN access: could not auto-detect host IP, run 'ifconfig | grep \"inet \"' and use :${FRONTEND_PORT}/:8000."
  fi
}

run_verification() {
  resolve_backend_python
  echo "Running deep verification..."
  local tracking_id
  tracking_id="$(resolve_tracking_probe_id || true)"
  if verify_services "${tracking_id}"; then
    echo "Deep verification passed."
    echo "Runtime logs: ${LOG_DIR}"
  else
    echo "Deep verification failed. See logs."
    exit 1
  fi
}

case "${CMD}" in
  start)
    acquire_bootstrap_lock
    trap release_bootstrap_lock EXIT INT TERM
    start_services
    ;;
  verify)
    run_verification
    ;;
  stop)
    acquire_bootstrap_lock
    trap release_bootstrap_lock EXIT INT TERM
    stop_services
    echo "Servers stopped."
    ;;
  restart)
    acquire_bootstrap_lock
    trap release_bootstrap_lock EXIT INT TERM
    stop_services
    start_services
    ;;
  clean-restart)
    acquire_bootstrap_lock
    trap release_bootstrap_lock EXIT INT TERM
    echo "Running deterministic clean restart..."
    stop_services
    rm -f "${BACKEND_PID_FILE}" "${FRONTEND_PID_FILE}"
    clean_next_artifacts
    start_services
    run_verification
    ;;
  status)
    status_services
    ;;
  *)
    usage
    exit 1
    ;;
esac
