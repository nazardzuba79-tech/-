# Arbitrage scenario workspace

Started from fresh `main` `1affc9a33c82e5ca3aa17d00c9e62ab923335b8f`, then
rebased onto `1b045ab34c09e2b95931dd46c5f3a1c5f54ad1c4` to preserve Claude's
newly merged OTC page (#358). Open support PR #357 was inspected and untouched.
No merge, deployment, production configuration or database change is included.

## Archive adaptation

The supplied `Арбітраж.zip` differs from the component inventory in the brief:
it contains an implemented `app/page.tsx`, mixed light/dark global CSS and two
PNG illustrations, rather than separate hero/table/calculator/model files.
Only the page composition, scenario inputs and globe were adapted. Next.js,
Tailwind 4, its package manifests, global CSS/reset, mock header and analytics
were not installed. The existing VOLTEX Nav, Footer, authentication gate,
wallet/deposit controls and shared language selector remain intact.

The main page is light, with a dark globe hero and gold accents. Styles are
page-scoped, including modal content. The globe is a local WebP (68,612 bytes,
1376×768; original PNG 1,285,151 bytes). No new runtime dependency was added.

## Calculation semantics

These are fixed examples on given prices, not live quotes or executable trades.
Venue names are deliberately conditional: Площадка A/B/C. No action buys,
sells, transfers, launches a bot or creates an order.

- The purchase budget includes its purchase fee.
- Buy execution price = quoted buy price × (1 + buy slippage / 100).
- Quantity = budget / (buy execution price × (1 + buy fee / 100)).
- Sell execution price = quoted sell price × (1 − sell slippage / 100).
- Proceeds = quantity × sell execution price − sell fee − additional costs.
- Net result = proceeds − budget; ROI = net result / budget × 100.
- Both slippage amounts, both fees and additional costs reconcile to the
  difference between the quoted gross result and the net result.

One `computeArbitrage` is used for table, calculator and scenario breakdown.
The table always states its 10,000 USDT budget. A calculator breakdown uses
the actual edited budget and prices. Pair/scenario selection preserves the
budget; full reset restores the initial BTC example and 10,000 USDT.
Inputs remain strings while editing. Empty, invalid, non-finite, non-positive
prices/budget, negative costs, fee/slippage ≥100%, and non-finite calculation
results are rejected. Rounding is for display only. Losses are retained.
Small positive prices retain significant digits; extreme values use scientific
notation instead of presenting a nonzero price as zero.

Triangle and spot/futures cards are explanations of distinct strategies;
the cross-venue formula is not claimed to implement their execution.

## Network boundary

The old ArbitragePage API read and 15-second interval are removed. The backend
route and service remain available to other consumers. The new page imports
no API transport or market subscription and owns no background timer.
`Nav hideTicker` prevents mounting the ticker; merely using `staticTicker`
would have left its data subscription active.

Shared shell behavior is preserved and must be reported separately:
Nav reads `/me` on mount; browser lifecycle revalidates `/me` on return.
Opening support may read the profile; deliberate support submission, deposit
actions and Copy Trading link prefetch retain their established behavior.
The app also preloads static route chunks. Thus the complete application is
not described as making zero requests.

## Local review

Build the ordinary frontend with its API base set to `/api/v1`, then run:

```sh
node scripts/serve-arbitrage-review.cjs
```

Open `http://127.0.0.1:4271/arbitrage`. The host injects a synthetic local
session, serves only a `/me` fixture, refuses non-read methods, has no proxy,
and blocks off-origin network access with CSP. `/__qa/hits` records API reads.
This harness is not part of the production frontend and is never deployed.

Focused regression command:

```sh
node node_modules/jest/bin/jest.js frontend/src/pages/arbitrage/__tests__ frontend/src/lib/__tests__/arbitrageShell.test.ts --runInBand
```

Validation results and desktop/mobile screenshots are recorded in
`docs/qa/arbitrage-design-20260930/README.md` after the local review pass.
