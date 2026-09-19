import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import { createHash } from 'crypto';
import ts from 'typescript';
import { readDictionaries } from '../../../test-utils/i18nSource';

const root = resolve(__dirname, '../../../..');
const frontend = resolve(root, 'frontend');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8').replace(/\r\n/g, '\n');
const wallet = 'frontend/src/pages/wallet-v3/';
function evaluate(file: string, imports: Record<string, unknown> = {}, suffix = '') {
  const code = ts.transpileModule(read(file) + suffix, { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  const output: Record<string, any> = {};
  new Function('exports', 'require', code)(output, (name: string) => name.endsWith('.css') ? {} : imports[name] ?? req(name));
  return output;
}
// Read the actual seven dictionaries. No copy/number formatter is recreated.
//
// They live one-per-file under lib/i18n/locales now, so they are read from
// there rather than out of a `DICTS` map that no longer exists — all seven,
// same values, and `localeOf` still comes from the real i18n module so the
// formatter under test is the production one.
const qaDictionaries = readDictionaries();
const i18nModule = evaluate('frontend/src/lib/i18n.tsx', {
  './i18n/locales/ru': { RU: qaDictionaries.ru },
  './i18n/locales/keys': {},
});
const translations = { ...i18nModule, qaDictionaries };
// `t` interpolates like the real one: a sentence that names an asset has to
// be checkable for that asset, not for the literal `{assets}` placeholder.
const language = (lang = 'ru') => ({
  lang,
  t: (key: string, params?: Record<string, string | number>) => {
    const template = translations.qaDictionaries[lang as keyof typeof qaDictionaries][key] ?? key;
    return params ? template.replace(/\{(\w+)\}/g, (match: string, name: string) => String(params[name] ?? match)) : template;
  },
});
const fmt = evaluate(wallet + 'format.ts', { '../../lib/i18n': translations });
const ui = evaluate(wallet + 'ui.tsx', { '../../lib/i18n': { useLanguage: () => language() } });

const rows = [
  { symbol: 'BTC', name: 'Bitcoin', total: 271, available: 268.5, locked: 2.5, priceUsd: 80450.25, changePercent24h: 1.24, valueUsd: 21802017.75, spendable: true, priced: true },
  { symbol: 'USDT', name: 'Tether', total: 32726245, available: 32726245, locked: 0, priceUsd: 1, changePercent24h: 0, valueUsd: 32726245, spendable: true, priced: true },
  { symbol: 'XRP', name: 'XRP', total: 1200000, available: 1200000, locked: 0, priceUsd: 2.85, changePercent24h: -2.13, valueUsd: 3420000, spendable: true, priced: true },
  { symbol: 'ETH', name: 'Ethereum', total: .00412, available: .00412, locked: 0, priceUsd: 4321.09, changePercent24h: null, valueUsd: 17.8028908, spendable: true, priced: true },
  { symbol: 'SOL', name: 'Solana', total: 0, available: 0, locked: 0, priceUsd: 167.42, changePercent24h: 3.45, valueUsd: 0, spendable: true, priced: true },
];
const normalize = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ');
function nodes(node: any, predicate: (value: any) => boolean): any[] {
  if (Array.isArray(node)) return node.flatMap(value => nodes(value, predicate));
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}
function text(node: any): string {
  if (Array.isArray(node)) return node.map(text).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return node && typeof node === 'object' ? text(node.props?.children) : '';
}
const byClass = (tree: any, name: string) => nodes(tree, node => node.props?.className?.split(' ').includes(name));
function ledgerFixture(options: Record<string, any> = {}, lang = 'ru') {
  const state: any[] = [], refs: any[] = [], effects: (() => any)[] = [];
  let stateCursor = 0, refCursor = 0;
  const hooks = { ...React,
    useState(initial: any) {
      const slot = stateCursor++;
      if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial;
      return [state[slot], (next: any) => { state[slot] = typeof next === 'function' ? next(state[slot]) : next; }];
    },
    useMemo: (factory: () => any) => factory(),
    useRef(initial: any) { const slot = refCursor++; return refs[slot] ?? (refs[slot] = { current: initial }); },
    useEffect: (callback: () => any) => { effects.push(callback); },
  };
  const { AssetLedger } = evaluate(wallet + 'AssetLedger.tsx', {
    react: hooks, 'react-dom': { createPortal: (children: any) => children },
    'react-router-dom': { Link: ({ to, children, ...props }: any) => React.createElement('a', { ...props, href: to }, children) },
    '../../components/CryptoIcon': { CryptoIcon: ({ symbol }: any) => React.createElement('span', { 'data-icon': symbol }) },
    '../../lib/i18n': { useLanguage: () => language(lang) }, './format': fmt, './ui': ui,
  });
  const callbacks = { onDeposit: jest.fn(), onTransfer: jest.fn(), onWithdraw: jest.fn() };
  const props = { rows, hidden: false, unavailable: false, loading: false, ...callbacks, ...options };
  const render = () => { stateCursor = 0; refCursor = 0; effects.length = 0; return AssetLedger(props); };
  return { render, props, callbacks, refs, effects,
    html: () => normalize(renderToStaticMarkup(render())),
    tableRows: () => nodes(nodes(render(), n => n.type === 'tbody')[0], n => n.type === 'tr'),
  };
}

test('desktop ledger has exactly the six approved columns and original quantity/USD meaning', () => {
  const fixture = ledgerFixture();
  const headings = nodes(fixture.render(), node => node.type === 'th').map(text);
  // The approved design's own column set: the quantity with its USD value
  // under it, the wallet row and the committed quantity as columns of their
  // own, whether the holding backs the margin, and the actions.
  expect(headings).toEqual(['Валюта', 'Активы', 'Баланс кошелька', 'В ордерах', 'В качестве обеспечения', 'Действие']);
  expect(nodes(fixture.render(), node => node.type === 'col')).toHaveLength(6);
  for (const row of fixture.tableRows()) expect(nodes(row, node => node.type === 'td')).toHaveLength(6);
  const html = fixture.html();
  for (const amount of ['271 BTC', '32 726 245 USDT', '1 200 000 XRP', '0,00412 ETH']) expect(html).toContain(amount);
  expect(html).not.toMatch(/32\.7[MК]|1\.2[MК]|271\s*\$/);
  expect(html).toContain('$32 726 245,00');
});

test('the collateral column states the server-decided fact and is not a control', () => {
  // On the Cross account a PRICED holding backs the margin; the switch only
  // SHOWS that, and says it cannot be changed here. On a plain ledger there
  // is no collateral and the cell is an unknown, never a zero or an "off".
  const cross = ledgerFixture({ collateral: true, rows: [rows[0], { ...rows[1], priceUsd: null, valueUsd: null, priced: false }] });
  const switches = nodes(cross.render(), node => node.props?.role === 'switch');
  expect(switches).toHaveLength(2);
  expect(switches.map(node => node.props['aria-checked'])).toEqual([true, false]);
  expect(switches.every(node => node.props['aria-disabled'] === 'true' && !node.props.onClick)).toBe(true);
  const spot = ledgerFixture({ collateral: false });
  expect(nodes(spot.render(), node => node.props?.role === 'switch')).toHaveLength(0);
  expect(normalize(text(nodes(spot.tableRows()[0], node => node.type === 'td')[4]))).toBe(fmt.EM_DASH);
});

test.each(['ru', 'en', 'zh', 'es', 'hi', 'ja', 'ko'])('all %s columns/actions are localized and quantities preserve units', lang => {
  const fixture = ledgerFixture({}, lang);
  expect(nodes(fixture.render(), node => node.type === 'th')).toHaveLength(6);
  expect(fixture.html()).not.toMatch(/wallet\.(actions|tradeAction|col)/);
  expect(fixture.html()).toContain(normalize(fmt.formatAmount(32726245, lang, 2) + ' USDT'));
  expect(fixture.html()).toContain(normalize(fmt.formatUsd(32726245, lang)));
});

test('committed balance is its own column, on every row, with zero shown as the real answer it is', () => {
  const fixture = ledgerFixture();
  const rowsRendered = fixture.tableRows();
  // One cell per row now, not one footnote on the single row that had any.
  // A zero here means "nothing of this asset is committed", which is an
  // answer; hiding it would make the column read as unknown on most rows.
  expect(byClass(fixture.render(), 'wallet-ledger-locked')).toHaveLength(rowsRendered.length);
  const btc = rowsRendered.find(row => text(row).includes('Bitcoin'));
  const cells = nodes(btc, node => node.type === 'td');
  expect(byClass(cells[3], 'wallet-ledger-locked')).toHaveLength(1);
  // The unit is carried once, by the `Активы` column; repeating it in more
  // columns is noise in a dense grid. (The available figure rides along in
  // the same cell, hidden, so the mask audit still covers it.)
  expect(normalize(text(byClass(cells[3], 'wallet-ledger-locked')[0]))).toBe('2,5');
  const usdt = rowsRendered.find(row => text(row).includes('Tether'));
  expect(normalize(text(byClass(nodes(usdt, node => node.type === 'td')[3], 'wallet-ledger-locked')[0]))).toBe('0');
});

test('an asset with no price is reported unknown, never as a holding worth nothing', () => {
  const unpriced = { ...rows[0], priceUsd: null, valueUsd: null, priced: false };
  const fixture = ledgerFixture({ rows: [unpriced] });
  const cell = byClass(fixture.render(), 'wallet-ledger-value')[0];
  // The dash alone reads the same as an empty balance. The label is what
  // makes it a missing PRICE rather than a missing holding.
  expect(normalize(text(cell))).toContain(fmt.EM_DASH);
  expect(byClass(cell, 'wallet-ledger-unpriced')).toHaveLength(1);
  expect(fixture.html()).toContain('Нет котировки');
  expect(fixture.html()).not.toMatch(/\$0[,.]00/);
  // The quantity is still known and still shown — only its value is not.
  expect(normalize(text(byClass(fixture.render(), 'wallet-ledger-quantity')[0]))).toBe('271 BTC');
});

test('valueUsd is authoritative, not recomputed from quantity or a decorative price', () => {
  const provided = { ...rows[0], valueUsd: 1234567.89 };
  const fixture = ledgerFixture({ rows: [provided] });
  const before = JSON.stringify(provided);
  expect(normalize(text(byClass(fixture.render(), 'wallet-ledger-value')[0]))).toBe('$1 234 567,89');
  expect(text(byClass(fixture.render(), 'wallet-ledger-quantity')[0])).toBe('271 BTC');
  expect(JSON.stringify(provided)).toBe(before);
});

test('mobile primary quantity has its symbol and secondary estimated USD; expansion preserves available and locked', () => {
  const fixture = ledgerFixture();
  const mobile = byClass(fixture.render(), 'wallet-ledger-mobile')[0];
  expect(byClass(mobile, 'wallet-ledger-mobile-quantity').map(node => normalize(text(node))))
    .toEqual(['32 726 245 USDT', '271 BTC', '1 200 000 XRP', '0,00412 ETH']);
  expect(byClass(mobile, 'wallet-ledger-mobile-value').every(node => text(node).startsWith('≈ $'))).toBe(true);
  const btc = nodes(mobile, node => node.type === 'li').find(node => text(node).includes('Bitcoin'));
  const button = nodes(btc, node => node.type === 'button')[0];
  expect(button.props['aria-expanded']).toBe(false);
  button.props.onClick();
  const detail = byClass(fixture.render(), 'wallet-ledger-mobile-detail')[0];
  expect(normalize(text(detail))).toContain('268,5 BTC');
  expect(normalize(text(detail))).toContain('В использовании');
  expect(normalize(text(detail))).toContain('2,5 BTC');
  expect(normalize(text(detail))).not.toContain('NaN');
  expect(byClass(detail, 'wallet-ledger-row-actions')).toHaveLength(1);
});

test('hidden balances mask quantity/available/locked/value on desktop and mobile while retaining market change', () => {
  const fixture = ledgerFixture({ hidden: true });
  for (const className of ['wallet-ledger-quantity', 'wallet-ledger-available', 'wallet-ledger-value', 'wallet-ledger-mobile-quantity', 'wallet-ledger-mobile-value']) {
    expect(byClass(fixture.render(), className).every(node => text(node) === fmt.MASK)).toBe(true);
  }
  expect(byClass(fixture.render(), 'wallet-ledger-locked').every(node => text(node) === fmt.MASK)).toBe(true);
  expect(fixture.html()).not.toMatch(/32 726 245|268,5|2,5 BTC|21 802 017/);
  expect(fixture.html()).toContain('+1,24%');
});

test('actual search, hide-small and sort handlers preserve original filtering and value order without row mutation', () => {
  const before = JSON.stringify(rows), fixture = ledgerFixture();
  expect(fixture.tableRows().map(row => row.key)).toEqual(['USDT', 'BTC', 'XRP', 'ETH']);
  const search = nodes(fixture.render(), node => node.type === 'input' && node.props.type === 'search')[0];
  search.props.onChange({ target: { value: '  bitCOIN ' } });
  expect(fixture.tableRows().map(row => row.key)).toEqual(['BTC']);
  search.props.onChange({ target: { value: '' } });
  const hideZero = nodes(fixture.render(), node => node.type === 'button' && node.props['aria-pressed'] !== undefined)[0];
  hideZero.props.onClick();
  expect(fixture.tableRows().map(row => row.key)).toContain('SOL');
  const balanceHeader = nodes(fixture.render(), node => node.type === 'th').find(node => text(node) === 'Активы');
  nodes(balanceHeader, node => node.type === 'button')[0].props.onClick();
  expect(fixture.tableRows().map(row => row.key)).toEqual(['USDT', 'XRP', 'BTC', 'ETH', 'SOL']);
  nodes(nodes(fixture.render(), node => node.type === 'th').find(node => text(node) === 'Активы'), node => node.type === 'button')[0].props.onClick();
  expect(fixture.tableRows().map(row => row.key)).toEqual(['SOL', 'ETH', 'BTC', 'XRP', 'USDT']);
  expect(JSON.stringify(rows)).toBe(before);
});

test.each([
  [{ unavailable: true }, 'Данные временно недоступны'],
  [{ loading: true }, 'Загрузка…'],
  [{ rows: [] }, 'На счёте нет активов'],
])('loading/error/empty state remains honest without invented balances (%j)', (props, label) => {
  const fixture = ledgerFixture(props);
  expect(fixture.html()).toContain(label);
  expect(nodes(fixture.render(), node => node.type === 'table')).toHaveLength(0);
});

test('row actions invoke existing callbacks, generic Trade route and menu keyboard lifecycle without financial calls', () => {
  const fixture = ledgerFixture(), oldWindow = (globalThis as any).window, oldDocument = (globalThis as any).document;
  const listeners = new Map<string, (event: any) => void>();
  const firstFocus = jest.fn(), triggerFocus = jest.fn();
  (globalThis as any).window = { innerWidth: 1440, innerHeight: 1000,
    addEventListener: jest.fn((type, handler) => listeners.set('window:' + type, handler)), removeEventListener: jest.fn() };
  (globalThis as any).document = {
    addEventListener: jest.fn((type, handler) => listeners.set(type, handler)), removeEventListener: jest.fn(), activeElement: null,
  };
  try {
    fixture.render();
    // `Перевести` moved into the row menu: a wrapped three-action stack was
    // inflating every row and clipping the column. It is still one click
    // away and still calls the same callback.
    expect(byClass(fixture.render(), 'wallet-ledger-trade').every(node => node.props.to === '/trade')).toBe(true);
    fixture.refs[0].current = { closest: () => null };
    fixture.refs[1].current = { querySelector: () => ({ focus: firstFocus }) };
    const trigger = { focus: triggerFocus, getBoundingClientRect: () => ({ right: 500, bottom: 500, top: 472 }) };
    byClass(fixture.render(), 'wallet-ledger-more')[0].props.onClick({ currentTarget: trigger });
    const menu = byClass(fixture.render(), 'wallet-ledger-action-menu')[0];
    expect(menu.props.role).toBe('menu');
    const cleanup = fixture.effects[0]();
    expect(firstFocus).toHaveBeenCalledTimes(1);
    const preventDefault = jest.fn();
    listeners.get('keydown')!({ key: 'Escape', preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1); expect(triggerFocus).toHaveBeenCalledTimes(1);
    expect(byClass(fixture.render(), 'wallet-ledger-action-menu')).toHaveLength(0);
    cleanup();
    for (const [index, callback] of [[0, 'onDeposit'], [1, 'onWithdraw'], [2, 'onTransfer']] as const) {
      byClass(fixture.render(), 'wallet-ledger-more')[0].props.onClick({ currentTarget: trigger });
      const buttons = nodes(byClass(fixture.render(), 'wallet-ledger-action-menu')[0], node => node.props.role === 'menuitem');
      buttons[index].props.onClick();
      expect(fixture.callbacks[callback]).toHaveBeenCalledTimes(1);
      expect(byClass(fixture.render(), 'wallet-ledger-action-menu')).toHaveLength(0);
    }
    expect(read(wallet + 'AssetLedger.tsx')).not.toMatch(/\bapi\.|\bfetch\(|requestWithdrawal|transferFuturesFunds/);
  } finally { (globalThis as any).window = oldWindow; (globalThis as any).document = oldDocument; }
});

test('Wallet entry wires all ledger actions to the original modal state and keeps deep links', () => {
  const source = read('frontend/src/pages/WalletPage.tsx');
  const ledger = source.match(/<AssetLedger\s[\s\S]*?\/>/)?.[0];
  expect(ledger).toBeDefined();
  for (const [callback, modal] of [['onDeposit', 'deposit'], ['onWithdraw', 'withdraw'], ['onTransfer', 'transfer']]) {
    expect(ledger).toContain(`${callback}={() => setModal('${modal}')}`);
  }
  expect(source).toContain("searchParams.get('action')");
  expect(source).toContain('<WithdrawModal open={modal === \'withdraw\'} onClose={() => setModal(null)} onSubmitted={refresh} />');
  expect(source).toContain('<TransferModal open={modal === \'transfer\'} onClose={() => setModal(null)} onSubmitted={refresh} />');
});

test('Wallet portal layer clears mobile navigation/support without changing other products or modal behavior', () => {
  const postcss = req('postcss');
  const css = postcss.parse(read(wallet + 'wallet.css'));
  let modal: any;
  css.walkRules((rule: any) => {
    // PostCSS understands commas inside :where(); a plain split would not.
    for (const selector of postcss.list.comma(rule.selector)) {
      expect(selector.trim()).toMatch(/^(?:\.vx-wallet(?:-modal-root)?\b|:where\(\.vx-wallet(?:-modal-root)?\b)/);
    }
    if (rule.selector === '.vx-wallet-modal-root') modal = rule;
  });
  expect(modal).toBeDefined();
  const declarations = Object.fromEntries(modal.nodes.map((node: any) => [node.prop, node.value]));
  expect(declarations['z-index']).toBe('1100');
  expect(Number(declarations['z-index'])).toBeGreaterThan(998);
  // The modal layer reads the workspace's own ink token, so it follows the
  // Wallet's theme instead of pinning a light-surface literal.
  expect(declarations.color).toBe('var(--w-ink)');
  expect(declarations['font-family']).toBe("'Inter', var(--font-ui), system-ui, sans-serif");
  expect(modal.nodes.some((node: any) => node.important)).toBe(false);
});

test('missing preflight borders are supplied only inside Wallet main/dialog at zero specificity', () => {
  const css = req('postcss').parse(read(wallet + 'wallet.css'));
  let borderReset: any;
  css.walkRules((rule: any) => {
    if (rule.selector === ':where(.vx-wallet main *, .vx-wallet-modal-root *)') borderReset = rule;
  });
  expect(borderReset).toBeDefined();
  expect(borderReset.nodes.map((node: any) => [node.prop, node.value, Boolean(node.important)]))
    .toEqual([['border', '0 solid', false]]);
  for (const scope of ['.vx-wallet', '.vx-wallet-modal-root']) {
    for (const element of ['button', 'input', 'select']) {
      expect(read(wallet + 'wallet.css')).toContain(`:where(${scope}) ${element}`);
    }
  }
  expect(read(wallet + 'wallet.css')).not.toMatch(/:where\([^)]*\b(?:body|nav|:root)\b/);
});

test.each([
  // The approved layout writes the currency as a `USD` suffix rather than
  // a `$` prefix; the figure itself keeps every digit and its cents.
  [false, false, '12 345 678,91'],
  [true, false, fmt.MASK],
  [false, true, fmt.EM_DASH],
])('the headline figures retain their authoritative financial expression (hidden=%s, unavailable=%s)', (hidden, unavailable, expected) => {
  const { PortfolioStrip } = evaluate(wallet + 'PortfolioStrip.tsx', {
    '../../lib/i18n': { useLanguage: () => language() }, './format': fmt,
    // The idle-margin note routes to the terminal, so the header now has a
    // router dependency; stubbed here exactly as the ledger's Trade link is.
    'react-router-dom': { Link: ({ to, children, ...props }: any) => React.createElement('a', { ...props, href: to }, children) },
    './useWalletData': { PERFORMANCE_PERIODS: ['7d', '30d', '90d', '1y', 'all'] },
  });
  // The header renders an ACCOUNT, taken from whichever source is
  // authoritative for it, with BOTH margin ratios answered by the server so
  // nothing here divides one figure by another. See useWalletData.
  const account = {
    mode: 'CROSS', collateralUsd: 12345678.91, totalEquityUsd: 12345678.91,
    availableUsd: 1.25, unrealizedPnlUsd: -2.75,
    initialMarginUsd: 3.5, maintenanceMarginUsd: 0.5, orderReserveUsd: 0,
    initialMarginRatio: 0.0005, maintenanceMarginRatio: 0,
    spotUsd: null, futuresUsd: null, valuationComplete: true, unpricedAssets: [], settleAsset: 'USDT',
  };
  const before = JSON.stringify(account), onToggleHidden = jest.fn();
  const tree = PortfolioStrip({ account, performance: null, performanceLoading: false,
    period: '7d', onPeriodChange: jest.fn(), hidden, unavailable, onToggleHidden,
    onDeposit: jest.fn(), onWithdraw: jest.fn(), onTransfer: jest.fn(), onHistory: jest.fn() });

  const rendered = normalize(renderToStaticMarkup(tree));
  // `Активы` is what the account holds; the identical figure under
  // `Баланс маржи` is that plus a zero P&L, not a second derivation.
  expect(rendered).toContain('Активы');
  expect(rendered).toContain('Баланс маржи');
  expect(rendered).toContain(normalize(expected));
  if (!hidden && !unavailable) {
    expect(rendered).toContain('12 345 678,91<span class="ml-1 text-[12px] font-medium tracking-normal text-ink-3">USD</span>');
    expect(rendered).not.toContain('$12 345 678,91');
    // Three headline figures, no more: the account's own, never a fourth
    // invented from them.
    // The exact class, not its container `wallet-account-metrics`.
    expect([...rendered.matchAll(/class="wallet-account-metric /g)]).toHaveLength(3);
  }

  const heading = nodes(tree, node => node.type === 'h2');
  expect(heading).toHaveLength(1);
  const toggle = nodes(tree, node => node.type === 'button' && node.props['aria-pressed'] === hidden && node.props['aria-label']);
  expect(toggle.length).toBeGreaterThanOrEqual(1);
  toggle[0].props.onClick();
  expect(onToggleHidden).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(account)).toBe(before);
});

test('margin usage prints the ratios the SERVER answered, never a division done here', () => {
  const { PortfolioStrip } = evaluate(wallet + 'PortfolioStrip.tsx', {
    '../../lib/i18n': { useLanguage: () => language() }, './format': fmt,
    // The idle-margin note routes to the terminal, so the header now has a
    // router dependency; stubbed here exactly as the ledger's Trade link is.
    'react-router-dom': { Link: ({ to, children, ...props }: any) => React.createElement('a', { ...props, href: to }, children) },
    './useWalletData': { PERFORMANCE_PERIODS: ['7d', '30d', '90d', '1y', 'all'] },
  });
  const account = {
    mode: 'CROSS', collateralUsd: 1000, totalEquityUsd: 1000, availableUsd: 600, unrealizedPnlUsd: 0,
    initialMarginUsd: 250, maintenanceMarginUsd: 100, orderReserveUsd: 0,
    initialMarginRatio: 0.25, maintenanceMarginRatio: 0.1,
    spotUsd: null, futuresUsd: null, valuationComplete: true, unpricedAssets: [], settleAsset: 'USDT',
  };
  const rendered = normalize(renderToStaticMarkup(PortfolioStrip({ account, performance: null,
    performanceLoading: false, period: '7d', onPeriodChange: jest.fn(), hidden: false, unavailable: false,
    onToggleHidden: jest.fn(), onDeposit: jest.fn(), onWithdraw: jest.fn(), onTransfer: jest.fn(), onHistory: jest.fn() })));

  expect(rendered).toContain('25,00%');
  expect(rendered).toContain('10,00%');
  // The source divides nothing: both ratios arrive on `account`.
  const source = read(wallet + 'PortfolioStrip.tsx');
  expect(source).toContain('account!.initialMarginRatio');
  expect(source).not.toMatch(/initialMargin[A-Za-z]*\s*\/\s*|\/\s*totalEquityUsd/);
});

test('an unknown ratio is a dash, and a real zero is a zero', () => {
  const { PortfolioStrip } = evaluate(wallet + 'PortfolioStrip.tsx', {
    '../../lib/i18n': { useLanguage: () => language() }, './format': fmt,
    // The idle-margin note routes to the terminal, so the header now has a
    // router dependency; stubbed here exactly as the ledger's Trade link is.
    'react-router-dom': { Link: ({ to, children, ...props }: any) => React.createElement('a', { ...props, href: to }, children) },
    './useWalletData': { PERFORMANCE_PERIODS: ['7d', '30d', '90d', '1y', 'all'] },
  });
  const base = {
    mode: 'CROSS', collateralUsd: 0, totalEquityUsd: 0, availableUsd: 0, unrealizedPnlUsd: 0,
    initialMarginUsd: 0, maintenanceMarginUsd: 0, orderReserveUsd: 0,
    spotUsd: null, futuresUsd: null, valuationComplete: true, unpricedAssets: [], settleAsset: 'USDT',
  };
  const render = (account: any) => normalize(renderToStaticMarkup(PortfolioStrip({ account, performance: null,
    performanceLoading: false, period: '7d', onPeriodChange: jest.fn(), hidden: false, unavailable: false,
    onToggleHidden: jest.fn(), onDeposit: jest.fn(), onWithdraw: jest.fn(), onTransfer: jest.fn(), onHistory: jest.fn() })));

  // Equity is not positive, so the server answered `null`: the ratio of an
  // empty account is undefined, and a dash is the only honest rendering.
  const unknown = render({ ...base, initialMarginRatio: null, maintenanceMarginRatio: null });
  expect(unknown).toContain(fmt.EM_DASH);
  // A real zero ratio is a real answer and prints as one.
  const zero = render({ ...base, totalEquityUsd: 1000, initialMarginRatio: 0, maintenanceMarginRatio: 0 });
  expect(zero).toContain('0,00%');
});

test('the account header reports unknown margin figures as dashes, never as zero', () => {
  const { PortfolioStrip } = evaluate(wallet + 'PortfolioStrip.tsx', {
    '../../lib/i18n': { useLanguage: () => language() }, './format': fmt,
    // The idle-margin note routes to the terminal, so the header now has a
    // router dependency; stubbed here exactly as the ledger's Trade link is.
    'react-router-dom': { Link: ({ to, children, ...props }: any) => React.createElement('a', { ...props, href: to }, children) },
    './useWalletData': { PERFORMANCE_PERIODS: ['7d', '30d', '90d', '1y', 'all'] },
  });
  // An ordinary ledger has no margin account. Its margin fields are UNKNOWN
  // — not zero — and the header has to say so, because "no margin is
  // committed" and "we did not ask" are different claims.
  const account = {
    mode: 'SPOT', collateralUsd: 300, totalEquityUsd: 300, availableUsd: null, unrealizedPnlUsd: null,
    initialMarginUsd: null, maintenanceMarginUsd: null, orderReserveUsd: null,
    initialMarginRatio: null, maintenanceMarginRatio: null,
    spotUsd: 250, futuresUsd: 50, valuationComplete: false, unpricedAssets: ['EUR'], settleAsset: 'USDT',
  };
  const tree = PortfolioStrip({ account, performance: null, performanceLoading: false,
    period: '7d', onPeriodChange: jest.fn(), hidden: false, unavailable: false,
    onToggleHidden: jest.fn(), onDeposit: jest.fn(), onWithdraw: jest.fn(), onTransfer: jest.fn(),
    onHistory: jest.fn() });
  // Rendered rather than walked: the metrics are a child component, so the
  // element tree alone would not show what a reader actually sees.
  const rendered = normalize(renderToStaticMarkup(tree));
  // A spot ledger shows its two wallets and no invented margin row.
  expect(rendered).toContain('Спот');
  expect(rendered).toContain('250,00');
  expect(rendered).toContain('Фьючерсы');
  expect(rendered).toContain('50,00');
  // No margin row at all on a plain ledger — and no IM/MM bars either.
  expect(rendered).not.toMatch(/Начальная маржа|Поддерживающая маржа|Доступная маржа/);
  expect(rendered).not.toContain('wallet-margin-usage');
  // And it says the total is incomplete, in the customer's own words: the
  // unpriced asset is named, and the note says it is NOT in the sum. #144
  // rewrote the sentence; the fact it carries is what this pins.
  expect(rendered).toContain('wallet-valuation-note');
  expect(rendered).toContain('EUR');
  expect(rendered).toContain('Оценка неполная');
  expect(rendered).toMatch(/не вошли в сумму/);
  // Unknown is never presented as zero.
  expect(rendered).not.toMatch(/EUR[^<]*\$0[,.]00/);
});

test('Convert is offered as unavailable rather than wired to nothing', () => {
  const { PortfolioStrip } = evaluate(wallet + 'PortfolioStrip.tsx', {
    '../../lib/i18n': { useLanguage: () => language() }, './format': fmt,
    // The idle-margin note routes to the terminal, so the header now has a
    // router dependency; stubbed here exactly as the ledger's Trade link is.
    'react-router-dom': { Link: ({ to, children, ...props }: any) => React.createElement('a', { ...props, href: to }, children) },
    './useWalletData': { PERFORMANCE_PERIODS: ['7d', '30d', '90d', '1y', 'all'] },
  });
  const tree = PortfolioStrip({ account: null, performance: null, performanceLoading: false,
    period: '7d', onPeriodChange: jest.fn(), hidden: false, unavailable: false,
    onToggleHidden: jest.fn(), onDeposit: jest.fn(), onWithdraw: jest.fn(), onTransfer: jest.fn(),
    onHistory: jest.fn() });
  const convert = byClass(tree, 'wallet-action-convert');
  expect(convert).toHaveLength(1);
  // Disabled and labelled, with no onClick at all: there is no convert flow
  // on this exchange, and a button that quietly does nothing is worse than
  // one that says it cannot.
  expect(convert[0].props.disabled).toBe(true);
  expect(convert[0].props['aria-disabled']).toBe('true');
  expect(convert[0].props.onClick).toBeUndefined();
  expect(read(wallet + 'PortfolioStrip.tsx')).not.toMatch(/\bapi\.|\bfetch\(/);
});

function restoreApprovedHistoryTypography(source: string): string {
  // Reverse only these reviewed class-line replacements; retain the original
  // whole-file financial/history fingerprint rather than accepting a new one.
  const replacements: [string, string, number][] = [
  [
    "      <div className=\"mb-3 flex flex-wrap items-center justify-between gap-3\">",
    "      <div className=\"mb-3 flex flex-wrap items-center justify-between gap-2.5\">",
    1
  ],
  [
    "        <h2 className=\"text-[16px] font-semibold leading-6 text-ink\">{t('wallet.history')}</h2>",
    "        <h2 className=\"text-[14px] font-semibold tracking-[-0.01em] text-ink\">{t('wallet.history')}</h2>",
    1
  ],
  [
    "        <div className=\"flex flex-wrap items-center gap-1\">",
    "        <div className=\"flex flex-wrap items-center gap-0.5\">",
    1
  ],
  [
    "              className={`h-8 rounded-wsm border px-2.5 text-[13px] transition-colors duration-150 ease-exp ${",
    "              className={`h-7 rounded-wsm border px-2.5 text-[12px] transition-colors duration-150 ease-exp ${",
    1
  ],
  [
    "                  : 'border-transparent font-medium text-ink-3 hover:bg-panel-2 hover:text-ink-2'",
    "                  : 'border-transparent font-medium text-ink-4 hover:bg-panel-2 hover:text-ink-3'",
    1
  ],
  [
    "          <div className=\"px-4 py-10 text-center text-[14px] leading-6 text-ink-3\">{t('wallet.loading')}</div>",
    "          <div className=\"px-4 py-10 text-center text-[12.5px] text-ink-4\">{t('wallet.loading')}</div>",
    1
  ],
  [
    "          <div className=\"max-w-full overflow-x-auto\">",
    "          <div className=\"overflow-x-auto\">",
    1
  ],
  [
    "            <table className=\"w-full min-w-[680px]\">",
    "            <table className=\"w-full min-w-[600px]\">",
    1
  ],
  [
    "                <tr className=\"border-b border-hair bg-surface-1 text-[12px] font-medium leading-5 text-ink-3\">",
    "                <tr className=\"border-b border-hair bg-surface-1 text-[10.5px] font-medium uppercase tracking-[0.07em] text-ink-4\">",
    1
  ],
  [
    "                  <th scope=\"col\" className=\"whitespace-nowrap px-4 py-3 text-left font-medium sm:pl-5\">{t('wallet.txType')}</th>",
    "                  <th scope=\"col\" className=\"px-4 py-2.5 text-left sm:pl-5\">{t('wallet.txType')}</th>",
    1
  ],
  [
    "                  <th scope=\"col\" className=\"whitespace-nowrap px-3 py-3 text-left font-medium\">{t('wallet.colAsset')}</th>",
    "                  <th scope=\"col\" className=\"px-3 py-2.5 text-left\">{t('wallet.colAsset')}</th>",
    1
  ],
  [
    "                  <th scope=\"col\" className=\"whitespace-nowrap px-3 py-3 text-right font-medium\">{t('wallet.txAmount')}</th>",
    "                  <th scope=\"col\" className=\"px-3 py-2.5 text-right\">{t('wallet.txAmount')}</th>",
    1
  ],
  [
    "                  <th scope=\"col\" className=\"whitespace-nowrap px-3 py-3 text-left font-medium\">{t('trade.status')}</th>",
    "                  <th scope=\"col\" className=\"px-3 py-2.5 text-left\">{t('trade.status')}</th>",
    1
  ],
  [
    "                  <th scope=\"col\" className=\"whitespace-nowrap px-4 py-3 text-right font-medium sm:pr-5\">{t('wallet.txDate')}</th>",
    "                  <th scope=\"col\" className=\"px-4 py-2.5 text-right sm:pr-5\">{t('wallet.txDate')}</th>",
    1
  ],
  [
    "                      <td className=\"whitespace-nowrap px-4 py-3 sm:pl-5\">",
    "                      <td className=\"px-4 py-2.5 sm:pl-5\">",
    1
  ],
  [
    "                          <span className=\"flex h-7 w-7 shrink-0 items-center justify-center rounded-wsm border border-hair bg-panel-2\">",
    "                          <span className=\"flex h-6 w-6 shrink-0 items-center justify-center rounded-wsm border border-hair bg-panel-2\">",
    1
  ],
  [
    "                            <Icon className=\"h-3.5 w-3.5 text-ink-3\" strokeWidth={1.8} />",
    "                            <Icon className=\"h-3 w-3 text-ink-3\" strokeWidth={1.8} />",
    1
  ],
  [
    "                          <span className=\"text-[14px] font-medium leading-5 text-ink\">{t(KIND_LABEL[r.kind])}</span>",
    "                          <span className=\"text-[12.5px] font-medium text-ink\">{t(KIND_LABEL[r.kind])}</span>",
    1
  ],
  [
    "                      <td className=\"whitespace-nowrap px-3 py-3\">",
    "                      <td className=\"px-3 py-2.5\">",
    2
  ],
  [
    "                          <span className=\"text-[14px] font-medium leading-5 text-ink-2\">{r.asset}</span>",
    "                          <span className=\"text-[12.5px] text-ink-2\">{r.asset}</span>",
    1
  ],
  [
    "                      <td className={`num whitespace-nowrap px-3 py-3 text-right text-[14px] font-semibold leading-5 ${r.amount >= 0 ? 'text-pos' : 'text-neg'}`}>",
    "                      <td className={`num px-3 py-2.5 text-right text-[12.5px] font-medium ${r.amount >= 0 ? 'text-pos' : 'text-neg'}`}>",
    1
  ],
  [
    "                        <span className={`inline-flex items-center gap-1.5 rounded-wsm px-2 py-1 text-[12px] font-medium leading-4 ${s.className}`}>",
    "                        <span className={`inline-flex items-center gap-1.5 rounded-wsm px-1.5 py-0.5 text-[11.5px] font-medium ${s.className}`}>",
    1
  ],
  [
    "                      <td className=\"num whitespace-nowrap px-4 py-3 text-right text-[13px] leading-5 text-ink-3 sm:pr-5\">",
    "                      <td className=\"num px-4 py-2.5 text-right text-[12px] text-ink-3 sm:pr-5\">",
    1
  ],
  [
    "                              <ExternalLinkIcon className=\"h-3.5 w-3.5\" strokeWidth={1.8} />",
    "                              <ExternalLinkIcon className=\"h-3 w-3\" strokeWidth={1.8} />",
    1
  ]
];
  for (const [approved, original, count] of replacements) {
    expect(source.split(approved).length - 1).toBe(count);
    source = source.split(approved).join(original);
  }
  return source;
}

// Exact source hashes from verified main35f7dae. Only CRLF and the narrowly
// enumerated history typography reversal above are permitted.
test.each([
  // Re-taken for the Unified Trading Account. What changed and why the
  // guard still has teeth: the hook now ALSO reads the authoritative
  // `/native/wallet` account (once per load, plus on refresh and on the tab
  // regaining focus — never on the 8s balance poll), and exposes it as
  // `account`. The ordinary-ledger row derivation, the price join, the poll
  // intervals and the keep-last-good error handling are unchanged. What was
  // REMOVED is the branch that rendered a hardcoded holdings profile; there
  // is no such list any more, on the server or here. Re-taken again for the
  // reference layout: the view model gained `collateralUsd`, both margin
  // ratios (ANSWERED BY THE SERVER, never divided here) and a per-row
  // `walletBalance`, all pass-throughs. No format, rounding, currency or
  // masking rule in this file changed.
  [wallet + 'useWalletData.ts', '5da69390d6944e665b8d562654398b843acc0793f82dac375212c3feee907dba'],
  [wallet + 'format.ts', '2ffab4fe344b95d04379ac3a85663ffde5a94cf5fbe171a80973c67494d846a0'],
  [wallet + 'DepositModal.tsx', '1db97b349fe86b39fd81c8a35129ebfc319d47b866b0572963483ef76c8d61e4'],
  // Re-taken for issue #144 (+3/-2 in each of WithdrawModal and
  // TransferModal): the single line that displayed a failure now calls
  // `customerErrorText` instead of rendering `ApiError.message`, and the now
  // unused `ApiError` import is gone. The refusal itself is NOT softened —
  // "Insufficient BTC balance" still reaches the customer as "Недостаточно
  // BTC на балансе", in their own language. No amount, asset, network,
  // address, validation rule, submit path, success condition or balance
  // figure in either file changed; the success branch is untouched, so a
  // withdrawal or transfer is still only reported done on the server's word.
  [wallet + 'WithdrawModal.tsx', '15873a49ea88eaefc7025d70b7eabb676b994d6511687327ef3a6196c7ec302b'],
  // Re-taken for the Futures account store (+4/-0, purely additive): one
  // import and one `refreshFuturesAccount(['balances'])` after a SUCCESSFUL
  // transfer, so the shared futures account state does not keep serving a
  // pre-transfer balance to the terminal for up to one poll interval. No
  // financial figure, validation rule, format, amount, direction, error
  // path or modal behaviour in this file changed — the call sits after
  // `load()` on the success path only. The other two hashes in this suite
  // (DepositModal.tsx, api.ts) are PRE-EXISTING failures on main cbe066e
  // and are deliberately left untouched.
  // Re-taken for the same one-line #144 change; see WithdrawModal above.
  [wallet + 'TransferModal.tsx', '27eb01d9c3404b3134e9fbfe7622b4f6c2e69ffbd40d3e6824f919c8c7f856b3'],
  // ui.tsx re-pinned for ONE deliberate change to `Select`: its Escape
  // handler now listens in the capture phase and stops propagation, so
  // Escape closes the open dropdown instead of the dialog around it. The
  // surrounding Modal also listens for Escape on `document` and registered
  // first, so the whole deposit dialog used to shut when a user only wanted
  // out of a list. No option, value, label, disabled rule, focus order or
  // ARIA role changed, and no other export in this file was touched.
  [wallet + 'ui.tsx', '304d71b9ab5a64d3d92c301bb42a9faf277647c840e38e923014e513a7b50f33'],
  [wallet + 'TransactionHistory.tsx', '3650f07956b54e5451e945d6d3e4561cfa0247bfd00d3549d6770374545037d5'],
  ['frontend/src/lib/api.ts', '364345bc08c0084e09387aaad375b185ca0c854d88ffe782c396b59617705d19'],
  // Re-taken for the same change, on the server side: the presentation
  // profile and its 80/20 display split are gone, so every account is now
  // served its own ledger and nothing else. `valuationComplete` and
  // `unpricedAssets` are new and additive — they REPORT the pre-existing
  // behaviour of skipping an unpriced holding instead of summing it as 0.
  // Pricing, the BigNumber arithmetic, the flow-adjusted performance series
  // and the "never write to the ledger" rule are untouched.
  // Re-taken for the manual-adjustment flow fix. An admin credit is a FLOW,
  // not performance: leaving it out published a $6k→$31m top-up as +450 864 %
  // for the week. `realSeries` now also reads the two audited adjustment
  // actions and removes them like any deposit, and picks the flows of the
  // ledger the recorded total actually measures — the simulation one for an
  // account that has a native ledger, the real one otherwise — because
  // subtracting a movement the total never saw would invent a loss. The
  // pricing, the BigNumber arithmetic, the snapshot read and the "never
  // write to the ledger" rule are untouched.
  // Re-taken again for the flow-TIMING correction. A flow is now assigned
  // to the first snapshot AT OR AFTER it, not to its UTC calendar day: the
  // once-daily snapshot may have been recorded BEFORE a later same-day
  // top-up, and subtracting the credit from an observation that never
  // contained it flattens the wrong day and lets the next day's jump read
  // as profit. A flow newer than the last snapshot is left for the
  // observation that will contain it, so it is removed exactly once. The
  // pricing, the BigNumber arithmetic, the ledger choice and the "never
  // write to the ledger" rule are still untouched.
  ['src/services/WalletPortfolioService.ts', 'fbafaf83e96f2a7fb2f40e9ec2f4b8b85191c22e2b10db1bf7fc4068462a4388'],
  ['src/services/PortfolioPerformanceEngine.ts', '7df2bd63857e0f710d020caaabcdc7b42f3269d8949ae03e908251562ab523b6'],
  ['src/api/routes/portfolio.ts', 'e943dce097247b01f5d001770c816faa5be4b024755724b8da2b90822f05f016'],
  ['src/api/middleware/auth.ts', 'a2f258c6b2a3993670ec8378f82e36fb4132ab803036dd1ecd4bd1751ac3e13c'],
])('preserves existing financial/data/format/modal source %s exactly', (file, hash) => {
  const source = file === wallet + 'TransactionHistory.tsx' ? restoreApprovedHistoryTypography(read(file)) : read(file);
  expect(createHash('sha256').update(source).digest('hex')).toBe(hash);
});
