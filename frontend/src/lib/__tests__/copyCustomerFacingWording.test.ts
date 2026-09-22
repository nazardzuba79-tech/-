import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import ts from 'typescript';
import { selectSyntheticPeriod, type SyntheticCopyTradingResponse } from '../syntheticCopyTrading';

/**
 * WHAT THE CUSTOMER READS, AND WHAT THEY MUST NOT.
 *
 * The Copy Trading surfaces are a product, not a changelog. A visitor reads
 * ROI, a period, a date range, PnL and a chart; they do not read where a
 * figure came from, which week an operator reported, or what the server calls
 * its own data. The owner named the phrases that had leaked out of the
 * engine's vocabulary into the page, and this file keeps them out.
 *
 * It reads the ACTUAL string literals and JSX text of the Copy Trading UI —
 * via the TypeScript AST, so an identifier called `synthetic` or
 * `isModeledResponse` is not mistaken for something anyone can see, and a
 * banned phrase cannot hide inside a template string either.
 */

const frontend = resolve(__dirname, '../../..');
const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

/** Every file that renders a Copy Trading surface. */
function uiFiles(): string[] {
  const bolt = resolve(frontend, 'src/pages/copy-trading-bolt');
  return [resolve(frontend, 'src/pages/CopyTradingPage.tsx'),
    ...readdirSync(bolt).filter(name => /\.tsx?$/.test(name)).map(name => resolve(bolt, name))];
}

/**
 * Only what can reach a screen: string literals, template text and JSX text.
 *
 * Two things are deliberately NOT screen text and are skipped, because
 * treating them as customer copy would make this file impossible to satisfy
 * without renaming modules: an import specifier (`'../lib/syntheticCopyTrading'`
 * is a path, not a sentence) and anything inside a `throw`, which is a
 * developer's message and never rendered.
 */
function visibleText(file: string): string[] {
  const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const walk = (node: ts.Node, thrown: boolean) => {
    const inThrow = thrown || ts.isThrowStatement(node);
    const specifier = !!node.parent
      && (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)
        || ts.isImportTypeNode(node.parent) || ts.isExternalModuleReference(node.parent));
    if (!inThrow && !specifier) {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
        || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) out.push(node.text);
      else if (ts.isJsxText(node)) out.push(node.text);
    }
    ts.forEachChild(node, child => walk(child, inThrow));
  };
  walk(ast, false);
  return out;
}

/** The owner's list, plus the vocabulary it belongs to. */
const BANNED = ['по данным управляющего', 'за отчётную неделю', 'за отчетную неделю',
  'OWNER_REPORTED', 'manager-reported', 'synthetic', 'modeled', 'SYNTHETIC', 'MODELED',
  'управляющего', 'отчётной неделе', 'отчетной неделе'];

it('no service vocabulary reaches any Copy Trading surface', () => {
  const offenders: string[] = [];
  for (const file of uiFiles()) {
    for (const text of visibleText(file)) {
      for (const phrase of BANNED) {
        if (text.toLowerCase().includes(phrase.toLowerCase())) {
          offenders.push(`${file.slice(frontend.length + 1)}: ${JSON.stringify(text)}`);
        }
      }
    }
  }
  expect(offenders).toEqual([]);
});

it('the ROI chip and the profile range name the ordinary rolling period', () => {
  const components = read(resolve(frontend, 'src/pages/copy-trading-bolt/components.tsx'));
  // The card's chip is the selected period and nothing else.
  expect(components).toContain('<span>ROI <small>{period}</small></span>');
  // The profile's range line is the rolling one, with no branch left that
  // could substitute a reporting week for it.
  expect(components).toContain('Скользящий период');
  expect(components).not.toMatch(/reportedPeriod/);
  expect(components).toContain("<div><span>{`ROI · ${period}`}</span>");
});

/**
 * And the figure itself moves again.
 *
 * `selectSyntheticPeriod` is what every surface reads. It honours an
 * owner-reported weekly figure only while the payload still declares it as
 * the visible 7D window — which the server now does only inside the week
 * that figure belongs to. After that the window is derived and advances.
 */
function payload(simulatedAt: string, applied: boolean): SyntheticCopyTradingResponse {
  const days = ['2026-09-20', '2026-09-21', '2026-09-22'];
  return {
    trader: { id: 'VX-KSENIA', name: 'Ksenia', vip: true },
    simulation: { seed: 1, mode: 'REAL_TIME', simulatedAt },
    analytics: { roi7: 4, allTime: {} },
    equityHistory: [{ date: '2026-09-19', equity: 100 }, ...days.map((date, index) => ({ date, equity: 101 + index }))],
    dailyResults: days.map(date => ({ date, startEquity: 100, endEquity: 101, realizedPnl: 10, dailyReturn: 0.01, drawdown: 0 })),
    aumHistory: [], followers: [], monthly: [],
    weekly: [{ period: '2026-09-13', roi: 61.9, pnl: 1, trades: 7, winRate: 100, maxDrawdown: 0 }],
    trades: [],
    reportedWeeks: [{ traderId: 'VX-KSENIA', periodStart: '2026-09-13', periodEnd: '2026-09-19',
      timezone: 'UTC', returnPct: 61.9, source: 'OWNER_REPORTED', includesReportedTradeOf20260916: false,
      modeledReturnPct: 12.7094, publishedReturnPct: 20.5094,
      appliedToVisibleWeeklyRoi: applied, stillInsideReportedWeek: applied }],
  } as unknown as SyntheticCopyTradingResponse;
}

it('the current 7D is the reported figure only while the payload says it is', () => {
  const inside = selectSyntheticPeriod(payload('2026-09-19T23:59:59.999Z', true), '7D');
  expect(inside.roi).toBe(61.9);

  // Past the week: the window is derived, and it ends on the latest session
  // rather than on 19 September.
  const after = selectSyntheticPeriod(payload('2026-09-22T23:59:59.999Z', false), '7D');
  expect(after.roi).not.toBe(61.9);
  expect(after.reportedRoi).toBeNull();
  expect(after.reportedPeriod).toBeNull();
  expect(after.equity[after.equity.length - 1].date).toBe('2026-09-22');
  expect(after.daily[after.daily.length - 1].date).toBe('2026-09-22');
});

it('the finished week keeps the reported figure on its own weekly row', () => {
  const data = payload('2026-09-22T23:59:59.999Z', false);
  expect(data.weekly.find(week => week.period === '2026-09-13')!.roi).toBe(61.9);
});
