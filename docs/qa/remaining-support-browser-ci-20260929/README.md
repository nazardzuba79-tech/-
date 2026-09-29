# PR #345: Admin PostgreSQL evidence and Support browser guard correction

The published head is `b343c355369677df65bdd77495ed8826c00e2479`, tree `89edcb0caa4bebef2790bb7524f3532a4c767ff5`, matching isolated source `e92951c`. No part of concurrent PR #344 was imported.

## Actual GitHub Actions results

- **Admin Listings SUCCESS:** [run 36604258559](https://github.com/nazardzuba79-tech/-/actions/runs/36604258559), verify job `109529122351`. Logs show disposable PostgreSQL **16.15**, successful migrations, the exact loopback `voltex_listing_test` URL, PASS for both ownerAllocation suites, **8 suites /142 tests passed**, and no skipped tests in that aggregate. The unchanged exact-head files register **14 PG cases (7 direct +7 parameterized)** and **14 unit cases (4 direct +10 parameterized)**. The reporter prints suite success and aggregate totals, not a per-file case count. All workerd/build stages and the browser flow passed; browser **20/20 checks**, zero Worker outbound venue calls. See `admin-pg-excerpt.txt` and source blob IDs in verification.json.
- **Support FAILED:** [run 36604258109](https://github.com/nazardzuba79-tech/-/actions/runs/36604258109), verify job `109529120830`. Worker tests, dry-run, source tests, corrected workflow secret scan and both builds passed. The browser script failed at its duplicate legacy mailbox assertion before launching a browser. Its deploy job was skipped. See `support-failure-excerpt.txt`.

## Narrow harness correction and local verification

Only `scripts/qa-support-form.cjs` changes: the intentional protected-owner identity is removed from the bundle marker list, the comment points to the unchanged exact source guard, and the report label now states the actual assertion. All five SMTP/mail/token markers remain forbidden. The recipient constant and actual fixed-recipient, Reply-To, one-POST/one-recorded-email, provider-refusal, prefill, idle and geometry assertions are unchanged. Reversing these exact edits reproduces the original harness bytes. The actual extracted bundle-assertion block rejects each of the five forbidden-marker probes.

Fresh frontend TypeScript and QA Vite build **PASS**. Full real-browser harness **PASS**, with 6 groups and all five widths (320/360/390/430/1440), including mobile keyboard-sized viewports. It verifies one POST on double-click, recorded mail recipient and body, refusal/draft preservation, 25 idle seconds with no support requests, signed-in prefill and no page errors. Totals: 3 local Worker POSTs (including the deliberate refusal), 2 recorded mail objects, 0 support API requests. No real email was sent. The unedited report is `support-browser-report.json`.

The first local browser attempt used the shared Chromium launcher with `--disable-web-security`; the real Worker correctly refused the resulting request with HTTP 403. A task-local launcher keeps web security enabled and selects the already installed Chromium 153. This environment-only adapter is uncommitted and does not alter the harness, application, Worker or CI browser settings. Full checks then passed without any runtime change.

No remote rerun, push, merge, deployment or production data operation was performed. Root must publish the focused harness fix and verify the new exact-head Support run.
