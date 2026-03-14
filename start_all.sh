#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_LOG="${ROOT_DIR}/backend.log"
FRONTEND_LOG="${ROOT_DIR}/frontend.log"
FRONTEND_BUILD_LOG="${ROOT_DIR}/frontend_build.log"
BACKEND_PID_FILE="${ROOT_DIR}/.backend_pid"
FRONTEND_PID_FILE="${ROOT_DIR}/.frontend_pid"
MAX_RESTARTS="${MAX_RESTARTS:-3}"
FRONTEND_MODE="${FRONTEND_MODE:-prod}" # prod|dev
ALLOW_DEV_FALLBACK="${ALLOW_DEV_FALLBACK:-1}" # 1 => fallback to dev if prod build is unstable
BUILD_MAX_ATTEMPTS="${BUILD_MAX_ATTEMPTS:-1}" # keep startup fast; fallback handles instability
BUILD_TIMEOUT_SECONDS="${BUILD_TIMEOUT_SECONDS:-240}"
CMD="${1:-start}"
NODE18_BIN_DIR=""

usage() {
  cat <<EOF
Usage: ./start_all.sh [start|stop|restart|clean-restart|status]
Environment:
  FRONTEND_MODE=prod|dev    (default: prod)
  ALLOW_DEV_FALLBACK=1      (default: 1, auto-fallback to dev when prod build fails/hangs)
  BUILD_MAX_ATTEMPTS=1      (default: 1, prod build attempts before fallback)
  BUILD_TIMEOUT_SECONDS=240  (default: 240, timeout per prod build attempt)
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

rotate_log() {
  local file="$1"
  if [ -f "$file" ]; then
    local ts
    ts="$(date +%Y%m%d_%H%M%S)"
    mv "$file" "${file}.${ts}"
  fi
}

read_pid() {
  local file="$1"
  if [ -f "$file" ]; then
    local pid
    pid="$(tr -d '[:space:]' < "$file")"
    if [[ "$pid" =~ ^[0-9]+$ ]] && [ "$pid" -gt 1 ]; then
      echo "$pid"
    fi
  fi
}

pid_running() {
  local pid="$1"
  [[ "${pid}" =~ ^[0-9]+$ ]] && [ "${pid}" -gt 1 ] && kill -0 "${pid}" 2>/dev/null
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

spawn_detached() {
  local cmd="$1"
  local log_file="$2"
  local pid_file="$3"

  # Prefer a new session to survive parent-shell/process-group teardown.
  if command -v setsid >/dev/null 2>&1; then
    setsid bash -lc "${cmd}" >> "${log_file}" 2>&1 < /dev/null &
  else
    nohup bash -lc "${cmd}" >> "${log_file}" 2>&1 < /dev/null &
  fi
  echo $! > "${pid_file}"
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

frontend_runtime_prefix() {
  local prefix=""
  if [ -n "${NODE18_BIN_DIR}" ]; then
    prefix="export PATH='${NODE18_BIN_DIR}':\$PATH; hash -r; "
  fi
  printf "%sexport DISABLE_NEXT_WEBPACK_PERSISTENT_CACHE=1; export NEXT_DISABLE_CACHE=1; " "${prefix}"
}

ensure_reportlab() {
  if ! "${ROOT_DIR}/venv_311/bin/python" - <<'PY'
import importlib.util
import sys
ok = bool(importlib.util.find_spec("reportlab"))
sys.exit(0 if ok else 1)
PY
  then
    echo "reportlab is missing in venv_311. Install requirements before starting."
    exit 1
  fi
}

ensure_backend_schema() {
  echo "Applying database migrations..."
  "${ROOT_DIR}/venv_311/bin/python" "${ROOT_DIR}/manage.py" migrate --noinput
}

clean_next_artifacts() {
  cd "${ROOT_DIR}/frontend_v2"
  # Keep cleanup deterministic and fast. Move heavy `.next` aside instantly.
  # Avoid recursive stale cleanup here because some local stale trees can stall
  # filesystem operations and block startup.
  if [ -d .next ]; then
    local stale_dir
    stale_dir=".next_stale_$(date +%s)"
    if mv .next "${stale_dir}" 2>/dev/null; then
      echo "Moved stale .next to ${stale_dir}"
    else
      echo "WARN: could not move .next quickly; leaving existing tree in place."
    fi
  fi
  rm -rf node_modules/.cache
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

probe_route_assets() {
  local route="$1"
  local html
  html="$(curl -s "http://127.0.0.1:3000${route}" || true)"
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
    asset_code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3000${asset}" || true)"
    if [ "${asset_code}" -lt 200 ] || [ "${asset_code}" -ge 400 ]; then
      echo "Frontend asset invalid on ${route}: ${asset} (${asset_code})"
      return 1
    fi
  done <<< "${assets}"
  echo "Asset probe ${route}: OK"
}

resolve_tracking_probe_id() {
  "${ROOT_DIR}/venv_311/bin/python" - <<'PY'
import os
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django
django.setup()
from apps.sales.models import SalesOrder
so_id = SalesOrder.objects.order_by("-created_at").values_list("id", flat=True).first()
print(so_id or "")
PY
}

start_backend() {
  rotate_log "${BACKEND_LOG}"
  ensure_backend_schema
  local workers="${GUNICORN_WORKERS:-3}"
  local cmd
  cmd="cd '${ROOT_DIR}'; retries=0; while true; do \
${ROOT_DIR}/venv_311/bin/gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers ${workers} --timeout 120 --access-logfile - --error-logfile -; \
code=\$?; \
if [ \$code -eq 0 ]; then exit 0; fi; \
retries=\$((retries+1)); \
if [ \$retries -gt ${MAX_RESTARTS} ]; then echo \"backend restart limit reached\"; exit \$code; fi; \
echo \"backend crashed (\$code), restarting \$retries/${MAX_RESTARTS}\"; sleep 2; \
done"
  spawn_detached "${cmd}" "${BACKEND_LOG}" "${BACKEND_PID_FILE}"
}

start_frontend() {
  rotate_log "${FRONTEND_LOG}"
  rotate_log "${FRONTEND_BUILD_LOG}"
  ensure_node18

  if [ "${FRONTEND_MODE}" = "prod" ]; then
    clean_next_artifacts
    if MAX_BUILD_ATTEMPTS="${BUILD_MAX_ATTEMPTS}" MAX_BUILD_SECONDS="${BUILD_TIMEOUT_SECONDS}" bash "${ROOT_DIR}/scripts/next_build_guard.sh" > "${FRONTEND_BUILD_LOG}" 2>&1; then
      local cmd
      cmd="cd '${ROOT_DIR}/frontend_v2'; $(frontend_runtime_prefix) retries=0; while true; do \
./node_modules/.bin/next start -H 0.0.0.0 -p 3000; \
code=\$?; \
if [ \$code -eq 0 ]; then exit 0; fi; \
retries=\$((retries+1)); \
if [ \$retries -gt ${MAX_RESTARTS} ]; then echo \"frontend restart limit reached\"; exit \$code; fi; \
echo \"frontend crashed (\$code), restarting \$retries/${MAX_RESTARTS}\"; sleep 2; \
done"
      spawn_detached "${cmd}" "${FRONTEND_LOG}" "${FRONTEND_PID_FILE}"
    else
      if [ "${ALLOW_DEV_FALLBACK}" = "1" ]; then
        echo "WARN: prod build failed/hung. Falling back to FRONTEND_MODE=dev for fast local startup."
        local cmd
        cmd="cd '${ROOT_DIR}/frontend_v2'; $(frontend_runtime_prefix) npm run dev"
        spawn_detached "${cmd}" "${FRONTEND_LOG}" "${FRONTEND_PID_FILE}"
      else
        echo "ERROR: prod frontend build failed and fallback is disabled."
        return 1
      fi
    fi
  else
    clean_next_artifacts
    local cmd
    cmd="cd '${ROOT_DIR}/frontend_v2'; $(frontend_runtime_prefix) npm run dev"
    spawn_detached "${cmd}" "${FRONTEND_LOG}" "${FRONTEND_PID_FILE}"
  fi
}

wait_for_services() {
  local tracking_id="$1"
  for _ in $(seq 1 60); do
    if curl -s http://127.0.0.1:8000/api/health >/dev/null \
      && curl -s http://127.0.0.1:8000/api/health/ >/dev/null \
      && curl -s http://127.0.0.1:8000/admin/login/ >/dev/null; then

      local login_html
      login_html="$(curl -s http://127.0.0.1:3000/login || true)"
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
      asset_code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3000${asset_path}" || true)"
      if [ "${asset_code}" -lt 200 ] || [ "${asset_code}" -ge 400 ]; then
        echo "Frontend static asset failed: ${asset_path} (${asset_code})"
        return 1
      fi

      local owner_code admin_code interplant_code machine_selector_code planner_code sales_create_code templates_code artworks_code traceability_code
      owner_code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/dashboard/owner || true)"
      admin_code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/dashboard/admin || true)"
      interplant_code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/inventory/inter-plant || true)"
      machine_selector_code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/production/machine-selector || true)"
      planner_code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/production/planner || true)"
      sales_create_code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/sales/orders/create || true)"
      templates_code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/engineering/templates || true)"
      artworks_code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/engineering/artworks || true)"
      traceability_code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/inventory/traceability || true)"
      echo "Route probes: owner=${owner_code}, admin=${admin_code}, inter-plant=${interplant_code}, machine-selector=${machine_selector_code}, planner=${planner_code}, sales-create=${sales_create_code}, templates=${templates_code}, artworks=${artworks_code}, traceability=${traceability_code}"
      if [ "${owner_code}" -ge 500 ] || [ "${admin_code}" -ge 500 ] || [ "${interplant_code}" -ge 500 ] || [ "${machine_selector_code}" -ge 500 ] || [ "${planner_code}" -ge 500 ] || [ "${sales_create_code}" -ge 500 ] || [ "${templates_code}" -ge 500 ] || [ "${artworks_code}" -ge 500 ] || [ "${traceability_code}" -ge 500 ]; then
        echo "Dynamic route failure (owner=${owner_code}, admin=${admin_code}, inter-plant=${interplant_code}, machine-selector=${machine_selector_code}, planner=${planner_code}, sales-create=${sales_create_code}, templates=${templates_code}, artworks=${artworks_code}, traceability=${traceability_code})"
        return 1
      fi

      probe_route_assets "/dashboard/owner" || return 1
      probe_route_assets "/sales/orders/create" || return 1
      probe_route_assets "/engineering/templates" || return 1
      probe_route_assets "/engineering/artworks" || return 1
      probe_route_assets "/production/planner" || return 1
      probe_route_assets "/production/machine-selector" || return 1
      probe_route_assets "/inventory/traceability" || return 1

      if [ -n "${tracking_id}" ]; then
        local tracking_code
        tracking_code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3000/sales/orders/${tracking_id}/tracking" || true)"
        if [ "${tracking_code}" -ge 500 ]; then
          echo "Tracking route failed (${tracking_code}) for order ${tracking_id}"
          return 1
        fi
      fi

      local me_headers
      me_headers="$(curl -s -D - -o /dev/null http://127.0.0.1:3000/api/users/me || true)"
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
        api_headers="$(curl -s -D - -o /dev/null "http://127.0.0.1:3000${api_path}" || true)"
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
  lsof -ti:8000 | xargs kill -9 2>/dev/null || true
  lsof -ti:3000 | xargs kill -9 2>/dev/null || true
}

