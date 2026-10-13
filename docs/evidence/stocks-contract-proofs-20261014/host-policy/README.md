# Stocks-only host fence

The Stocks route already allowed the global simulator only on exact hostname `127.0.0.1`. The Wallet Stocks hook previously used the feature flag alone and made one global portfolio read on public hosts even though the route was fenced.

- [Before](sanitized-before.log): **6 FAIL / 7 PASS**. All six new forbidden-host tests observed the unwanted request; the seven existing account-isolation/lifecycle tests passed.
- [Wallet tests after](after-wallet.log): **18/18 PASS** across demand and holdings-projection suites.
- [Existing Stocks regressions](after-existing-stocks.log): **37/37 PASS** across navigation, widget lifecycle, read-hook and presentation suites.
- [Exact source hashes](source-manifest.json) and [copied-evidence hashes](evidence-manifest.json).

The new pure Stocks helper returns true only for `127.0.0.1`; both the route and the Stocks-only Wallet projection use it, with safe non-browser handling. Tests cover `stocks-review.invalid`, `voltextech.net`, `localhost`, an IPv4 lookalike, another loopback address and IPv6. Mount, manual refresh, visibility transitions, session changes and elapsed timers produce no Stocks reads or holding rows there. Existing Alice/Bob, late response, cancellation, expiry and valuation behavior remains covered without changing Wallet economics or shared UI.

The pre-fix log's six fake Authorization values were removed only from the review copy. The manifest records both original and copied hashes and the exact redaction. Original raw remains outside Git; no financial/auth secrets were used.

These are local Jest results on the source hashes in the manifest. No build or browser result is inferred from these logs, and no public-host access was enabled.
