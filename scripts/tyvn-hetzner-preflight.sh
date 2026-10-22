#!/usr/bin/env bash
# TYVN Hetzner release preflight. READ ONLY: no deploy, backup mutation, DB writes.
set -euo pipefail
set +x
EXPECTED=2e7acf158000404133db85723bac13695215e25c
echo 'VOLTEX / TYVN read-only Hetzner preflight'
date -u
for command_name in docker curl python3; do command -v "$command_name" >/dev/null || { echo "BLOCKED: missing $command_name"; exit 2; }; done
ids="$(docker ps -q --filter label=com.docker.compose.service=api-production)"
count="$(printf '%s\n' "$ids" | grep -c '[^[:space:]]' || true)"
test "$count" = 1 || { echo "BLOCKED: expected exactly one running API container, got $count"; exit 2; }
echo 'API container and immutable image:'
docker inspect "$ids" --format '{{.Name}} | {{.Image}} | {{.State.StartedAt}}'
docker image inspect "$(docker inspect "$ids" --format '{{.Image}}')" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
actual="$(curl -fsS --connect-timeout 5 --max-time 12 https://api.voltextech.net/health | python3 -c 'import sys,json;p=json.load(sys.stdin);print(p.get("commit") or p.get("releaseCommit") or p.get("sha") or "")')"
echo "Public API revision: $actual"
test "$actual" = "$EXPECTED" || { echo 'BLOCKED: production API SHA changed'; exit 2; }
local_rev="$(curl -fsS --connect-timeout 5 --max-time 12 http://127.0.0.1:13020/health | python3 -c 'import sys,json;p=json.load(sys.stdin);print(p.get("commit") or p.get("releaseCommit") or p.get("sha") or "")')"
echo "Local API revision: $local_rev"
test "$local_rev" = "$EXPECTED" || { echo 'BLOCKED: local API differs from public'; exit 2; }
echo 'Disk:'
df -h /opt | tail -1
free_kb="$(df -Pk /opt | awk 'END {print $4}')"
test "$free_kb" -ge 5242880 || { echo 'BLOCKED: under 5GiB free'; exit 2; }
echo 'Database readiness (no SQL writes):'
docker exec voltex-cutover-db-1 pg_isready -U voltex_admin -d voltex_stage
echo 'Backup timer:'
systemctl is-active voltex-pg-backup.timer
echo 'Recent backup directory names only:'
find /opt/voltex-precutover/backups -maxdepth 1 -type d -name 'local-*' -printf '%f\n' 2>/dev/null | sort | tail -3
echo 'PASS: read-only baseline gate. No migration, balance, order, listing or timer operations.'
