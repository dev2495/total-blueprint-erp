#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../../.." && pwd)"
source_dir="${script_dir}/native-helper"
public_dir="${repo_root}/frontend_v2/public/downloads/epson-fx2175ii"
output="${public_dir}/TotalPolyPrint-Epson-Setup.exe"
checksum_file="${public_dir}/SHA256SUMS.txt"

mkdir -p "${public_dir}"

cd "${source_dir}"
go test ./...
go vet ./...
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build \
  -buildvcs=false \
  -trimpath \
  -ldflags="-buildid= -s -w -H=windowsgui" \
  -o "${output}" \
  .

echo "Built ${output}"
checksum="$(shasum -a 256 "${output}" | awk '{print $1}')"
printf '%s  %s\n' "${checksum}" "$(basename "${output}")" > "${checksum_file}"
echo "SHA-256 ${checksum}"
