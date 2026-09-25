// @ts-nocheck
// Integration baseline: fresh main ac2d583 + approved archive f1836a7 + Pro 0a76da5.
// Mobile follow-up: page fingerprint refreshed for workspace state, viewport inset and draft handoffs.
// Mounted mobile handoff tests in futuresFinalPolish assert no second ticket or submission.
// Financial behavior is independently covered by nativeHistoricalCurrent, nativeLiveProjection,
// calculatorMath, nativeQuoteReadOnly and mounted Futures Pro/order tests.

import {readFileSync} from 'fs';
import {resolve} from 'path';
const ts=require('typescript'),crypto=require('node:crypto');
function restoreBookPresentation(source) {
 // Only display amount strings and their tooltips changed. Restore those exact
 // statements before checking the frozen aggregation/click-selection fingerprint.
 return source.replace(/import \{ formatBookAmount \} from '..\/lib\/terminalPresentation';\r?\n/, '')
  .replace('const quantityText = formatBookAmount(level.quantity);', 'const quantityText = spotStep === undefined ? level.quantity.toFixed(5) : formatSpotBookNumber(level.quantity);')
  .replace('const totalText = formatBookAmount(level.price * level.quantity);', 'const totalText = spotStep === undefined ? (level.price * level.quantity).toFixed(2) : formatSpotBookNumber(level.price * level.quantity);')
  .replace('title={String(level.quantity)}','title={spotStep !== undefined ? quantityText : undefined}')
  .replace('title={String(level.price * level.quantity)}','title={spotStep !== undefined ? totalText : undefined}');
}
function semantic(source){
 const sf=ts.createSourceFile('component.tsx',source.replace(/\r\n/g,'\n'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const transformed=ts.transform(sf,[context=>root=>{
  const visit=node=>{
   if(ts.isJsxAttribute(node)&&['className','style','aria-pressed'].includes(node.name.getText(sf)))return undefined;
   if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>d.name.getText(sf)==='styles'))return undefined;
   if(ts.isImportDeclaration(node)&&node.moduleSpecifier.text.endsWith('.css'))return undefined;
   return ts.visitEachChild(node,visit,context);
  };return ts.visitNode(root,visit);
 }]);
 const result=ts.createPrinter({removeComments:true,newLine:ts.NewLineKind.LineFeed}).printFile(transformed.transformed[0]);
 transformed.dispose();return crypto.createHash('sha256').update(result).digest('hex');
}

