import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { nazarTrader, marketplaceTraders } from '../../pages/copy-trading-bolt/traders';
import { KSENIA_TRADER_ID } from '../kseniaCopyTrading';
import { HIDDEN_TRADE_HISTORY_MESSAGE, tradeHistoryIsHidden, privateStrategyView } from '../copyMarketplacePrivacy';

/**
 * THE «СДЕЛКИ» TAB FOR NAZAR AND KSENIA — LOCKED, FOR EVERYONE.
 *
 * The server sends no executions for these two strategies, so the tab has
 * nothing to draw. What it must draw instead is one icon and one sentence,
 * and the point of these cases is that NOTHING about the viewer changes it:
 * copying, following, a favourite, an eligible deposit and an ineligible one
 * all reach the same locked panel, because none of them makes an execution
 * appear on the wire.
 *
 * The component is not reimplemented here. Its ACTUAL source is extracted
 * from components.tsx and rendered, so a future edit that quietly restores a
 * table fails this file rather than shipping.
 */

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const read = (file: string) => readFileSync(resolve(frontend, file), 'utf8').replace(/\r\n/g, '\n');
const source = read('src/pages/copy-trading-bolt/components.tsx');
const ast = ts.createSourceFile('components.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function body(name: string): string {
  const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
  if (!node) throw new Error(`Missing actual component ${name}`);
  return node.getText(ast);
}
function compile(text: string, dependencies: Record<string, unknown>) {
  const compiled = ts.transpileModule(text, { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  const output: Record<string, any> = {};
  new Function('exports', 'require', ...Object.keys(dependencies), compiled)(
    output, (name: string) => (name.endsWith('.css') ? {} : req(name)), ...Object.values(dependencies));
  return output;
}

/** The REAL TradesPanel, with only its leaf imports supplied. */
const { TradesPanel } = compile(body('TradesPanel') + '\nexports.TradesPanel = TradesPanel;', {
  useMemo: (factory: () => unknown) => factory(),
  nazarTrader,
  VISIBLE_TRADE_ROWS: 10,
  HIDDEN_TRADE_HISTORY_MESSAGE,
  tradeHistoryIsHidden,
  generateTrades: () => [{ id: 'X-1', symbol: 'BTCUSDT', side: 'LONG', entryPrice: 1, exitPrice: 2,
    quantity: 1, leverage: 5, netPnl: 10, returnPct: 1, holdingTimeMinutes: 30,
    openedAt: '2026-09-26T01:00:00.000Z', closedAt: '2026-09-26T02:00:00.000Z', result: 'WIN' }],
  EyeOff: () => React.createElement('svg', { 'data-icon': 'eye-off' }),
  ArrowUpRight: () => null, ArrowDownRight: () => null,
  numberLabel: (value: number) => String(value),
  publicSignedUsdt: (value: number) => String(value),
  roiClass: () => 'up',
  formatSyntheticTradePrice: (value: number) => String(value),
  formatSyntheticTradeTime: () => '01:00',
  formatPercent: (value: number) => `${value}%`,
});

const ordinary = marketplaceTraders.find(item => item.id !== nazarTrader.id && item.id !== KSENIA_TRADER_ID)!;
const render = (trader: unknown, periodData?: unknown) =>
  renderToStaticMarkup(React.createElement(TradesPanel, { trader, periodData }));

/** The five viewer states the owner listed. None of them is an input to the
 *  panel at all, which is exactly the claim: they cannot change the answer. */
const VIEWER_STATES = ['не копирует', 'копирует', 'подходит по депозиту',
  'не подходит по депозиту', 'в избранном'] as const;

describe.each([['VX-001', nazarTrader], ['VX-KSENIA', { ...nazarTrader, id: KSENIA_TRADER_ID, name: 'Ksenia' }]] as const)(
  '%s', (id, trader) => {
    it('is a withheld strategy at the display boundary too', () => {
      expect(tradeHistoryIsHidden(id)).toBe(true);
    });

    it.each(VIEWER_STATES)('shows the locked state and no rows — viewer: %s', () => {
      // A loaded, redacted payload.
      const html = render(trader, { tradesHidden: true, totalTrades: 471, trades: [], methodology: 'CASH_FLOW_ADJUSTED_SIMPLE_RETURN' });
      expect(html).toContain(HIDDEN_TRADE_HISTORY_MESSAGE);
      expect(html).toContain('data-icon="eye-off"');
      // No table at all — not an empty one, not a header row.
      expect(html).not.toContain('<table');
      expect(html).not.toContain('<th');
      expect(html).not.toContain('<tr');
      // Nothing that would name an execution or count one.
      for (const word of ['Pair', 'Entry', 'Exit', 'Side', 'Holding', 'PnL', 'закрытых', 'История сделок', '471']) {
        expect(html).not.toContain(word);
      }
    });

    it('is locked BEFORE any payload arrives, and if none ever does', () => {
      // `tradesHidden` lives on a loaded response. Keying the panel on the
      // strategy is what keeps a table shell off the screen while the
      // marketplace request is still in flight or has failed outright.
      for (const periodData of [undefined, { trades: [], totalTrades: 0 }]) {
        const html = render(trader, periodData);
        expect(html).toContain(HIDDEN_TRADE_HISTORY_MESSAGE);
        expect(html).not.toContain('<table');
      }
    });

    it('never offers the history to anyone, however phrased', () => {
      const html = render(trader, { tradesHidden: true, totalTrades: 471, trades: [] });
      // «доступна только подписчикам» would be false: a subscriber does not
      // see it either. And no developer vocabulary reaches the customer.
      for (const phrase of ['подписчик', 'Подписчик', 'депозит', 'OWNER_REPORTED',
        'synthetic', 'modeled', 'SYNTHETIC', 'MODELED', 'управляющего', 'отчётную']) {
        expect(html).not.toContain(phrase);
      }
    });

    it('withholds the rows again at the display boundary', () => {
      const response: any = privateStrategyView({
        trader: { id, name: trader.name }, trades: [{ id: 'leak' }],
        tradeStats: { '7D': { holdingTimeTotalMinutes: 10 }, '30D': {}, '90D': {}, ALL: {} },
        reportedPerformance: [{ id: 'leak' }],
      } as any);
      expect(response.trades).toEqual([]);
      expect(response.reportedPerformance).toBeUndefined();
      expect(response.tradeVisibility).toMatchObject({ mode: 'HIDDEN', reason: 'OWNER_RESTRICTED' });
    });
  });

it('an ordinary catalogue trader still gets its table', () => {
  // The rule is about two strategies, not about the «Сделки» tab in general.
  expect(tradeHistoryIsHidden(ordinary.id)).toBe(false);
  const html = render(ordinary, undefined);
  expect(html).toContain('<table');
  expect(html).not.toContain(HIDDEN_TRADE_HISTORY_MESSAGE);
});

it('the tab itself is still offered — it is locked, not removed', () => {
  expect(source).toContain("{ id: 'trades', label: 'Сделки' }");
});

it('the message is written once, and the components read it from there', () => {
  const copies = [source, read('src/pages/CopyTradingPage.tsx')]
    .filter(text => text.includes(HIDDEN_TRADE_HISTORY_MESSAGE));
  expect(copies).toEqual([]);
  expect(read('src/lib/copyMarketplacePrivacy.ts')).toContain(HIDDEN_TRADE_HISTORY_MESSAGE);
});
