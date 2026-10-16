# Follow-up: bounded NSS prerequisite

## Observed failure, retained unchanged

At source `6d44e287428b6140475a97d701b57710acc73504`, Chart run
38847147212 passed all 224 browser assertions, 190 pure assertions and 22 helper
tests. Its merge checkout `b6658f5ce1e35e6e8c3c03faca32d33e08bcb38a` has the
same tree `0f816f1b521679c68b2458b2f29fd9dcc8ce6b67` as the source head.

Stocks run 38847147298 / browser job 116802710746 passed the six preceding
browser scenarios, including the owner Buy/Sell/account-isolation journey.
The seventh public-host prerequisite failed before OFF/ON/candidate cases:
`spawnSync /usr/bin/dpkg-query -S /usr/bin/certutil ETIMEDOUT` at the existing
10,000 ms bound. The gate correctly failed; owned browser cleanup succeeded.
See the unchanged `nss-preflight-failure-6d44e287.json` including its full stack.
The raw artifact ZIP digest is
`88056c7d584cd2c2efe367014db92bf2cb11b64c0cb38b9416ef8f6fbf4279c8`.

This establishes the failed operation and deadline, not the runner's exact
disk/scheduler stall cause. No blind retry or retrospective PASS is claimed.

## Narrow repair

The NSS probe now queries the known `libnss3-tools` package file inventory,
the two exact installed NSS package versions/statuses, and its installed
`md5sums` control file. It does not scan every installed package's file list.
The supported interfaces and diversion annotations are documented by
[Debian dpkg-query](https://manpages.debian.org/bookworm/dpkg/dpkg-query.1.en.html).

Acceptance requires exact canonical executable membership, no diversion or
malformed rows, healthy installed package identities, and matching actual
executable bytes. Both tools and their ancestors must be root-owned and not
group/world writable. A bounded descriptor read rejects before/during/after
file identity, size, mode or timestamp changes and always closes the descriptor.

The evidence explicitly labels this **targeted installed-package integrity**,
not a global exclusive-owner search. MD5 checks installed-file consistency;
it is not an independent publisher signature. SHA-256 of actual executable
and query-tool bytes and each command's elapsed time are retained separately.
No synthetic `packageOwner` observation is emitted.

The 10-second / 128-KiB per-command bounds, sanitized environment, failure
before NSS-profile creation, private CA inventory, TLS controls, Chrome
sandbox, shared browser-job budget and cleanup are unchanged. There is no
fallback, retry or security bypass. The protected native source hashes are
not repinned to inherit old backend acceptance; changed inputs require FULL.

## Local verification and limits

- Final NSS/Chrome guards: **21 PASS**, zero skips/failures, including nine
  new metadata/command/file-mutation regressions.
- TLS ingress and public fixture checks: **16 PASS**, zero skips/failures,
  with explicit bundled fixture Python. An earlier invocation omitted that
  prerequisite and its 12 setup failures are retained in the original log.
- Actual Linux package inspection and all public-host browser cases require
  the next exact-source CI execution. Local VM tests are not that execution.

No product runtime, trading, financial rules, provider data or performance
acceptance thresholds changed. Original 50-mixed and crypto-coexistence FAILs,
capacity uncertainty, PostgreSQL NOT_RUN and market-data rights blockers
remain as documented in README.md.
