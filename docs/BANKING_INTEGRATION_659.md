# Banking integration candidate — Issue 659

This is a **test-only integration**, not a customer release. Main baseline:
`c1f13828c5d398c6792c2a20be551a7132ecf77a`.

Included without implementation changes:

- #656 `2bbaca1be203997ba8937b2e4c7f51225a0ee575`: clamped calendar fixtures,
  pinned test clock, calendar unit tests and disposable PostgreSQL CI.
- #657 `4d2c2408f8ebdd37702ccd04a01d728f1e973078`,
  `d87beb8f1ca5c79c2bc6c3277625b58dda7233ef`,
  `dcd93171663f0403303ed637cabe7878da62a863`: real BankingPage isolated browser
  stand, trusted referral origin expectation and 70-check Chromium CI.

Only the append-only handoff conflict needed resolution; both entries survive.
Production Banking calculations, services, frontend, schema and dependencies
are byte-identical to the baseline. This branch does not integrate #630 or any
Copy Trading/Futures/Wallet UI candidate.

## Validation and promotion gates

Both existing Banking workflows run against the actual PR head. Calendar CI
uses a disposable PostgreSQL service, real clock and seven pinned dates,
including 31 October; browser CI uses local fixture APIs at five viewports.
The complete workflow conclusions must be read for the final SHA. Historical
green #656/#657 is supporting evidence, not a substitute for integration CI.

For a future code-only merge, get owner approval, recheck main and auto-deploy
settings. No frontend/API deployment or database migration is required for
these QA files. Do not publish main as a side effect. A rollback is a reviewed
revert of the integration merge; no balance/data restore is involved.

## Live financial read boundary

`POST /api/v1/wallet/portfolio-snapshot` can persist an analytics row;
`GET /banking/state` can settle accruals. Neither is an unconditional read-only
probe. The earlier Wallet visit returned `recorded:true`; do not label that
visit read-only or remove the resulting row. Future restricted browser QA
must block both routes before navigation. Fixture 200 responses do not prove
live Banking settlement. Unknown/failed amounts must not be changed to zero.

Conversion remains unapproved for activation. #630 remains NO-GO until the
legacy provenance policy and its financial counterexample are resolved.
#629 must not be deployed from its obsolete API base; compare its five
modules against the installed image first.
