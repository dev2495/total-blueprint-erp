#!/usr/bin/env bash
set -euo pipefail

# This is a reviewed activation action, not a discovery/readiness probe.
RELEASE_DIR="${1:?candidate release directory required}"
[[ "$RELEASE_DIR" =~ ^/opt/tpp-erp/releases/[0-9a-f]{12}$ ]]
BASELINE_SHA256=6d1b2a9f108f7fba0e974b73c5649b2bc49f6f48fbb3c5cb155a26275b01db29
CURRENT=/etc/caddy/Caddyfile
CANDIDATE="$RELEASE_DIR/deploy/aws/Caddyfile.domain"
PRESERVED="$RELEASE_DIR/caddy-before-gate.conf"
test ! -e "$PRESERVED"
test "$(sha256sum "$CURRENT" | cut -d ' ' -f 1)" = "$BASELINE_SHA256"
test "$(docker network inspect tpp-erp-private --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}')" = 172.18.0.1
# Match only the independently evidenced loopback-to-Docker proxy address;
# never trust broad private address ranges or an incoming X-Forwarded-For.
grep -q 'header_up X-Real-IP {remote_host}' "$CANDIDATE"
caddy validate --config "$CANDIDATE" --adapter caddyfile
cp --preserve=mode,ownership,timestamps "$CURRENT" "$PRESERVED"
restore_caddy() {
  cp --preserve=mode,ownership,timestamps "$PRESERVED" "$CURRENT"
  caddy validate --config "$CURRENT" --adapter caddyfile
  systemctl reload caddy
}
trap 'rc=$?; trap - ERR; restore_caddy; exit "$rc"' ERR
install -o root -g root -m 644 "$CANDIDATE" "$CURRENT"
systemctl reload caddy
systemctl is-active --quiet caddy
trap - ERR
echo "Caddy now overwrites the gate client-address header; original configuration preserved."
