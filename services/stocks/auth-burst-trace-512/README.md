# One compact-authority diagnostic burst (PR #512)

This is a **disabled, review-gated QA diagnostic**. It is not a production import,
a replacement benchmark, a capacity acceptance result, or permission to deploy.
The original six auth windows and their verdicts remain unchanged.

The retained compact runs had 45 ordinary deadlines (18/13/14), all at 50 readers.
For 24 requests, authority admission occurred after the client deadline. Existing
evidence does not divide that interval among Stocks HTTP, auth dispatch, worker
queueing and serialization. This diagnostic collects those missing boundaries.

## Finite budget

Only one compact-authority run and one simultaneous 50-reader wave are allowed.
No optional control, retry, second wave, extended deadline or P variant is allowed.

| Category | Maximum initiating HTTP requests |
| --- | ---: |
| Direct authority prerequisite | 52 |
| Gateway security checks | 17 |
| Sequential warmup | 50 |
| Ordinary measured burst | 50 |
| Startup health | 40 |
| Total | 209 |

Additional hops are counted separately: at most 155 gateway-to-service and 115
service-to-authority requests. The authority total is at most 167, including its
52 direct prerequisites. All HTTP hops combined are at most 479.

The service retains 5,000/100,000 CPU quota, 256 MiB RAM, no swap, CPU set 0,
1 MiB/s reads and 128 KiB/s writes. Auxiliary roles retain their separate original
0.5-vCPU budget and CPU set 1. Ordinary deadline is 3,000 ms. Startup has a
30-second bound; each drain has 10 seconds; run and overall bounds are five and
ten minutes. Preparation has its own finite existing bound. Resource proofs must
come from actual container inspection and kernel cgroup files.
The ten-minute launcher budget includes local image verification and loading;
the remaining trace budget shrinks and reserves thirty seconds for image cleanup.
The preparation image and seed stay in the same job; only the actual compiled
stage artifact is downloaded. No second image upload/download workflow is used.

## Source and transaction safety

Original runtime and fixture files remain unchanged. `instrument.mjs` accepts only
the exact f045 source hashes and derives five disposable overlays. Every hunk is
counted and reversible. `service-overlay.mjs` derives the original fixture entry
with guarded private trace commands and a derived-closure check. Only the service
container receives these read-only file mounts. Authority and driver retain the
original image closure. All untouched image files, compiler outputs and native
dependencies must still match their verified manifests.

The original SQLite observer is unchanged. Worker constructor data retains its
exact five keys. A bounded SharedArrayBuffer is transferred once through a
temporary Node worker environment-data key; it is absent from ordinary command,
reply and stats payloads. FULL synchronous durability and DELETE journal mode
must be observed on the actual temporary worker connection. The closed account
seed and its ledger fingerprints must remain unchanged. No provider, production
database, broker or external financial request is permitted.

## Interpretation

Tracing is armed after warmup and serialized only after settlement. Numeric
buffers have fixed bounds, no overwrite and explicit loss/correlation flags.
Missing evidence is INCOMPLETE; an observed safety violation is FAIL. Ordinary
deadlines remain FAIL even when the trace is complete. Zero reproduced deadlines
does not authorize another run or establish capacity.

Async spans measure wall time only. Native CPU counters are used for synchronous
brackets and thread windows. The worker window is a command execution envelope,
not the main thread's full window. Both envelopes must be contained within the
cgroup observation bracket. Nested synchronous CPU is not double-counted;
residual CPU is unattributed. Instrumented brackets include observer costs. The
partial append writer measurement is wall time and cannot be subtracted as CPU;
clock, allocation and scheduling effects are not fully measured.

Client, gateway and authority terminal events are independent. Post-disconnect
upstream work is retained. Legitimate cancellation before worker enqueue does not
require fabricated worker phases. Complete successful requests require matching
authority admission and terminal records. Raw attempt and cgroup JSONL files are
retained with the bounded trace and analysis.
Successful requests require all emitted body, JSON, clone, worker, SQL and view
phases. Each CPU counter component must be monotonic. Gateway correlation uses
the proxy's existing `x-stocks-view` header only for exact timed, id-less GET state
requests; original proxy and state demand logic remain unchanged.

## Release status

No workload has been authorized by the files merely existing. Final canonical
source/policy/workflow bytes and actual preparation evidence must pass independent
review. Existing backend/browser FAIL evidence, strict capacity FAIL results,
unconfirmed commercial data rights and blocked MOEX/SBER remain release blockers.