status_services() {
  local bpid fpid
  bpid="$(read_pid "${BACKEND_PID_FILE}" || true)"
  fpid="$(read_pid "${FRONTEND_PID_FILE}" || true)"

  if pid_running "${bpid}"; then
    echo "Backend: running (PID ${bpid})"
  else
    echo "Backend: stopped"
  fi

  if pid_running "${fpid}"; then
    echo "Frontend: running (PID ${fpid}) mode=${FRONTEND_MODE}"
  else
    echo "Frontend: stopped"
  fi
}

start_services() {
  ensure_reportlab
  stop_services
  clean_python_artifacts
  start_backend
  start_frontend
  local tracking_id
  tracking_id="$(resolve_tracking_probe_id || true)"
  if wait_for_services "${tracking_id}"; then
    # Quick stability hold to catch immediate supervisor exits after health turns green.
    sleep 2
    if ! lsof -ti:8000 >/dev/null 2>&1 || ! lsof -ti:3000 >/dev/null 2>&1; then
      echo "Startup health checks passed but one or more services exited during stability hold."
      exit 1
    fi
    echo "Servers started successfully."
    echo "Backend log: ${BACKEND_LOG}"
    echo "Frontend log: ${FRONTEND_LOG}"
    echo "Frontend build log: ${FRONTEND_BUILD_LOG}"
    echo "Manual QA: frontend=http://127.0.0.1:3000/login backend-health=http://127.0.0.1:8000/api/health/"
    local lan_ip
    lan_ip="$(detect_lan_ip | tr -d '[:space:]')"
    if [ -n "${lan_ip}" ]; then
      echo "LAN access: frontend=http://${lan_ip}:3000 backend=http://${lan_ip}:8000"
      echo "LAN QA: login=http://${lan_ip}:3000/login health=http://${lan_ip}:8000/api/health/"
    else
      echo "LAN access: could not auto-detect host IP, run 'ipconfig getifaddr en0' and use :3000/:8000."
    fi
  else
    echo "Startup health checks failed. See logs."
    exit 1
  fi
}

case "${CMD}" in
  start)
    start_services
    ;;
  stop)
    stop_services
    echo "Servers stopped."
    ;;
  restart)
    stop_services
    start_services
    ;;
  clean-restart)
    echo "Running deterministic clean restart..."
    stop_services
    rm -f "${BACKEND_PID_FILE}" "${FRONTEND_PID_FILE}"
    clean_next_artifacts
    start_services
    ;;
  status)
    status_services
    ;;
  *)
    usage
    exit 1
    ;;
esac
