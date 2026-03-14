#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:8000}"
FRONTEND_BASE_URL="${FRONTEND_BASE_URL:-http://127.0.0.1:3000}"
SMOKE_EMAIL="${SMOKE_EMAIL:-}"
SMOKE_PASSWORD="${SMOKE_PASSWORD:-}"
SMOKE_MACHINE_ID="${SMOKE_MACHINE_ID:-}"
SMOKE_CHALLAN_ID="${SMOKE_CHALLAN_ID:-}"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

cookie_jar="$tmp_dir/cookies.txt"
headers_file="$tmp_dir/headers.txt"

echo "[1/8] Health endpoints"
curl -fsS "${API_BASE_URL}/api/health/live/" >/dev/null
curl -fsS "${API_BASE_URL}/api/health/ready/" >/dev/null

echo "[2/8] Frontend availability"
curl -fsSI "${FRONTEND_BASE_URL}/login" >/dev/null

echo "[3/8] CSRF bootstrap"
curl -fsS -c "$cookie_jar" "${API_BASE_URL}/api/users/csrf/" >"$tmp_dir/csrf.json"
csrf_token="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], "r", encoding="utf-8")).get("csrfToken", ""))' "$tmp_dir/csrf.json")"

if [ -z "$SMOKE_EMAIL" ] || [ -z "$SMOKE_PASSWORD" ]; then
  echo "SMOKE_EMAIL/SMOKE_PASSWORD not provided; skipping authenticated checks."
  exit 0
fi

echo "[4/8] Login (cookie auth)"
login_payload="$(printf '{"identifier":"%s","password":"%s"}' "$SMOKE_EMAIL" "$SMOKE_PASSWORD")"
curl -fsS -b "$cookie_jar" -c "$cookie_jar" \
  -H "Content-Type: application/json" \
  -H "X-CSRFToken: ${csrf_token}" \
  -d "$login_payload" \
  "${API_BASE_URL}/api/users/login/" >"$tmp_dir/login.json"

echo "[5/8] Me endpoint"
curl -fsS -b "$cookie_jar" "${API_BASE_URL}/api/users/me/" >"$tmp_dir/me.json"

echo "[6/8] Refresh endpoint (cookie-only)"
curl -fsS -b "$cookie_jar" -c "$cookie_jar" \
  -H "Content-Type: application/json" \
  -H "X-CSRFToken: ${csrf_token}" \
  -d '{}' \
  "${API_BASE_URL}/api/users/token/refresh/" >"$tmp_dir/refresh.json"

echo "[7/8] Core ERP module probes"
curl -fsS -b "$cookie_jar" "${API_BASE_URL}/api/sales/orders/" >/dev/null
curl -fsS -b "$cookie_jar" "${API_BASE_URL}/api/production/operator/machines/" >/dev/null
curl -fsS -b "$cookie_jar" "${API_BASE_URL}/api/inventory/inter-plant/" >/dev/null

if [ -n "$SMOKE_MACHINE_ID" ]; then
  echo "Checking machine queue for ${SMOKE_MACHINE_ID}"
  curl -fsS -b "$cookie_jar" "${API_BASE_URL}/api/production/machine/${SMOKE_MACHINE_ID}/queue/" >/dev/null
fi

if [ -n "$SMOKE_CHALLAN_ID" ]; then
  echo "Checking challan PDF for ${SMOKE_CHALLAN_ID}"
  curl -fsS -b "$cookie_jar" "${API_BASE_URL}/api/inventory/inter-plant/${SMOKE_CHALLAN_ID}/print-pdf/" -o /dev/null
fi

echo "[8/8] Logout"
curl -fsS -b "$cookie_jar" -c "$cookie_jar" \
  -H "Content-Type: application/json" \
  -H "X-CSRFToken: ${csrf_token}" \
  -d '{}' \
  "${API_BASE_URL}/api/users/logout/" >/dev/null

echo "Smoke checks passed."
