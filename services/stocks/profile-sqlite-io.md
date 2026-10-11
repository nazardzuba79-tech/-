# SQLite syscall diagnosis

This optional Linux diagnosis creates its own before/after fixture containers. It
does not attach to an existing service or use production data. Provider transport
is injected by `realistic-global-fixture.mjs`; external API calls remain zero.
The reader sends no financial orders. Accounts and credentials are fixtures.

Run after the uninstrumented scenarios, with the same exact image JSON, disposable
disk, verified block device and CPU placement used by `realistic-run.mjs`:

```sh
STOCK_SQLITE_IO_DIAGNOSTIC=true node services/stocks/profile-sqlite-io.mjs
```

Required environment: `STOCK_REALISTIC_IMAGES`, `STOCK_REALISTIC_DISK`,
`STOCK_BENCH_DEVICE`, `BENCH_CPU`, `LOAD_CPU`. Optional output path:
`STOCK_SQLITE_IO_OUTPUT` (default `.ci-output/stock-performance/sqlite-io`).
Requires host Docker, taskset, strace supporting `-w`, and noninteractive sudo.
The workflow installs strace; the script never installs software or changes host
ptrace policy. The same image fixture entrypoint must be used for both revisions.

Each diagnostic has 20 mixed users over 30 seconds, a three-second HTTP deadline,
0.05 vCPU, 256 MiB RAM, 1 MiB/s reads and 128 KiB/s writes. It includes cold account
creation. This is separate from all uninstrumented acceptance/capacity runs.

After fixture readiness, the script obtains the PID using Docker inspect on the
container it just created. It attaches this aggregate-only command with sudo:

```sh
strace -f -c -w -e trace=fsync,fdatasync,pwrite64,pread64,fcntl -p FIXTURE_PID -o SUMMARY
```

No individual syscall trace, argument, file path, database content or token is
recorded. `-f` includes the account worker and other threads; `-c` aggregates them.
This combination cannot attribute individual rows to a thread or a specific
database. `fcntl` counts all fcntl operations, not only SQLite lock operations.
`fsync`/`fdatasync` directly measure those syscall durations, rather than assuming
all COMMIT wall time is fsync. The write/read syscall rows separately identify
kernel I/O wait. `-w` reports wall duration including wait, not CPU; concurrent
thread waits overlap, so their summed wall duration can exceed elapsed time.

The trace starts before metrics reset and ends after readers plus a bounded
five-second metrics retrieval. Timestamps record this larger trace window; do
not equate it exactly to the 30-second reader interval. Shutdown receives SIGINT
and awaits strace's aggregate flush before stopping/removing the owned fixture.
Missing tooling, ptrace denial, attach failure, unflushed output or no observed
calls is recorded explicitly as unavailable. No fabricated zero-duration result
is substituted. The script never raises privileges inside the fixture container.

Tracing changes scheduling and overhead, particularly under the small CPU quota.
These outputs carry `diagnosticOnly: true` and `capacityClaim: false`; they cannot
be used to claim a latency PASS or production capacity. Use the uninstrumented
paired scenarios for acceptance. The parser and immutable Docker limits have
offline tests; actual ptrace availability is validated only by the Linux run.
