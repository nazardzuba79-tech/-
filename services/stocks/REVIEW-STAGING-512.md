# PR #512 performance evidence stages

This is a scheduling control for the owner-approved continuation in Issue #505,
comment `6147109877`. It does not change acceptance. It applies only to the
same-repository PR #512 and `dot/stocks-owner-usdt-portfolio-20261013`.
Other PRs retain their existing workload selection and thresholds.

`review-plan-512.json` is reviewed with the code. On a synchronize event the
selector compares this plan with the event's immutable `before` commit. A new
plan ID starts only its requested stage. An unchanged plan on a documentation,
test or analysis correction starts no expensive experiments. Reopening or
labeling a PR does not repeat measurements. Missing history, an invalid plan,
or changing a plan while retaining its ID fails closed. A rerun or cancellation
is not the scheduling mechanism.

- `diagnostic`: the exact `06a0d1a748cd943e45df9aa60d25e4ca5ec1b9cb`
  phase diagnostic, under the original resource limits.
- `model`: the separate disposable 2-vCPU / 4-GiB nominal CX23 model.
- `diagnostic-and-model`: both independent experiments above.
- `matched-acceptance`: the unchanged historical acceptance jobs are selected;
  any new candidate comparison must also identify and preserve its exact
  baseline, matching workloads and complete repeats.
- `report-only`: no new expensive measurements.

Scheduling SKIP is not PASS. Green evidence collection does not mean a capacity
gate passed. Incomplete or absent reader evidence cannot be treated as zero
errors. Source SHA, artifact hashes, all failures and every repeat must accompany
the resulting report. CI checks the exact PR head for the new A/B harness jobs;
the phase diagnostic independently pins its measured source to immutable06a.

## Current baseline, independently recomputed

The final06a artifacts from run `38383013782` were downloaded and SHA-256 checked:

| Artifact | SHA-256 |
| --- | --- |
| bounded `11807092936` | `e43fd8a26b724755719038af1c4c8ee622bd0834779b8c149a53445453c6ab4b` |
| Issue505 `11807041693` | `23bc3d060ded345cf7bc324aa1447df23b4894c9b78947cd254350b03edc0dd7` |
| original `11806377385` | `a3a0d4e5834f5ce169129d9a23e5d3f42523659c255b0d429bc597466797ec4f` |

Bounded50-mixed AFTER has29/25/31 failed HTTP attempts: all85 are
`DEADLINE_3000MS` state requests, with no chart/history errors or HTTP422.
BEFORE has226/237/263 failures:634 `ACCOUNT_BUSY` and92 deadlines.
Internal queue-timeout counters32/19/6 are not additional failed HTTP attempts.
There are two explicit COMMIT calls per repeat, plus the first standalone
registration INSERT's autocommit: three registration transactions inferred from
code and registration counters. Explicit COMMIT wall time is784/787/1118ms;
neither the total fsync count nor fsync syscall latency was measured.

Issue505 D50 pooled crypto **service-call** p95 is17.913625ms, +13.648569%;
per-repeat changes against each corresponding control are
+6.221257%/+5.484667%/+24.890365%. D100 pooled p95 is17.939298ms,
+13.811445%, with140/119/127 reader TimeoutErrors. All fail the applicable
original gates. These are not measurements of production HTTP or Hetzner.

The baseline's40 complete case groups recompute without numeric changes after
the summary parser is tightened to reject missing/truncated/undrained evidence.
Historical86b4/f81 comparisons remain separate from any new06a candidate pair.

## Safety boundary

No runtime optimization is inferred from green CI alone. Instrumentation needs
measured overhead against native source before causal extrapolation. The B model
does not replace A, certify production headroom, validate provider licensing, or
make MOEX tradable. Its20 actual US fixture instruments and250 inert metadata
entries are different cardinalities and must be reported as such.

All measurements use disposable test data and isolated accounts. No production
database, financial request, deployment or infrastructure change is authorized.
Provider-data commercial rights and MOEX sources remain NOT CLEARED.
