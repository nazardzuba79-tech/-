# #693 / #695 — code-only integration of the deployed fix

Production API and Telegram Worker were already installed. This follow-up
does not deploy/restart either, invoke scans, or write production data.

## Why the two frontend assertions failed

Fresh main `6260ae7731652831480824d4c1eb911c0bef2b87` and #695's
`0ab4c0fcdc95bcd2a6225a924acb399efdc1bef5` have identical blobs for
`frontend/src/lib/api.ts` and `futuresTickerHeader.test.ts`.
The two failures share `normalizeApiTs`: one checks the API's protected
fingerprint; the other verifies the KYC exceptions and that same fingerprint.

Commit `a4c63e4fd2d83d971eb14297258a2d727fad23b6` added exactly 13 lines
to api.ts and deleted none: `requestWithdrawalReview`,
`getAdminWithdrawalReviews`, and the optional `reviewAssets` response field.
The preceding API, passed through the unchanged normalizer, hashes to the
original expected `e163d3511b852f72b394b175f030578be1c16ef6eea412cf43b0de36048930ce`.
Current main hashes to `e0181425e4add51f385969f2d0367cf4b30df65f295d8440bac26e51bb5421b8`.
Thus the missing exact exceptions, rather than #693 code, explain both failures.

## Narrow test correction

The original hash stays unchanged. Normalize only the exact additive block
and exact optional-field line from a4c63e4f, each required to occur once.
New negative checks reject review URL, request method/body, payable/held
flags, response-field type and duplicate-block edits. Changing the existing
payable withdrawal URL also still breaks the original hash. Existing KYC,
authorization, Futures/Spot and transport checks remain active.

The focused suite passes all 41 tests, including both former failures.
Final exact-head CI must pass before the authorized #695 merge. No runtime,
frontend implementation, balance, deposit, address, timer or trading-module
change belongs to this follow-up. All deployed #693 API/Worker source files
remain identical to 0ab4c0fc and are retained in the PR being merged.

## Production identity and no-deploy gates

- API `voltex-deposit693:0ab4c0fc`, digest
  `sha256:46b2061167c8cd60c21e9c813f077ab9bb0784f8d6b90f9734028f87a23ad0e3`.
- Worker deployment `f01f8fe1-7c34-4042-8b9d-f13900b4516e`, version
  `24043dd8-51a3-4f76-bc20-3e91df0921eb` at 100%.
- Pages `5f4615ba-1d9e-422d-8f65-c8085c057df0`, source `19ca4e3c`;
  production automatic builds OFF, preview setting none.
- `deploy-kyc-edge.yml` main pushes run verification/dry-run only. Actual
  Worker deploy jobs require workflow_dispatch. Pages reviewed release is
  also workflow_dispatch only. No release workflow is dispatched here.
- Recheck identical API start time, image/module hashes, configuration hash,
  and Worker/Pages canonical deployment identities after the code-only merge.
