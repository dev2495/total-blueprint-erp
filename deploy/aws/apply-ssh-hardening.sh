#!/usr/bin/env bash
set -euo pipefail

CONFIG_SOURCE="${1:-$(cd "$(dirname "$0")" && pwd)/sshd-hardening.conf}"
TARGET="/etc/ssh/sshd_config.d/99-tpp-erp-hardening.conf"
BACKUP="${TARGET}.pre-change"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (for example: sudo $0)." >&2
  exit 1
fi
if [[ ! -r "$CONFIG_SOURCE" ]]; then
  echo "SSH hardening config not found: $CONFIG_SOURCE" >&2
  exit 1
fi

if [[ -e "$TARGET" ]]; then
  install -o root -g root -m 0644 "$TARGET" "$BACKUP"
fi
install -o root -g root -m 0644 "$CONFIG_SOURCE" "$TARGET"

if ! /usr/sbin/sshd -t; then
  if [[ -e "$BACKUP" ]]; then
    install -o root -g root -m 0644 "$BACKUP" "$TARGET"
  else
    rm -f "$TARGET"
  fi
  echo "sshd configuration validation failed; previous configuration restored." >&2
  exit 1
fi

systemctl reload ssh
echo "SSH hardening applied and sshd reloaded."
