import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The three areas of the reference: the two entry fields, the positions
 * row, and the account summary under the order buttons.
 *
 * The pixel equality of the price and quantity fields is asserted in the
 * BROWSER, where a box can actually be measured (scripts/qa — Δ width,
 * height, left and right all 0.00px at 1440 and at 390). What is asserted
 * here is the thing that makes that equality structural rather than lucky:
 * one shared class carries every box property, and the differing contents
 * sit in a trailing slot INSIDE it.
 */

const frontend = resolve(__dirname, '../../..');
const source = (path: string) => readFileSync(resolve(frontend, 'src', path), 'utf8');
const FORM = source('components/FuturesOrderForm.tsx');
const PANEL = source('components/FuturesPositionsPanel.tsx');
const SUMMARY = source('components/FuturesAccountSummary.tsx');
const CSS = source('pages/trade-terminal/ReferenceFuturesTerminal.css');
const ROW_PARITY_CSS = source('components/FuturesPositionParity.css');

describe('1. price and quantity are one field shape, used twice', () => {
  test('both are the same class, with the caption and the extra INSIDE', () => {
    // Two `fo-field` labels: price (or mark price) and quantity.
    expect(FORM.match(/className="fo-label fo-field/g)!.length).toBe(3); // LIMIT price, MARKET price, quantity
    // Each carries its caption as the same element, inside the field.
    expect(FORM.match(/className="fo-fieldCaption"/g)!.length).toBe(3);
    // Each row is the same element, and the differing trailing content is
    // in the same slot inside it.
    expect(FORM.match(/className="fo-fieldRow/g)!.length).toBe(3);
    expect(FORM.match(/className="fo-fieldTrailing"/g)!.length).toBe(3);
    // "Последняя" and the unit live in that slot, not beside the field.
    const priceTrailing = FORM.match(/className="fo-fieldTrailing">([\s\S]*?)<\/span>/)?.[1];
    expect(priceTrailing).toContain('fo-lastPriceBtn');
    expect(FORM).toMatch(/fo-fieldTrailing[\s\S]{0,120}fo-unit/);
  });

  test('the quantity label no longer carries the account balance', () => {
    // That is what could stretch one field relative to the other; it is the
    // account summary's line now.
    expect(FORM).not.toContain('fo-qtyLabelRow');
    expect(FORM).not.toMatch(/availableMargin[^\n]*toFixed\(2\)[^\n]*quoteAsset/);
  });

  test('every box property is set ONCE, on the shared class', () => {
    const row = CSS.match(/\.fo-field \.fo-fieldRow \{[^}]+\}/)![0];
    for (const property of ['height', 'min-height', 'background', 'border', 'border-radius', 'box-sizing', 'width']) {
      expect(row).toContain(`${property}:`);
    }
    // The trailing slot takes its space from the input, never from the box.
    const trailing = CSS.match(/\.fo-fieldTrailing \{[^}]+\}/)![0];
    expect(trailing).toContain('flex: 0 0 auto');
    const input = CSS.match(/\.fo-field \.fo-input \{[^}]+\}/)![0];
    expect(input).toContain('flex: 1 1 0');
    expect(input).toContain('min-width: 0');
    // And the input carries no box of its own that could disagree.
    expect(input).toContain('border: 0');
  });

  test('one size slider with presets, and equally sized Long/Short', () => {
    // One slider element in the panel (the other match is the import).
    expect(FORM.match(/<PercentSlider/g)!.length).toBe(1);
    expect(FORM).toContain('presets={SIZE_PRESETS}');
    expect(FORM).toContain('const SIZE_PRESETS = [0, 25, 50, 75, 100];');
    // The LAST rule is the one that applies; it makes both buttons share
    // the row equally and gives them one explicit height.
    const blocks = CSS.match(/\.fo-submitPair \.submit-btn \{[^}]+\}/g)!;
    const pair = blocks[blocks.length - 1];
    expect(pair).toContain('flex: 1 1 0');
    expect(pair).toContain('height: 40px');
    expect(pair).toContain('min-height: 40px');
  });

  test('a message is a sibling of the fields, never inside one', () => {
    // A hint that grew inside a field would stretch it; these sit after the
    // info box, outside both labels.
    expect(FORM).toMatch(/<\/div>\s*\n\s*\{error && <div className="fo-error"/);
    expect(FORM).not.toMatch(/fo-field[\s\S]{0,400}fo-error/);
  });
});

describe('2. the positions row carries the reference columns', () => {
  test('contract with Cross and leverage under it', () => {
    // The owner's reference composes this cell as the ticker with a
    // perpetual badge beside it and the margin line underneath, so the cell
    // is longer than it was — the facts it must carry are unchanged.
    expect(PANEL).toContain('futures-position-contract');
    expect(PANEL).toContain('futures-position-perp');
    const contractCell = PANEL.match(/className="futures-position-contract">([\s\S]*?)<\/Td>/)?.[1];
    // The second line is the reference's «Марж. торговля 10.00x» (Isolated
    // names itself); the side is the quantity's colour and the bar on the
    // cell, spoken for assistive technology only (owner's Bybit screenshot,
    // 2026-09-22).
    expect(contractCell).toContain("t('futures.marginTrading')");
    expect(contractCell).toContain("t('futures.isolated')");
    expect(contractCell).toContain('className="futures-sr-only"');
    expect(contractCell).toContain('Number(p.leverage).toFixed(2)');
  });

  test('quantity with its unit, and the position value in the quote asset', () => {
    expect(PANEL).toContain('futures-position-unit');
    // The reference's own column wording; the figure behind it is the same.
    expect(PANEL).toContain("futures.colValue");
    // Value is size at the MARK, and unknown when the mark is unknown — it
    // is never silently valued at the entry price instead.
    expect(PANEL).toContain('const value = markNumber === null ? null : parseFloat(p.size) * markNumber;');
    expect(PANEL).toContain("{value === null ? '—' :");
  });

  /**
   * This asserted `futures.entryPrice` / `markPrice` / `liqPrice`, and it was
   * green for the wrong reason. Since the reference columns landed, the real
   * table heads are `futures.colEntry` / `colMark` / `colLiq`; the three old
   * keys survived ONLY in the strip of column headings the empty state used
   * to paint over no rows at all. Removing that dead strip is what made this
   * fail — the live columns never moved.
   *
   * So it now reads the `<thead>` itself rather than the whole file, which is
   * the stronger claim: a stray array of labels somewhere else in the module
   * can no longer satisfy a test about what sits above the rows.
   */
  test('entry, mark and liquidation prices each have their own column', () => {
    const thead = /<thead>([\s\S]*?)<\/thead>/.exec(PANEL);
    expect(thead).not.toBeNull();
    for (const key of ['futures.colEntry', 'futures.colMark', 'futures.colLiq']) {
      expect(thead![1]).toContain(key);
    }
    // Three separate cells, not one combined price column.
    expect(thead![1].match(/<Th>/g)?.length).toBeGreaterThanOrEqual(10);
  });

  test('native Cross never presents an engine-only liquidation price as account-authoritative', () => {
    expect(PANEL).toContain("execution.engine === 'NATIVE'");
    expect(PANEL).toContain("p.marginType === 'CROSS'");
    expect(PANEL).toContain('aggregate.collateralComplete');
    expect(PANEL).toContain('aggregate.walletCollateral');
    expect(PANEL).toContain('const liquidationPrice = nativeCrossLiquidationUnknown ? null : p.liquidationPrice;');
  });

  test('unrealized carries ROI under it, and realized is its OWN column', () => {
    expect(PANEL).toContain('futures-position-pnl');
    // ROI is grouped like every other figure in the row now (`12,009.96%`),
    // the same `group()` the money columns use, so the guard follows it.
    expect(PANEL).toMatch(/futures-position-pnl[\s\S]{0,700}group\(roe, 2\)/);
    expect(PANEL).toContain('const realized = parseFloat(p.realizedPnl);');
    // The two are NEVER summed: adding them would double-count the fees and
    // funding already inside the realized figure, on a size that is no
    // longer part of the open one.
    expect(PANEL).not.toMatch(/realized\s*\+\s*pnl|pnl\s*\+\s*realized/);
  });

  test('P&L presentation names the quote asset and formats positive values like the reference without changing the numeric node', () => {
    expect(PANEL).toContain('className="futures-position-money"');
    expect(PANEL).toContain('className="futures-position-roi"');
    expect(PANEL).toContain('className="futures-position-realized"');
    expect(PANEL.match(/data-unit=/g)!.length).toBe(2);
    expect(ROW_PARITY_CSS).toContain("content: ' ' attr(data-unit);");
    // No plus sign: the reference prints `2,120.5422 USDT` and `(106.84%)`
    // for a profit; the colour carries the sign (owner's screenshot, 2026-09-22).
    expect(ROW_PARITY_CSS).not.toContain("content: '(+';");
    expect(ROW_PARITY_CSS).not.toContain("content: '+';");
    expect(ROW_PARITY_CSS).toContain("content: '(';");
    expect(ROW_PARITY_CSS).toContain("content: ')';");
  });

  test('TP/SL, both close methods and the P&L card button', () => {
    expect(PANEL).toContain('FuturesPositionProtectionCell');
    // «Лимитный» / «Рыночный», as the reference labels the two close paths.
    expect(PANEL).toContain("t('futures.closeLimit')");
    expect(PANEL).toContain("t('futures.closeMarket')");
    expect(PANEL).toContain('futures-position-card');
    // «Лимитный» opens the panel's own «Закрытие по лимиту» dialog for that
    // row (the reference's), never the order form; the card button is still
    // only rendered where a card service exists.
    expect(PANEL).toContain('data-limit-close-open={p.id}');
    expect(PANEL).toContain('<FuturesLimitCloseDialog');
    expect(PANEL).not.toContain('onLimitClose');
    expect(PANEL).toContain('{!archive && execution.showPnlCard && (');
    expect(PANEL).toContain('execution.showPnlCard ? execution.showPnlCard(p.id) : setCardPosition(p)');
  });

  test('the horizontal scroll is the TABLE\'s, and no number is truncated', () => {
    const scroll = CSS.match(/\.futures-positions-scroll \{[^}]+\}/)![0];
    expect(scroll).toContain('overflow: auto');
    const table = CSS.match(/\.futures-positions-table \{[^}]+\}/)![0];
    // `max-content` is what lets a large P&L widen the table and the
    // container scroll, instead of the cell clipping it.
    expect(table).toContain('min-width: max-content');
    expect(CSS).not.toMatch(/\.futures-position(-row)? [^{]*\{[^}]*text-overflow: ellipsis/);
  });

  test('the tab counters use the same replacement account as the visible rows', () => {
    const page = source('pages/FuturesPage.tsx');
    expect(page).toContain('const visibleAccount = nativeExecution?.account ?? account;');
    expect(page).toContain("visibleAccount.positions.data?.length ?? '—'");
    expect(page).toContain("visibleAccount.orders.data?.length ?? '—'");
  });

  test('an open position keeps the panel from auto-collapsing', () => {
    const page = source('pages/FuturesPage.tsx');
    // The panel only collapses when orders AND positions are VERIFIED empty,
    // and it makes that decision on the same account the rows use.
    expect(page).toContain('isVerifiedEmptyAccountResource(visibleAccount.orders)');
    expect(page).toContain('isVerifiedEmptyAccountResource(visibleAccount.positions)');
  });
});