const read = name => readFileSync(resolve(__dirname, '../..',name),'utf8');
function restoreFormPresentation(source) {
 // Reverse only the approved details wrapper and repeated price-pick signal.
 // The original complete order payload, calculations and controls remain frozen.
 return source.replace(/\r\n/g,'\n')
  .replace('  pickedPriceSequence,\n','')
  .replace('  pickedPriceSequence?: number;\n','')
  .replace('[pickedPrice, pickedPriceSequence]', '[pickedPrice]')
  .replace('<details className="fo-tiersBox">','<div className="fo-tiersBox">')
  .replace('<summary className="fo-tiersTitle">', '<div className="fo-tiersTitle">')
  .replace('</summary>', '</div>').replace('</details>', '</div>');
}
describe('Futures UI-only reconciliation',()=>{
// Frozen from main 00c6dc3; exclude only CSS imports, style declarations and visual attributes.
// All render conditions, labels, callbacks, effects, API payloads and calculations are included.
test.each([
  [
    "components/FuturesOrderForm.tsx",
    // Re-taken for the removal of the fee row. The owner settled the rate:
    // VOLTEX charges nothing. A row that can only ever read "nothing" is
    // noise, so it is gone — from the spot panel too, along with the
    // frontend-only `FEE_RATE = 0` that multiplied a total into "0.00".
    // Nothing else in this file moved: no field, no guard, no payload.
    //
    // Re-taken a second time, for the quantity field's unit. The ONLY
    // difference from the previous fingerprint: the input is wrapped in a
    // `fo-qtyInputRow` div carrying a `fo-unit` span that prints
    // `baseAsset`, and `symbol.split('/')` now names that base instead of
    // discarding it. The input's own props — value, onChange, required,
    // step, placeholder — are byte-identical, and the unit is a label, not
    // a selector: this form trades the one contract the page is on.
    //
    // Re-taken for the direction control. What differs, exactly, and
    // nothing else:
    //   * the `fo-sideTabs` block is GONE. The side was a mode entered
    //     before the form was touched; it is now the button that submits.
    //   * `submitOrder` takes the side as an ARGUMENT rather than reading
    //     `side` from state. This is not a refactor for taste: a `setSide`
    //     scheduled by the button's click is not visible to a handler
    //     firing in the same event, so state here would send the PREVIOUS
    //     direction. Pinned by three tests in futuresOrderPanel.
    //   * `handleSubmit` delegates to `place(side)`, so Enter still places
    //     the order the trader last acted on.
    //   * the ONE submit button became two, `submit-btn buy` and
    //     `submit-btn sell` — the same classes, the same `!canSubmit`
    //     guard, the same labels. Neither is `type="submit"`.
    //   * the liquidation preview is computed for BOTH directions and
    //     shown as a long/short pair, because there is no selected side to
    //     compute it for. `previewLiquidationPrice` is called with exactly
    //     the arguments it had; only the `side` argument varies, and the
    //     formula is untouched.
    // The order payload, the leverage ceiling, the exposure projection,
    // the margin arithmetic and every guard are unchanged.
    //
    // The ceiling now mirrors resulting position + active-order exposure;
    // backend FuturesPositionService remains authoritative.
    //
    // Re-taken for the shared Futures account store. What differs, exactly:
    //   * the three `setInterval`s that fetched balances, positions and
    //     open orders are replaced by ONE `useFuturesAccount` subscription
    //     at the SAME 5s cadence. Same endpoints, same arguments.
    //   * `availableMargin` is `number | null` instead of `number`. It was
    //     initialised to 0 and left at 0 when the balances request failed —
    //     a fake zero on the most financially sensitive figure in the form.
    //     `null` now means "not known" and renders as a dash.
    //   * `applyPercent` returns early on an unknown balance instead of
    //     sizing from that fake 0. The formula is byte-identical.
    //   * the liquidation PREVIEW is suppressed when the balance is unknown
    //     AND the margin type is CROSS — the only case where `freeBalance`
    //     enters previewLiquidationPrice at all (ISOLATED ignores it). Same
    //     formula, same inputs whenever the balance is known.
    //   * a `refreshFuturesAccount` call after a successful placement, so
    //     the locked margin updates immediately rather than up to 5s later.
    // The ORDER PAYLOAD, leverage tiers, exposure projection and every
    // margin calculation are untouched, which futuresFinalPolish's 24
    // behavioural tests assert directly and still pass unmodified.
    //
    // Re-taken again for the review follow-up on the same PR. One further
    // difference: `positions` and `activeOrders` are no longer coerced from
    // `null` to `[]` before they reach projectFuturesExposureNotional.
    // Unknown is not empty, and in THIS direction the coercion was
    // optimistic — an account whose existing position had not been fetched
    // projected as if it held none, which yields the highest leverage tier.
    // `effectiveMaxLeverage` is now null while those inputs are genuinely
    // needed and unknown, which suspends the leverage slider and the submit
    // guard until the account state is known.
    //
    // The projection is needed only when `!reduceOnly && notional > 0`:
    // reduce-only and zero-notional short-circuit to a REAL 0 before either
    // resource is read, so the initial paint and risk-reducing orders are
    // unaffected. projectFuturesExposureNotional itself, getLeverageTier,
    // the tier table and the order payload are byte-unchanged.
    //
    // Re-taken for the professional order-panel redesign — the one change
    // in this file's history that is deliberately a UX change. What differs:
    //   * MarginTypeToggle and LeverageSlider are replaced by ONE compact
    //     FuturesMarginLeverage popover, so the panel keeps exactly one
    //     persistent slider and that slider is position size. The bounds it
    //     receives are the SAME values: config.minLeverage, the live
    //     effectiveMaxLeverage, config.highLeverageWarningThreshold.
    //   * the position-size slider now takes explicit 10/25/50/75/100
    //     presets; the sizing formula is byte-identical.
    //   * the fee row renders a dash. VOLTEX has no futures fee source —
    //     none in src/futures, none in futuresConfig, no fee column in the
    //     Prisma schema — so the figure it used to print was not a real
    //     zero, it was a number nobody computed.
    //   * Order Value and Required Margin render a dash when the price or
    //     quantity is unknown instead of printing 0.00. Both formulas are
    //     unchanged; only the rendering of an unknown changed.
    // The ORDER PAYLOAD, leverage tiers, exposure projection, liquidation
    // preview and every margin calculation are untouched — futuresFinalPolish's
    // 24 behavioural tests assert them directly and still pass with every
    // asserted value unchanged.
    //
    // Re-taken once more within the same PR, for one UX consistency fix:
    // the guard `handleSubmit` already had is extracted into a single
    // `canSubmit` boolean that the submit button's `disabled` now reads
    // too. The CONDITIONS are unchanged — config present, a known
    // effectiveMaxLeverage, leverage within it, not already submitting —
    // and nothing was added: no balance, order or exposure requirement.
    // The high-leverage confirmation deliberately stays inside
    // handleSubmit (a prompt, not a precondition), and a reduce-only order
    // keeps a non-null ceiling with unknown exposure, so risk-reducing
    // orders remain submittable during an outage.
    //
    // Re-taken for the /futures/config dedup. ONE difference: the form's own
    // `useState` + mount effect calling `api.getFuturesConfig()` is replaced
    // by `useFuturesConfig()`, the one shared read of that static endpoint —
    // a cold /futures fetched it three times inside ~250 ms because this
    // form, FuturesPage and FuturesTickerBar each fetched it independently.
    // `config` is the same object with the same `null`-until-known meaning,
    // so `canSubmit`, the tier table, `effectiveMaxLeverage`, the leverage
    // bounds and the order payload are byte-unchanged — which
    // futuresOrderPanel's 40 behavioural tests assert directly and still
    // pass unmodified.
    // Both existing calculator triggers open the same page-owned dialog.
    //
    // RE-TAKEN for the historical entry (a bar picked on the chart, on the
    // simulation engine). A REAL semantic change, recorded as such: with a
    // bar selected the leverage ceiling is the contract range rather than
    // the risk tier, the contract quantity ceilings are not applied, the %
    // sizing ignores the tier table, the order is costed at the bar's
    // price (`execution.candlePrice`) on every tab, the price field shows
    // that price read-only — and is held to it, since the form's own clearing
    // after a submit would otherwise reseed today's price under a bar that is
    // still the entry — and the entry row prints it. Every one of those
    // branches is gated on `historicalEntry`; without a selected bar every
    // value, guard and payload is what it was — the sibling suites that
    // drive this form with no bar (futuresOrderPanel, unknown-state, final
    // polish, protection) pass unchanged, which is the evidence.
    //
    // RE-TAKEN (owner, 2026-09-22): the «Вход · date · interval · price» row
    // is gone — the chart marks the selected bar and the read-only price
    // field carries its price; the order's candle reference now travels as
    // `data-entry-reference` on the form itself. Only the armed-but-empty
    // picker still prints «Выберите свечу на графике». The margin row
    // prints a dash for a reduce-only order, which posts nothing. And a
    // close ticket drops itself once the account no longer lists its
    // position, and releases the «Только уменьшение» it ticked when its
    // order succeeds — so neither stays armed against nothing and the next
    // bar picked on the chart is an entry again. No payload, guard or
    // calculation changed.
    // Re-taken 2026-09-22 (owner, production report): under «Только
    // уменьшение» the Long/Short pair reads `reducible(side)` — the side with
    // no position to reduce on this symbol and bucket is disabled with the
    // reason as its title, and `place` sets that reason as the error rather
    // than returning silently. Positions not yet known block nothing (the
    // outage rule stands); the margin bucket is left to the engine. Payload
    // unchanged.
    // Re-taken for hidden-tab mark polling and one pending read per symbol.
    // Visible cadence stays 5s; order payloads and sizing math are unchanged.
    // futuresOrderPanel exercises hidden mount/hour, resume, slow/failing reads,
    // symbol changes and cleanup against the actual component.
    "f03c1a3d39296912c56fb819697b068d49ec57ce559ff898506201e348c9c966"
  ],
  [
    "components/FuturesAccountSummary.tsx",
    // Re-taken for the shared Futures account store. What differs, exactly:
    //   * its own 5s `setInterval` over /futures/balances + /futures/positions
    //     is replaced by ONE `useFuturesAccount` subscription at the SAME
    //     5s cadence, shared with the order form above it — so the two can
    //     no longer show different snapshots of the same account.
    //   * every displayed figure is `number | null`. Margin balance,
    //     available margin, unrealised PnL and both margin percentages used
    //     to render 0.00 / 0.00% when their request failed, which is the
    //     fake zero VOLTEX forbids and was reproduced in browser QA against
    //     a 503. They render a dash now.
    // The margin, PnL and maintenance-margin arithmetic is unchanged: same
    // reduce over the same fields, same getLeverageTier lookup, same
    // maintenanceMarginRate. A real 0 (a funded account with no position)
    // is still 0, not a dash.
    //
    // Re-taken for `groupAmount`'s separator: a comma between thousands
    // instead of a space, the one rule the rest of the terminal follows.
    // Digits, decimals, masking and every sum are untouched.
    "31ae908d97cfdc9e3f21a3bff3e81307783956d9dfb175185b7fd822d4228a05"
  ],
  [
    "components/LeverageSlider.tsx",
    "4672879e4ede8605fb09cc86bdd0240617ff4334074228bd39bfb4250bcecae2"
  ],
  [
    "components/MarginTypeToggle.tsx",
    "4623ca56d2987f7d215bbb5be76db9293f2d6aba92de64b063f3f97105fa1a0d"
  ],
  [
    "pages/FuturesPage.tsx",
    // Final pass: dynamic book opt-in, symbol-bound read lifecycle and repeat picks.
    // futuresFinalPolish covers exact selection and stale-response rejection.
    // Explicit Futures wallet source; other terminal wiring remains unchanged.
    // Close All removed from the archive toolbar at the owner's request:
    // one import and one render site dropped, nothing else in this page touched.
    // Re-taken for the shared drawing rail. ONE LINE differs: the PriceChart
    // element gained `drawingTools market="futures"`, opting this page into
    // the SAME rail Spot already used. No other byte changed — the contract
    // list, mark/index/funding/OI reads, order form, positions and every
    // layout class are untouched, and the spot-only MACD warm-up and price
    // axis were explicitly decoupled so enabling the rail does not alter
    // this page's indicators.
    //
    // Re-taken for the /futures/config dedup. ONE difference: the page's own
    // mount effect calling `api.getFuturesConfig()` is replaced by
    // `useFuturesConfig()` plus an effect keyed on the shared value. The
    // listing still comes from the backend and nowhere else, and the
    // fallback for a contract that is no longer listed is the same
    // expression it always was — marketUniverseScale asserts both directly.
    // PR #159 sync: keep mobile workspaces; remove only the archive Close All import/render from #161.
    //
    // RE-TAKEN so a refresh keeps the contract the trader was on. The
    // selection itself is unchanged — same state, same value, same single
    // source — but every caller that used to call `setSymbol` now calls one
    // `selectSymbol`, which additionally writes `?pair=` into the address
    // (replace, never push) and remembers the pair for a bare `/futures`.
    // The initial value reads that address first, then the remembered pair,
    // then BTC/USDT; the catalogue reconcile keeps a listed contract exactly
    // as restored and only replaces one the venue has dropped. Also on this
    // page: the positions panel is handed `onSelectSymbol`, so a position's
    // contract name selects that contract. No order, execution, account,
    // depth, chart-wiring or layout byte changed.
    // Re-taken 2026-09-22: «Лимитный» no longer hands the order form a
    // close ticket — the positions panel opens its own «Закрытие по лимиту»
    // dialog (the reference's). The page now lends the panel the last
    // traded price per contract and names the current symbol; the
    // `closeTicket` state and its effects are gone. Routing, polling and
    // the order payload are untouched.
    //
    // Re-taken once more over the merge of the two changes above: both
    // landed on this page independently and the file now carries both.
    //
    // Re-taken 2026-09-23 for the production chart outage: display-only
    // Futures candles no longer switch to the authenticated native loader.
    // The native execution seam, interaction overlays, account and order
    // paths are untouched; TerminalChart supplies the public exact-contract
    // Futures candle loader for both ordinary and native-bound accounts.
    // Owner-approved sampled-display switch: only setFuturesDepthFallbackBase(API_BASE, true).
    // Order payload, engine, overlays, symbols and account polling remain unchanged.
    // Re-taken for the owner-approved zero-backend public market-data path:
    // FuturesPage changes only the depth transport mode from sampled REST to
    // the existing direct Bybit public WebSocket, with Cloudflare public REST
    // as fallback. Order payloads, execution, accounts and private APIs are unchanged.
    //
    // Re-taken for the contract details under the order ticket on the
    // archive design. TWO lines differ: one import of the read-only
    // `FuturesContractDetails` component and one render site after the
    // order form, gated on `archivePreview`. No hook, handler, request or
    // layout class of this page changed; the ticket, the book, the
    // positions and the account block are byte-identical.
    //
    // Re-taken 2026-09-24 for the archive order book: the page passes two
    // props to FuturesReferenceBook — `archive`, which selects the
    // reference's 28px pitch and the one-repaint-a-second hold inside the
    // component, and `markPrice`, the reference quote's mark the book
    // already had beside it. Display only: the depth transport, the tape,
    // order payloads, execution and accounts are unchanged.
    // Re-taken 2026-09-25 for bandwidth only: the discovery catalogue
    // poll is 5 minutes instead of 1 minute, hidden tabs skip it, and
    // visibility return refreshes immediately. Execution/price/account
    // freshness paths are separate and unchanged; marketUniverseScale pins
    // the new cadence and visibility contract explicitly.
    "8bb07efb31e04933749330acd1b6daf7a7e8b9211333bc677c0efc6c5b9ae869"
  ],
  [
    "components/FuturesPairList.tsx",
    // Re-taken at the Market Data Gateway migration. Two changes, both
    // reference-data plumbing: the 4s reference-ticker poll moved to the
    // shared market-data store, and the 500-coin CoinGecko rankings
    // download that existed only to build an icon map was replaced by the
    // batched asset-registry lookup inside CryptoIcon. Sorting, filtering,
    // favourites, routing and every futures value are unchanged — the
    // other twelve Futures fingerprints in this table are untouched,
    // which is the evidence.
    //
    // Re-taken for the data-driven market universe. This one is a REAL
    // semantic change and is recorded as such, not waved through:
    //
    //   1. Unpriced markets carry `null` instead of `0`. The rendered
    //      output is unchanged — the dash was already guarded — but the
    //      SORT changes, and that is the point: at 500+ contracts the
    //      unpriced tail used to sort as the cheapest markets on the
    //      exchange. Nulls now sort last in BOTH directions.
    //   2. The list renders through a window. Spacer divs preserve the
    //      real scroll height; the row markup, grid, classes, favourites,
    //      search, sort modes and `onChange` routing are untouched.
    //
    // No futures financial value is read here and none was added: this
    // component still shows reference price and 24h change only.
    //
    // RE-TAKEN. The 7-day column and its sort were removed. That column was
    // the one value in this list that came from outside the contract's own
    // price domain — a CoinGecko asset matched by BASE TICKER — and it put
    // GreenHood's +190.54% under the HOOD perpetual. Price, 24h change and
    // turnover all still come from `tickers.get(symbol)`, so the sentence
    // above is now true of every column rather than most of them.
    "0bcf05430051f9ec9d75f9717c3658e1c20e57117a01cb68a85a9467ecc30bfa"
  ],
  [
    "components/OrderBookPanel.tsx",
    "526bad7c7c0ec2277e62cc3daf2e9adc4984d7ef65d3885297a582d5d652e16a"
  ],
  [
    "lib/futuresMath.ts",
    // Re-taken for `fitQuantityToContract`'s `historicalDemo` option: a
    // historical simulation entry has no venue quantity ceiling, mirroring
    // the engine's `validateContractOrder`. The option is opt-in; every
    // existing call without it is floored, capped and refused exactly as
    // before, and no other function in this module changed.
    "698c91b891d7e62f5e8c526983687499b1fa1cc4e77532760747a9b182673519"
  ]
])('%s matches the audited integration fingerprint',(name,hash)=>expect(semantic(name === 'components/OrderBookPanel.tsx' ? restoreBookPresentation(read(name)) : name === 'components/FuturesOrderForm.tsx' ? restoreFormPresentation(read(name)) : read(name))).toBe(hash));
test('every new stylesheet selector is Futures-scoped',()=>{
 const css=read('pages/trade-terminal/FuturesTerminal.css');
 const selectors=[]; require('postcss').parse(css).walkRules(rule=>selectors.push(...rule.selectors));
 expect(selectors.length).toBeGreaterThan(40);
 expect(selectors.every(selector=>selector.startsWith('.futures-terminal ')||selector.startsWith('.trade-terminal.futures-terminal '))).toBe(true);
 expect(css).toContain('clamp(280px, 15vw, 290px)');
 expect(css).toContain('clamp(240px, 13vw, 250px)');
 expect(css).toContain('clamp(300px, 16vw, 310px)');
});
test('form uses styled real inputs and accessible selected-side/type state',()=>{
 const source=read('components/FuturesOrderForm.tsx');
 // FOUR real inputs now, not two: price and quantity, plus the two TP/SL
 // levels the ticket arms with the order on an engine that accepts them
 // there. The point of the count was never the number — it was that every
 // field in this form is a real styled <input> rather than an inline-styled
 // div, so the count moves with the form and `styles.` stays banned.
 expect(source.match(/className="mono fo-input"/g)).toHaveLength(4);
 expect(source).not.toContain('styles.');
 // The ORDER TYPE is still a selected mode, so it still reports pressed
 // state. The SIDE no longer is: there is nothing above the form to press,
 // the direction is chosen by the button that submits. Asserting
 // `aria-pressed` for it would now pin a control that must not exist. What
 // replaces it is stricter — both directions are present as real buttons,
 // each naming its own side, and NEITHER is type="submit", so a stray
 // Enter cannot pick a direction on the trader's behalf.
 expect(source).toContain('<OrderFamilyTabs');
 expect(read('components/OrderFamilyPresentation.tsx')).toContain('aria-selected={value === family}');
 expect(source).not.toContain('fo-sideTab');
 expect(source).toContain("onClick={() => place('BUY')}");
 expect(source).toContain("onClick={() => place('SELL')}");
 expect(source.match(/className="submit-btn (buy|sell)"/g)).toHaveLength(2);
 expect(source.match(/type="submit"/g)).toBeNull();
 // And the direction travels as an argument, never as state read later —
 // a `setSide` scheduled by the click is not visible to the same event.
 expect(source).toMatch(/async function submitOrder\(orderSide: 'BUY' \| 'SELL'\)/);
 expect(source).toContain('side: orderSide,');
 // The submit button now reflects the SAME condition handleSubmit uses,
 // not just the in-flight flag: a CTA that looks pressable while the guard
 // would refuse is misleading in a trading interface. `submitting` is still
 // one of the conditions, so "disabled while sending" stays pinned, and the
 // button and the guard are pinned to ONE expression rather than two copies.
 // Since 2026-09-22 the pair also reads `reducible(side)`: under reduce-only
 // the side with nothing to reduce is disabled, with the reason as its title.
 expect(source).toContain("disabled={!canSubmit || protectionBreachFor('BUY') || !reducible('BUY')}");
 expect(source).toContain("disabled={!canSubmit || protectionBreachFor('SELL') || !reducible('SELL')}");
 expect(source).toContain('if (!canSubmit) return;');
 expect(source).toMatch(/const canSubmit = [\s\S]*?&& !submitting;/);
});
});
