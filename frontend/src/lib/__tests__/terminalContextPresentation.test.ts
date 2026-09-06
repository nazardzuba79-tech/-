import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { terminalBookMetrics } from '../terminalMarket';
import { formatCompact } from '../formatNumber';
import { formatTerminalQuote, formatTerminalSpreadPercent } from '../terminalExecution';

const frontendRoot = resolve(__dirname, '../../..');
const frontendRequire = createRequire(resolve(frontendRoot, 'package.json'));
const React = frontendRequire('react');
const { renderToStaticMarkup } = frontendRequire('react-dom/server');

// Render the actual TSX with the real market calculations. Only browser
// services/icons/localization are isolated; SSR must never contact a feed.
function componentModule(file: string) {
  const source = readFileSync(resolve(frontendRoot, 'src/pages/trade-terminal', file), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exported: Record<string, any> = {};
  const requireDependency = (id: string) => {
    if (id === 'react' || id === 'react/jsx-runtime') return frontendRequire(id);
    if (id.endsWith('/terminalMarket')) return { terminalBookMetrics };
    if (id.endsWith('/terminalExecution')) return { formatTerminalQuote, formatTerminalSpreadPercent };
    if (id.endsWith('/formatNumber')) return { formatCompact };
    if (id.endsWith('/priceChange')) return { parseChangePercent: Number };
    if (id.endsWith('/api')) return { api: {} };
    if (id.endsWith('/krakenSocket')) return { krakenSocket: {} };
    if (id.endsWith('/i18n')) return { useLanguage: () => ({ t: (key: string) => ({
      'nav.markets': 'Рынки', 'trade.high24h': 'Макс. 24ч',
      'trade.low24h': 'Мин. 24ч', 'trade.spread': 'Спред',
    } as Record<string, string>)[key] ?? key }) };
    if (id.endsWith('/CryptoIcon')) return { CryptoIcon: () => null };
    if (id === 'lucide-react') return { ChevronDown: () => null };
    throw new Error(`Unexpected rendering dependency: ${id}`);
  };
  new Function('require', 'exports', output)(requireDependency, exported);
  return exported;
}

const flow = componentModule('FlowContext.tsx');
const spine = componentModule('MarketSpine.tsx');
const book = {
  bids: [{ price: '100', quantity: '3' }, { price: '99', quantity: '8' }],
  asks: [{ price: '100.2', quantity: '4' }, { price: '102', quantity: '7' }],
};
const render = (component: any, props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(component, props)) as string;

test('market context renders real spread, near-mid depth and liquidity balance without duplicate best quotes', () => {
  const html = render(flow.FlowContext, { book, pair: 'BTC/USDT' });
  const metrics = terminalBookMetrics(book.bids, book.asks);
  expect(metrics.depth).toBeCloseTo(700.8);
  expect(html).toContain(`<span>Спред</span><strong>${formatTerminalQuote(metrics.spread!)}</strong>`);
  expect(html).toContain(`<span>Глубина ±0,5%</span><strong>${formatCompact(metrics.depth!)} USDT</strong>`);
  expect(html).toContain(`width:${metrics.bidShare! * 100}%`);
  expect(html).toContain(`BID ${(metrics.bidShare! * 100).toFixed(1)}%`);
  expect(html).not.toMatch(/Best\s*(bid|ask)|Kraken|<button/i);
  expect(html.match(/<div><span>/g)).toHaveLength(2);
});

test.each([
  { bids: [], asks: [] },
  { bids: [{ price: '102', quantity: '1' }], asks: [{ price: '100', quantity: '2' }] },
])('unavailable/crossed books do not invent market quality: %p', input => {
  const html = render(flow.FlowContext, { book: input, pair: 'BTC/USDT' });
  expect(html).toContain('<span>Спред</span><strong>—</strong>');
  expect(html).toContain('<span>Глубина ±0,5%</span><strong>—</strong>');
  expect(html).not.toContain('liquidity-balance');
});

test('market spine retains pair access and true spread/depth but has no permanent workspace controls', () => {
  const html = render(spine.MarketSpine, { pair: 'BTC/USDT', book, onOpenMarkets: () => {} });
  const metrics = terminalBookMetrics(book.bids, book.asks);
  expect(html).toContain('aria-label="Рынки: BTC/USDT"');
  expect(html).toContain(`${formatTerminalQuote(metrics.spread!)} · ${formatTerminalSpreadPercent(metrics.spreadPercent!)}`);
  expect(html).toContain(`${formatCompact(metrics.depth!)} USDT`);
  expect(html).not.toMatch(/workspace-controls|command-trigger|Рабочее пространство|Командная панель|Standard|Chart focus|<select|<kbd|Best\s*(bid|ask)|Kraken/i);
  expect(html.match(/<button/g)).toHaveLength(1);
});

test('retained internal flow renderers also use neutral visible market terminology', () => {
  const depth = render(flow.FlowDepth, { book, pair: 'BTC/USDT' });
  const tape = render(flow.FlowTape, { pair: 'BTC/USDT', onPick: () => {}, onHover: () => {} });
  expect(depth).toContain('доступные рыночные уровни');
  expect(tape).toContain('aria-label="Рыночные сделки"');
  expect(depth + tape).not.toMatch(/Kraken|Public Kraken/i);
});
