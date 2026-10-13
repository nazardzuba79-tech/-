# Stocks principal contract evidence

This directory contains fixture-only functional proofs. The compact principal handler is a **counterfactual inside a disposable loopback test process**, not a new production endpoint or an approved API change. The existing real `/api/v1/me` route and Stocks identity resolver remain unchanged. These results do not establish capacity, production readiness, or data rights.

## Current principal proof

- [Current finite report](principal/report.json): **26 paired scenarios PASS** on the final verifier source, run once after the optional compiled-artifact root was added. No new auth build or load scenario was run.
- [Guard test log](principal/guard-tests.log): **4/4 tests PASS**, including those 26 auth scenarios, stale-source/compiled-tamper rejection, a source-only checkout without `dist`, and safe environment/output guards.
- [Source binding](principal/source-manifest.json): script SHA256 `2d137a89c4f1ff02e1d18b2366faa4cd0cad0f34c93fbb8407d29cb8f9819379`; test SHA256 `f5fe9803f1e2355ab17124624956425c50fd9463bdf9a9a4ab77b009e15a21fd`.
- [Fresh-build proof](principal/build-provenance.json): reused only after all 279 current source inputs, compiler/config/package-lock/log hashes and six compiled authority modules matched. The source-build proof digest is `dc7df0493d844f77353bfea6b5b69d2a5238e474bb8e403481373853173c1d6f`.
- [Copied-file hashes](principal/evidence-manifest.json) bind every copied raw file and its original local evidence path. Raw copies are unchanged.

The control uses the actual compiled `accountRouter`; the compact fixture uses actual compiled `requireAuth`, `asyncRoute`, contact policy and session checks. Its final fixture handler still performs the second user-existence read, selecting only `id`. It returns 404 for an orphaned session or deletion between authentication and response. Denials and immediate changes are checked on every request; no identity cache was introduced.

Coverage includes valid Alice and Bob, forged Alice/ADMIN headers on a legitimate Bob session, pending 2FA, subject/session mismatch, expired or invalid JWT, revoked/missing sessions, blocked contacts, deleted users, unavailable auth dependencies, remembered-session expiry/demotion, stale-session touch and legacy-token revocation after unblocking. Returned principals remain exactly issuer/subject. This is identity-contract evidence; it is not a new end-to-end trading-permission implementation.

The accepted maximum-avatar fixture yields the same principal from a **1,048,800-byte** original profile response and a **14-byte** compact response. Proxy observations count 13 profile avatar accesses and zero compact avatar accesses. Across the finite run: 104 local authority requests, 84 session reads, 62 policy reads, two existing last-seen touches, zero unexpected Prisma operations and zero external/denied network attempts. These are functional counters, not throughput or latency measurements.

Local runtime: **Node 24.21.0 / Windows**. Linux CI is separate and is not claimed by these local files. The verifier interface `verifyBuild(proofFile, base, compiledBase)` retains current-source checks against `base`; only the strictly contained emitted closure may come from `compiledBase`. Artifact bytes must still match the same fresh-build proof. The public-host harness separately verifies its package manifest binding.

## Host-policy proof

See [host-policy evidence](host-policy/README.md). Six public/non-allowlisted-host cases failed before the correction; all seven existing Wallet lifecycle cases already passed. After sharing the exact `127.0.0.1` policy between the Stocks route and Stocks-only Wallet hook, **55/55 tests across six suites passed**. The allowed host was not expanded.

## Evidence limits and retention

No databases, keys, JWTs or environment dumps are included. The host pre-fix failure log printed a disposable fixture Authorization value; its review copy redacts exactly six occurrences, with original and sanitized hashes and the transformation recorded. Its assertions and failure counts are unchanged. The original log and predecessor principal reports remain outside Git under the task workspace's `output/stocks-next-release-20261013/`, at the source paths recorded by the manifests. They were not overwritten or relabeled as current-source proofs.

Any real compact authority endpoint, API ownership/contract approval, deployment integration and subsequent capacity validation remain separate work. Nothing here removes the existing production fence or satisfies the outstanding strict resource/provider-budget gates.
