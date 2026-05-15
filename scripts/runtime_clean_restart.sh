#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
START_SCRIPT="${ROOT_DIR}/start_all.sh"
BACKEND_PID_FILE="${ROOT_DIR}/.backend_pid"
FRONTEND_PID_FILE="${ROOT_DIR}/.frontend_pid"
FRONTEND_PORT="${FRONTEND_PORT:-3001}"

echo "[runtime] root: ${ROOT_DIR}"
echo "[runtime] stopping managed services"
"${START_SCRIPT}" stop || true

echo "[runtime] killing orphan listeners on 8000/${FRONTEND_PORT}"
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
lsof -ti:"${FRONTEND_PORT}" | xargs kill -9 2>/dev/null || true

echo "[runtime] removing stale pid files"
rm -f "${BACKEND_PID_FILE}" "${FRONTEND_PID_FILE}"

echo "[runtime] clearing frontend build cache"
rm -rf "${ROOT_DIR}/frontend_v2/.next"

echo "[runtime] starting fresh stack"
"${START_SCRIPT}" start

echo "[runtime] probing key pages"
for route in \
  "/dashboard/admin" \
  "/engineering/templates" \
  "/production/planner" \
  "/inventory/job-work" \
  "/master/vendors" \
  "/sales/orders/create" \
  "/inventory/rolls-v36"
do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${FRONTEND_PORT}${route}" || true)"
  echo "  ${route} -> ${code}"
done

echo "[runtime] clean restart complete"
