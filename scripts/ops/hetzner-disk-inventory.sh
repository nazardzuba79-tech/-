#!/usr/bin/env bash
# VOLTEX Issue #636 — strictly read-only Hetzner host inventory.
# No credentials, contents of financial records, or Docker environment are printed.
# Run in the existing authorized host console; never execute on Beget.
set -u
set -o pipefail
export LC_ALL=C

if [[ "${1:-}" == "--help" ]]; then
  cat <<'USAGE'
Usage: bash scripts/ops/hetzner-disk-inventory.sh
Read-only; stdout only. Requires an authorized Linux shell (root for full visibility).
Never removes/restarts/prunes anything. Never prints environment or backup contents.
USAGE
  exit 0
fi
if [[ $# -ne 0 ]]; then
  echo 'Unknown argument. Use --help.' >&2
  exit 2
fi

# Refuse to run against a known Beget gateway. This is an operator safety check,
# not an identity attestation: verify the Hetzner host in the console first.
actual_host="$(hostname -s 2>/dev/null || echo unknown)"
if [[ "$actual_host" == *ru-gateway* || "$actual_host" == *beget* ]]; then
  echo 'REFUSED: this appears to be the Beget RU gateway, not Hetzner.' >&2
  exit 3
fi

run() {
  local label="$1"; shift
  printf '\n=== %s ===\n' "$label"
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "NOT_AVAILABLE: $1"
    return 0
  fi
  if command -v timeout >/dev/null 2>&1; then
    timeout 45s "$@" 2>&1 || printf 'WARNING: command failed or timed out: %s\n' "$label"
  else
    "$@" 2>&1 || printf 'WARNING: command failed: %s\n' "$label"
  fi
}

printf '%s\n' 'VOLTEX_HETZNER_DISK_INVENTORY_V1'
printf 'timestamp_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'hostname=%s\n' "$actual_host"
printf 'uid=%s\n' "$(id -u)"
printf '%s\n' 'READ_ONLY=true; PRODUCTION_MUTATIONS=none; RECOVERED_BYTES=0'

run 'filesystem capacities' df -hT
run 'inode capacities' df -ih
run 'block devices' lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS
run 'mount details' findmnt -rn -o TARGET,SOURCE,FSTYPE,OPTIONS / /var/lib/docker /opt

# Only directory sizes, never file content or a secret-bearing path listing.
for dir in /var /opt /srv /home /root /tmp; do
  if [[ -d "$dir" ]]; then
    run "size-by-directory $dir" du -xhd1 "$dir"
  fi
done

if command -v docker >/dev/null 2>&1; then
  run 'docker space (images, containers, volumes, build cache)' docker system df
  run 'docker containers (name, image reference, status only)' docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
  run 'docker images (name, tag, ID, size only)' docker images --format 'table {{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.Size}}'
  run 'docker volumes (names only, do not remove)' docker volume ls --format 'table {{.Name}}\t{{.Driver}}'
fi
run 'journal space' journalctl --disk-usage

for unit in voltex-pg-backup.timer voltex-pg-backup.service; do
  if command -v systemctl >/dev/null 2>&1; then
    run "backup unit $unit (no journal contents)" systemctl show "$unit" --no-pager --property=LoadState,ActiveState,SubState,Result,ExecMainStatus,ActiveEnterTimestamp,InactiveEnterTimestamp,LastTriggerUSec,NextElapseUSecRealtime
  fi
done

backup_root=/opt/voltex-precutover/backups
if [[ -d "$backup_root" ]]; then
  run 'encrypted backup tree size' du -sh "$backup_root"
  # Backup metadata only; no filenames, archive extraction, decryption or writes.
  run 'encrypted backup file metadata (mtime and bytes only)' find "$backup_root" -maxdepth 3 -type f -name '*.enc' -printf '%TY-%Tm-%TdT%TH:%TM:%TSZ %s bytes\n'
else
  echo 'BACKUP_TREE_NOT_FOUND: /opt/voltex-precutover/backups'
fi

printf '\n%s\n' 'NEXT: inspect backup restore proof and immutable rollback receipts separately.'
printf '%s\n' 'NO_CLEANUP_AUTHORIZED: do not run docker prune, rm, restart, or change production.'
