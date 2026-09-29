# Local frontend verification — 2026-09-29

**352 browser checks passed:** 297 Deposit UI, 7 Deposit Worker, 28 updated Futures tiny-price checks, and 20 Admin Listings checks. The four original runner reports and ten selected screenshots are preserved in this folder. [verification.json](verification.json) records their source revisions, sizes, SHA-256 digests, request counts and normalized results.

These runs used local synthetic accounts and addresses. The Deposit and Listings integration runners used actual local Workers; Futures submitted to the actual local native engine. No production account, balance, trade, deposit or listing was changed. This evidence covers the frontend completion work; VTA simulation verification is separate.

## Results

| Runner | Result | What the run verified | Report |
| --- | ---: | --- | --- |
| Deposit UI | **297 PASS** | Actual Header and Wallet Deposit components; desktop, mobile through 320 px and a short viewport; asset search/selection, keyboard focus, networks, clipboard races, independently decoded QR, and the 300 USD rule before the address. BTC/ETH stay USD-only even with fresh, stale-served or expired cached quotes. | [browser-results.json](deposit-ui/browser-results.json) |
| Deposit Worker | **7 PASS** | Built frontend with the real local catalogue Worker; overlapping opens coalesce, disabled assets disappear on the next open, and retry recovers after a Worker restart without falling back to Render. | [report.json](deposit-edge/report.json) |
| Futures tiny price | **28 PASS** | Desktop 1440 and mobile 390: automatic price, last-price button and top header all show `0.0000001`; invalid manual drafts block submission; corrected TP/SL recover; one actual native order per viewport retains the exact price and quantity. | [report.json](futures-tiny-price/report.json) |
| Admin Listings | **20 PASS** | Unsaved-draft guards, discarded late previews, saved-revision preview, cancel/confirm publishing, future-only catalogue discovery without reload, launch transition, deterministic history, Worker restart persistence and history locks. | [report.json](admin-listings/report.json) |

The Admin runner records its completed checks rather than a `result` field. It exited with code 0 after all 20 checks, including the final assertion of no page or console errors. Its raw report is retained unchanged; `verification.json` records that completion explicitly.

## Source and build provenance

The integration base was `d2e98bb083d11ba128b72abab7b1618a4b4c1399`.

| Capture group | Frontend source commit | Exact frontend Git tree | Runtime |
| --- | --- | --- | --- |
| Deposit UI, Deposit Worker and Admin Listings | `51012a0901f066296e69934b520693d9b0d55687` | `7e8b475e999bc7b0ee32725762582153b76b4e3c` | Deposit UI used the Vite component fixture. Worker and Admin used the compiled local frontend. |
| Updated Futures tiny-price run | `b7e0e1a5dc8a7a468a30747f424dbb0c4cd0f3e6` | `18b4cbe0b40d7890a933ed4d7e61479b5899369c` | Rebuilt local frontend after the tiny-header formatter correction. |

The final Admin capture used QA script commit `0c016678fc0e20a43edc1234bee694df328b16eb`, which waits for the mobile sidebar to settle and scrolls the guard or discovered row into view. It did not alter the frontend bundle.

The original three runs were retained after the narrowly scoped formatter follow-up. They were not repeated on the updated bundle. The earlier 26-check tiny-price run did not assert the top header and is superseded by the 28-check report and two regenerated Futures screenshots included here. The eight Deposit/Admin screenshots show the original frontend revision; the two Futures screenshots show the updated revision. The 352 total is the sum of these four recorded runs, not a claim that every check was rerun on one final bundle.

The formatter correction adds significant-digit formatting only for nonzero magnitudes below `0.000001`, where the previous six-decimal cap displayed positive prices as zero. It preserves the existing formatting tiers at and above that threshold, explicit amount precision, zero/signed zero, and unavailable values. The existing `futuresTickerHeader` and `futuresVisualPolish` suites passed **72/72 tests**, including actual header renders for tiny last/mark/high/low values in both layouts and negative/subnormal formatting cases. These unit tests are additional to the 352 browser checks.

Both frontend builds passed a full `tsc -b --force` and Vite build. Runtime versions were Node **24.19.0**, TypeScript **5.9.3**, Vite **5.4.21**, Playwright **1.62.1**, and Chromium **153.0.8010.0**. The local Chromium wrapper used host font configuration at `/etc/fonts`; visible Latin and Cyrillic text was verified before the passing runs. This runtime adjustment was outside the repository.

The compiled local frontend used:

```text
VITE_API_URL=/api/v1
VITE_MANUAL_DEPOSIT_CATALOGUE=true
VITE_MARKET_EDGE_URL=http://127.0.0.1:8787
VITE_DEPOSIT_CATALOGUE_URL=http://127.0.0.1:8791
```

The Deposit component fixture used the same API/manual-catalogue settings with both edge URL variables empty, so its local fetch interceptor could supply the synthetic catalogue.

## Measured request and execution counts

