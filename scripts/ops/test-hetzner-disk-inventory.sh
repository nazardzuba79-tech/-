#!/usr/bin/env bash
# Safe fixture checks: syntax/help/refusal, never invokes privileged commands.
set -euo pipefail
script="$(dirname "$0")/hetzner-disk-inventory.sh"
bash -n "$script"
output="$(bash "$script" --help)"
[[ "$output" == *"Read-only; stdout only."* ]]
set +e
bash "$script" --invalid >/dev/null 2>&1
result=$?
set -e
[[ $result -eq 2 ]]
# An accidental new destructive operation must stop review before deployment.
if grep -nE '^[[:space:]]*(sudo[[:space:]]+)?(rm|rmdir|shred|truncate|dd|mkfs|docker[[:space:]]+(prune|system[[:space:]]+prune|volume[[:space:]]+rm)|systemctl[[:space:]]+(stop|restart|reload)|find[[:space:]].*-delete)([[:space:]]|$)' "$script"; then
  echo 'FAIL: destructive command found'
  exit 1
fi
printf '%s\n' 'PASS: syntax, help, arg validation, no destructive command lines'
