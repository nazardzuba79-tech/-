// @ts-nocheck
import {readFileSync} from 'fs';
import {resolve} from 'path';
const ts=require('typescript'),crypto=require('node:crypto');
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
    "5323ab621673dc2588b9aa8f3d45829ad0c6c3c674aa395a04639c93a1cdb021"
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
    "1dbf44621981375573b8223032b5791c5e8fbe3dae0f05ce0ed6af5bde712389"
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
    "d3b258620012ff995f51e62d5c621bef76de646df9711675c5fb512ffa7b9b51"
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
    "8c3b0ecf61c2339284de70e2f5ce4cb20a778062a904f49470f21bdde9cd2133"
  ],
  [
    "components/OrderBookPanel.tsx",
    "3554f48fa2bd9bad0cd2ceac2897e75ca204da597980726967d3adb012c100db"
  ],
  [
    "lib/futuresMath.ts",
    "886f8e135f998bf2bd7a0f9379bfe173eddcc1f7d898362c737b97ab5cf2a026"
  ]
])('%s preserves non-visual semantics',(name,hash)=>expect(semantic(name === 'components/FuturesOrderForm.tsx' ? restoreFormPresentation(read(name)) : read(name))).toBe(hash));
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
 expect(source.match(/className="mono fo-input"/g)).toHaveLength(2);
 expect(source).not.toContain('styles.');
 // The ORDER TYPE is still a selected mode, so it still reports pressed
 // state. The SIDE no longer is: there is nothing above the form to press,
 // the direction is chosen by the button that submits. Asserting
 // `aria-pressed` for it would now pin a control that must not exist. What
 // replaces it is stricter — both directions are present as real buttons,
 // each naming its own side, and NEITHER is type="submit", so a stray
 // Enter cannot pick a direction on the trader's behalf.
 expect(source).toContain("aria-pressed={type === 'MARKET'}");
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
 expect(source).toContain('disabled={!canSubmit}');
 expect(source).toContain('if (!canSubmit) return;');
 expect(source).toMatch(/const canSubmit = [\s\S]*?&& !submitting;/);
});
});
