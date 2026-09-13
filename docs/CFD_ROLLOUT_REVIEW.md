# CFD rollout review — 2026-09-13

Owner requested continuing pre-activation work. Fresh main read: 2b4d49309354a791442205b1ed4356c9d0856306. Initial PR head: 3849ecd3f9e6ebadcac585d1e916eac42806c471. No production merge or activation has been performed by this review.

## Test environment

New `scripts/qa-cfd-public-rollout.cjs` runs the actual compiled frontend and actual public CFD Express route on loopback in a disposable GitHub Actions runner. The only real external reads are a bounded public-source sample through PublicReferenceFeed. Browser external traffic is blocked. No production backend, account credential, database or financial write is permitted. A local /me response is explicitly a synthetic authentication fixture. Actual source sample display is tested separately from deliberately simulated stale/off/error/malformed states. Screenshots and a machine-readable report are uploaded as `cfd-rollout-browser`. Do not infer a successful run until the job actually completes.

This is useful browser/integration QA, NOT a deployed Render staging service and NOT a soak crossing live-market sessions. Native external TradingView is intentionally blocked and not re-certified by this test.

## Correction to earlier source-rights notes

Re-opened official Gold API sources in this review:
- https://gold-api.com/terms
- https://gold-api.com/llms.txt
- https://gold-api.com/

The fetched terms do NOT support the earlier claim that section 9 grants commercial web/mobile redistribution, nor the stated effective date 2026-09-10. Section 9 in the fetched document is a humorous clause. That earlier specific claim is withdrawn; it must not be used as rights evidence. The site advertises website use, and its API docs specify USD by default and caching, but this review has not confirmed the precise commercial redistribution/pricing grant for VOLTEX. Obtain/retain applicable rights evidence before activating that source in production. The home page labels gold as per ounce; that alone is not exact unit/methodology evidence for all four metals. No executable-contract equivalence is admitted.

ECB sources rechecked: https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html and https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html . Attribute ECB and explicitly disclose transformed/cross-calculated data. These are informational daily references; transaction use is discouraged.

EIA reuse policy rechecked: https://www.eia.gov/about/copyrights_reuse.php . Its government data can be used/distributed with acknowledgment and date; protected contributed materials/logos are distinct. Only dated numeric benchmark observations are used here.

## Render boundary

The connected Render action returned `no workspace selected` and requires user confirmation before selecting a workspace. The available workspace returned by list_workspaces is `Крипто Биржа` (`tea-da3vnnjm8hqs73ddbqm0`). No workspace has been selected, no service inspected or modified and no Render deploy has been triggered in this review. Confirm the workspace, then inspect actual staging service branch, credentials isolation, instance count and deployment SHA before a staging rollout. Do not guess production or test environment configuration.