describe('3. the account summary under the order buttons', () => {
  test('both margins, margin balance and available balance — and no second margin-mode row', () => {
    // Owner-approved change: the card used to repeat the margin mode under
    // the order buttons, a few centimetres below the working Cross/Isolated
    // switcher in the same panel. The duplicate row is gone, so the label
    // now belongs to that switcher alone — asserted both ways, because
    // deleting the CONTROL instead of the echo is the failure mode here.
    expect(SUMMARY).not.toContain("t('futures.marginType')");
    expect(source('components/FuturesMarginLeverage.tsx')).toContain("t('futures.marginType')");
    // The two margin metrics are shown under short labels, with the full
    // names kept as their tooltips — so both keys are still read here.
    expect(SUMMARY).toContain("t('futures.initialMarginUsed')");
    expect(SUMMARY).toContain("t('futures.maintenanceMarginUsed')");
    expect(SUMMARY).toContain("t('futures.initialMarginPct')");
    expect(SUMMARY).toContain("t('futures.maintenanceMarginPct')");
    expect(SUMMARY).toContain("t('futures.marginBalance')");
    expect(SUMMARY).toContain("t('futures.availableMargin')");
  });

  test('it reads the SAME account source as the form and the tables', () => {
    // One `useFuturesAccount`, which the terminal's execution adapter can
    // replace wholesale — so form, slider, tables and summary cannot be
    // reading two different accounts.
    expect(SUMMARY).toContain('useFuturesAccount({ balances: 5000, positions: 5000 })');
    expect(source('lib/useFuturesAccount.ts')).toContain('FuturesAccountSourceContext');
  });

  test('unknown is a dash and a real zero is a zero', () => {
    // `show` renders '—' for null and the formatted number otherwise; null
    // is never coerced to 0 on the way in.
    //
    // `unopened` joined it for the same reason it exists: an account the
    // engine has not opened yet has no available margin, and printing
    // `0.00` over a wallet the server says holds demo funds is the same
    // fake zero in a different disguise.
    //
    // `Number.isFinite` joined it third, and it is the same rule again.
    // These figures are sums of parsed decimal strings; a payload missing a
    // field parses to NaN, and what reached the screen was the literal text
    // "NaN.undefined" — `groupAmount` splitting a non-number on its decimal
    // point. NaN and Infinity are not amounts, so they are what this card
    // already calls not knowing.
    expect(SUMMARY).toContain("value === null || unopened || !Number.isFinite(value) ? '—' : mask(format(value))");
    expect(SUMMARY).toContain('const unopened = activation !== null;');
    // And the percentages take the same route rather than a second one:
    // one function, same `null`/`unopened` test as `show`, still no zero.
    expect(SUMMARY).toContain("    if (value === null || unopened) return '—';");
    expect(SUMMARY).toContain('    return `${value.toFixed(2)}%`;');
    // Owner-approved addition, asserted rather than assumed: a KNOWN usage
    // smaller than two decimals reads `<0.01%`, not `0.00%`. On an
    // eight-figure account nearly every honest margin usage lands under a
    // hundredth of a percent, and flattening it to zero is the same loss
    // the owner rejected on `0.04%`. The band is strictly above zero, so a
    // real zero still prints `0.00%` and an unknown still prints the dash.
    expect(SUMMARY).toContain("    if (value > 0 && value < 0.005) return '<0.01%';");
    expect(SUMMARY).not.toMatch(/value >= 0 && value < 0\.005/);
    // The real account's derivation is unchanged — it is now the branch
    // taken when the engine publishes no aggregate of its own.
    expect(SUMMARY).toContain(': account.balances.data ? (row ? parseFloat(row.available) : 0) : null;');
    // …and when it does publish one, this card DISPLAYS it rather than
    // computing a second maintenance margin from the real tier table. That
    // second derivation is what showed 0.00% on a simulated position.
    // The card holds the execution itself now, because it also refreshes
    // THROUGH it — calling the global account store directly is what made
    // the owner's tab poll the real futures endpoints.
    expect(SUMMARY).toContain('const execution = useFuturesExecution();');
    expect(SUMMARY).toContain('const aggregate = execution.account_aggregate;');
    expect(SUMMARY).toContain('onClick={() => execution.refresh(failedResources)}');
    expect(SUMMARY).not.toContain('refreshFuturesAccount(');
    expect(SUMMARY).toContain('Number(aggregate.maintenanceMargin)');
    expect(SUMMARY).toContain('marginBalance > 0 ? (part / marginBalance) * 100 : 0');
  });

  test('it invents no wallet and converts no asset into margin', () => {
    // Only the quote asset's own row is read. Nothing here values BTC/ETH
    // into USDT or counts them as collateral.
    expect(SUMMARY).toContain("account.balances.data?.find((x) => x.asset === quoteAsset)");
    expect(SUMMARY).not.toMatch(/getTicker|price\s*\*|marketData|convert/i);
  });
});
