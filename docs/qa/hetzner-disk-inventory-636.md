# VOLTEX #636 — Hetzner read-only disk inventory

Purpose: collect **actual host filesystem evidence** before deciding whether any cleanup is worthwhile. This is a supporting operator tool, **not an automatic cleanup or release**.

## Run boundary

Use the **existing authorized Hetzner OS console**, on `voltex-prod-fsn-01`; do not execute on the Beget RU gateway. Verify hostname and project in the console before running.

```bash
bash scripts/ops/test-hetzner-disk-inventory.sh
bash scripts/ops/hetzner-disk-inventory.sh
```

The script prints to stdout only: filesystem and inode capacity, major directory sizes, Docker space/image/container/volume metadata, journald usage, backup timer/service status, and encrypted backup **mtime/size metadata**. Per-command 45-second timeout prevents a stalled `du` from blocking the remainder. It neither decrypts nor restores backups and never prints Docker env, database rows, keys or archive contents.

If the audit reports `NOT_AVAILABLE`/a warning, it is **not PASS**. A backup manifest and successful timer do **not** prove restoration; independently verify a controlled isolated restore before any deletion. The script intentionally includes no cleanup command.

Never paste a raw production transcript publicly without checking that mountpoint, Docker image and directory identifiers are safe to disclose. Use the existing private operator channel for unredacted evidence.

## Acceptance

Document measured used/free (before), relevant Docker images/cache and PostgreSQL/WAL storage, verified immutable rollback image, backup freshness and test-restoration status; identify any proven disposable cache **by exact path and size**. If proof is incomplete, perform zero deletions and record `0 GB cleaned`. Do not touch Docker volumes, PG/WAL, financial logs, rollback image, credentials, balances, ECLV or QVTR timers. Do not buy or move servers.

The host inventory is distinct from the separate real Russian-ISP/no-VPN gateway functional test; passing one never proves the other.