| Scenario | Observed result |
| --- | --- |
| Deposit UI, each of Header and Wallet | Initial open: **1 GET**. Selection/search/copy/QR interactions: **0 additional GETs**. Explicit retry: **1 GET**. Actual **60,100 ms idle: 0 GETs**. |
| Deposit Worker | Cold open: **1 edge GET / 0 Render catalogue GETs**. Overlapping opens: **1 shared edge GET**. Selection/copy/QR: **0 requests**. Actual **60,100 ms idle: 0 edge GETs**. Reopen after admin disable: **1 GET**. |
| Futures tiny price, each viewport | Invalid drafts: **0 commands**. One submitted native LIMIT order: **1 accepted command** with price `0.0000001`, quantity `100000000`, and the same strings in authoritative order state. Header value is exactly `0.0000001`. |
| Admin future-only discovery | The existing Markets tab discovered the second publication in **55,604 ms**, within one regular 60-second cadence, with **0 reloads**. |
| Admin terminal window | Two open terminal tabs made **30 edge requests in 30 seconds**: 12 catalogue, 12 candles and 6 book reads. There were no Render requests about QRB/QDL in that window. The Worker made **0 outbound calls** in the entire run. |

The relevant page-error arrays are empty. Admin also recorded an empty console-error array. The tiny runner recorded zero real-account requests and zero horizontal overflow at both widths.

The isolated Futures runner blocks external chart/provider requests; its desktop screenshot therefore includes an unavailable chart. Other full-page fixture captures can contain empty external-provider panels. The verified scope is the stated local components, managed listings, request behavior and native engine execution.

## Selected screenshots

All ten were visually inspected. Their exact sizes, dimensions and hashes are in `verification.json`.

| Image | Viewport | Capture |
| --- | --- | --- |
| [header-default-usdt-trc20.png](deposit-ui/header-default-usdt-trc20.png) | 1440 × 1000 | Original: default asset/network and 300 USD minimum |
| [header-asset-menu.png](deposit-ui/header-asset-menu.png) | 1440 × 1000 | Original: asset menu |
| [header-btc-usd-only.png](deposit-ui/header-btc-usd-only.png) | 1440 × 1000 | Original: Header BTC minimum in USD |
| [wallet-btc-usd-only.png](deposit-ui/wallet-btc-usd-only.png) | 1440 × 1000 | Original: Wallet BTC minimum in USD |
| [wallet-390x844.png](deposit-ui/wallet-390x844.png) | 390 × 844 | Original: mobile Deposit |
| [tiny-price-1440.png](futures-tiny-price/tiny-price-1440.png) | 1440 × 1000 | Updated: tiny header/ticket price and accepted order |
| [tiny-price-390.png](futures-tiny-price/tiny-price-390.png) | 390 × 844 | Updated: tiny header/ticket price and accepted order |
| [dirty-draft-390.png](admin-listings/dirty-draft-390.png) | 390 × 844 | Original: unsaved message, enabled Save, disabled Preview/Publish |
| [publish-dialog-1440.png](admin-listings/publish-dialog-1440.png) | 1440 × 1000 | Original: publish confirmation |
| [markets-discovery-without-reload-1440.png](admin-listings/markets-discovery-without-reload-1440.png) | 1440 × 1000 | Original: newly discovered future QDL alongside QRB |

## Reproduction

Use installed backend/frontend and Worker dependencies, a built backend, and a working Playwright Chromium runtime. The checked-in runners retain their local synthetic fixtures and do not require production account access.

Build from the `frontend` directory:

```sh
node node_modules/typescript/bin/tsc -b --force
VITE_API_URL=/api/v1 VITE_MANUAL_DEPOSIT_CATALOGUE=true \
VITE_MARKET_EDGE_URL=http://127.0.0.1:8787 \
VITE_DEPOSIT_CATALOGUE_URL=http://127.0.0.1:8791 \
node node_modules/vite/bin/vite.js build
```

From the repository root, run the self-hosted integration runners with `QA_PLAYWRIGHT_MODULE` pointing to the available Playwright module:

```sh
QA_FRONTEND_DIST=frontend/dist QA_OUT=docs/qa/finish-20260929/deposit-edge \
node scripts/qa-deposit-catalogue-edge.cjs

QA_TINY_PRICE_OUTPUT=docs/qa/finish-20260929/futures-tiny-price \
node scripts/qa-futures-tiny-price.cjs

QA_FRONTEND_DIST=frontend/dist QA_OUTPUT=docs/qa/finish-20260929/admin-listings \
node scripts/qa-admin-listings.cjs
```

For `scripts/qa-deposit-ui.cjs`, first serve `frontend/qa/deposit-preview.html` through Vite on `127.0.0.1:4262` with the component-fixture environment described above. Set `QA_JSQR_MODULE` and `QA_PNGJS_MODULE` to the installed decoder modules if they are not normally resolvable, then run:

```sh
QA_OUT=docs/qa/finish-20260929/deposit-ui node scripts/qa-deposit-ui.cjs
```

Keep the runners' real idle and catalogue timing windows. The script revisions and report hashes in `verification.json` identify this recorded run independently of a later rerun.
