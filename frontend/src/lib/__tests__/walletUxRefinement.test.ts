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
  new Function('exports', 'require', code)(output, (name: string) => name.endsWith('.css') ? {} : name.endsWith('/balanceInvalidation') ? { onSpendableBalancesChanged: () => () => {} } : imports[name] ?? req(name));
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
  { walletBalance: 271, collateralEnabled: true, collateralToggleable: false, symbol: 'BTC', name: 'Bitcoin', total: 271, available: 268.5, locked: 2.5, priceUsd: 80450.25, changePercent24h: 1.24, valueUsd: 21802017.75, spendable: true, priced: true },
  { walletBalance: 32726245, collateralEnabled: true, collateralToggleable: false, symbol: 'USDT', name: 'Tether', total: 32726245, available: 32726245, locked: 0, priceUsd: 1, changePercent24h: 0, valueUsd: 32726245, spendable: true, priced: true },
  { walletBalance: 1200000, collateralEnabled: true, collateralToggleable: false, symbol: 'XRP', name: 'XRP', total: 1200000, available: 1200000, locked: 0, priceUsd: 2.85, changePercent24h: -2.13, valueUsd: 3420000, spendable: true, priced: true },
  { walletBalance: .00412, collateralEnabled: true, collateralToggleable: false, symbol: 'ETH', name: 'Ethereum', total: .00412, available: .00412, locked: 0, priceUsd: 4321.09, changePercent24h: null, valueUsd: 17.8028908, spendable: true, priced: true },
  { walletBalance: 0, collateralEnabled: false, collateralToggleable: false, symbol: 'SOL', name: 'Solana', total: 0, available: 0, locked: 0, priceUsd: 167.42, changePercent24h: 3.45, valueUsd: 0, spendable: true, priced: true },
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
  const toast = { error: jest.fn(), success: jest.fn() };
  const { AssetLedger } = evaluate(wallet + 'AssetLedger.tsx', {
    react: hooks, 'react-dom': { createPortal: (children: any) => children },
    'react-router-dom': { Link: ({ to, children, ...props }: any) => React.createElement('a', { ...props, href: to }, children) },
    '../../components/CryptoIcon': { CryptoIcon: ({ symbol }: any) => React.createElement('span', { 'data-icon': symbol }) },
    '../../lib/i18n': { useLanguage: () => language(lang) }, './format': fmt, './ui': ui,
    '../../lib/toast': { useToast: () => toast },
    '../../lib/customerError': evaluate('frontend/src/lib/customerError.ts'),
  });
  const callbacks = { onDeposit: jest.fn(), onTransfer: jest.fn(), onWithdraw: jest.fn() };
  const props = { rows, hidden: false, unavailable: false, loading: false, ...callbacks, ...options };
  const render = () => { stateCursor = 0; refCursor = 0; effects.length = 0; return AssetLedger(props); };
  return { render, props, callbacks, refs, effects, toast,
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

test('a locked collateral preference follows the server, including priced but disabled holdings', () => {
  // Eligibility and the saved preference are distinct from price availability.
  // Read the server's preference, and refuse changes without its permission.
  const onCollateralChange = jest.fn();
  const cross = ledgerFixture({ collateral: true, onCollateralChange, rows: [rows[0], { ...rows[1], collateralEnabled: false }] });
  const switches = nodes(cross.render(), node => node.props?.role === 'switch');
  expect(switches).toHaveLength(2);
  expect(switches.map(node => node.props['aria-checked'])).toEqual([false, true]);
  expect(switches.every(node => node.props['aria-disabled'] === true && node.props.disabled === true)).toBe(true);
  switches.forEach(node => node.props.onClick());
  expect(onCollateralChange).not.toHaveBeenCalled();
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
  // The withdraw panel can hand over to the transfer when the funds sit on futures.
  expect(source).toContain('<WithdrawModal open={modal === \'withdraw\'} onClose={() => setModal(null)} onSubmitted={refresh} onTransfer={() => setModal(\'transfer\')} />');
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

test('Convert opens the funded account flow without fetching or mutating from the strip', () => {
  const onConvert = jest.fn();
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
    onHistory: jest.fn(), onConvert });
  const convert = byClass(tree, 'wallet-action-convert');
  expect(convert).toHaveLength(1);
  expect(convert[0].props.disabled).not.toBe(true);
  convert[0].props.onClick();
  expect(onConvert).toHaveBeenCalledTimes(1);
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

// The withdraw panel was rebuilt on 2026-09-30 (owner: withdrawal must work
// from every button and go to the admin queue). Its old whole-file pin is
// replaced by what it must keep doing.
test('withdraw panel reads what can be withdrawn from the server and never from a presentation profile', () => {
  const source = read(wallet + 'WithdrawModal.tsx');
  expect(source).toContain('api.getWithdrawalOptions()');
  expect(source).toContain('api.requestWithdrawal(request)');
  expect(source).not.toMatch(/getBalances|getWalletOverview|presentation|nativeDemoApi/);
  // The amount sent is the typed decimal, never a float round-trip.
  expect(source).toMatch(/const request = \{ asset, network: network\.code, toAddress: address\.trim\(\), amount: plain \}/);
  // The 60-minute promise is shown before sending and after.
  expect(source).toContain("t('withdraw.eta')");
  expect(source).toContain("t('withdraw.doneEta')");
  // Nothing is submitted while the address fails its network's check.
  expect(source).toMatch(/const canSubmit = !!row && !!network && verdict === 'ok'/);
});

// Keep exact guards for the unchanged financial formatting/modal boundaries.
// The five old whole-file pins superseded by approved account-read, catalogue,
// managed-listing and auth changes now have explicit behavior checks below.
test.each([
  [wallet + 'format.ts', '2ffab4fe344b95d04379ac3a85663ffde5a94cf5fbe171a80973c67494d846a0'],
  [wallet + 'TransferModal.tsx', '27eb01d9c3404b3134e9fbfe7622b4f6c2e69ffbd40d3e6824f919c8c7f856b3'],
  [wallet + 'ui.tsx', '304d71b9ab5a64d3d92c301bb42a9faf277647c840e38e923014e513a7b50f33'],
  ['src/services/PortfolioPerformanceEngine.ts', '7df2bd63857e0f710d020caaabcdc7b42f3269d8949ae03e908251562ab523b6'],
  ['src/api/routes/portfolio.ts', '3b4708bd2376dfd12d359645f866853f00f36a8967d104c1fec775f31dfdd051'],
])('preserves unchanged financial/data/format/modal source %s exactly', (file, hash) => {
  const source = read(file);
  expect(createHash('sha256').update(source).digest('hex')).toBe(hash);
});

test('the wallet hook passes through economic and collateral equity separately and keeps unknown prices unknown', () => {
  const native = {
    initialized: true, assetsValue: '1000000', assetsEquityValue: '1000250.5', assetsComplete: false, unpricedAssets: ['BTC'],
    account: { equity: '800250.5', available: '700000', unrealizedPnl: '250.5', initialMargin: '90', maintenanceMargin: '20',
      orderReserve: '7', initialMarginRatio: '0.001', maintenanceRatio: '0.0002' },
    collateral: { settleAsset: 'USDT', lines: [{ asset: 'BTC', price: '100000' }] },
    rows: [{ asset: 'BTC', total: '2.25', walletQuantity: '2', available: '1.5', inUse: '0.75', price: null, value: null,
      status: 'UNPRICED', collateralEnabled: false, collateralToggleable: true }],
  };
  const before = JSON.stringify(native);
  const reads: any[] = [];
  const { useWalletData } = evaluate(wallet + 'useWalletData.ts', {
    react: { ...React, useState: (initial: any) => [initial === undefined ? native : initial, jest.fn()],
      useMemo: (factory: () => unknown) => factory(), useCallback: (callback: unknown) => callback,
      useRef: (initial: unknown) => ({ current: initial }), useEffect: () => {} },
    '../../lib/api': { api: {}, getToken: () => 'fixture-session' },
    '../../lib/browserActivity': require('../browserActivity'),
    '../../lib/useVisibleAccountRead': { useVisibleAccountRead: (options: unknown) => { reads.push(options); return jest.fn(); } },
    '../../lib/visibleRead': { createVisibleRead: jest.fn() },
    '../../lib/nativeDemoApi': { nativeDemoApi: {} },
  });
  const view = useWalletData();
  expect(view.account).toMatchObject({ walletEquityUsd: 1000250.5, totalEquityUsd: 800250.5,
    collateralUsd: 1000000, spotUsd: null, futuresUsd: null, initialMarginRatio: .001, maintenanceMarginRatio: .0002 });
  expect(view.btcEquivalent).toBe(10.002505);
  expect(view.rows[0]).toMatchObject({ total: 2.25, walletBalance: 2, available: 1.5, locked: .75,
    valueUsd: null, priceUsd: null, priced: false, collateralEnabled: false, collateralToggleable: true });
  expect(reads).toHaveLength(3);
  expect(reads.every(read => read.staleMs === 30000 && typeof read.reset === 'function')).toBe(true);
  expect(JSON.stringify(native)).toBe(before);
});

test('the current deposit entry point forwards explicit asset selection and never mounts a closed catalogue', () => {
  const Dialog = () => null;
  const onClose = jest.fn();
  const { DepositModal } = evaluate(wallet + 'DepositModal.tsx', {
    '../../lib/useDepositOptions': {}, '../../lib/i18n': { useLanguage: () => language() }, './ui': ui, './format': fmt,
    '../../lib/depositCatalogue': { MANUAL_DEPOSIT_CATALOGUE: true },
    '../../components/DepositCatalogueDialog': { DepositCatalogueDialog: Dialog },
  });
  expect(DepositModal({ open: false, onClose, initialAsset: 'BTC' })).toBeNull();
  const open = DepositModal({ open: true, onClose, initialAsset: 'BTC' });
  expect(open.type).toBe(Dialog);
  // The Wallet names itself as the source of a «Копировали адрес» note.
  expect(open.props).toEqual({ onClose, initialAsset: 'BTC', source: 'wallet' });
  expect(onClose).not.toHaveBeenCalled();
});

test('wallet API reads keep their shared authenticated transport and snapshots carry only the supplied amount', () => {
  const api = read('frontend/src/lib/api.ts');
  const ast = ts.createSourceFile('api.ts', api, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations])
    .find(node => node.name.getText(ast) === 'api')!;
  expect(ts.isObjectLiteralExpression(declaration.initializer!)).toBe(true);
  const methods = (declaration.initializer as ts.ObjectLiteralExpression).properties;
  const method = (name: string) => methods.find(node => node.name?.getText(ast) === name)!.getText(ast);
  expect(method('getWalletOverview')).toMatch(/request<[\s\S]*?>\('\/wallet\/overview', \{ signal \}\)/);
  expect(method('getWalletPerformance')).toMatch(/request<[\s\S]*?>\('\/wallet\/performance', \{ signal \}\)/);
  expect(api).toContain('Authorization: `Bearer ${token}`');
  expect(method('recordPortfolioSnapshot')).toMatch(/JSON\.stringify\(\{ totalValueUsd \}\)/);
  expect(method('recordPortfolioSnapshot')).not.toMatch(/parseFloat|Number\(|Math\.|\*|\/\//);
});

test('the portfolio service values only the requested account balances and leaves unpriced holdings unknown', async () => {
  const { WalletPortfolioService } = evaluate('src/services/WalletPortfolioService.ts', {
    './PortfolioPerformanceEngine': evaluate('src/services/PortfolioPerformanceEngine.ts'),
  });
  const readSpot = jest.fn(async () => [{ asset: 'USDT', available: '2.1', locked: '.2' }, { asset: 'ABC', available: '4', locked: '0' }]);
  const readFutures = jest.fn(async () => [{ asset: 'USDT', available: '7.5', locked: '.3' }]);
  const service = new WalletPortfolioService({ balance: { findMany: readSpot }, futuresBalance: { findMany: readFutures } }, {}, {});
  service.pricesFor = jest.fn(async () => new Map([['USDT', 1], ['BTC', 100000], ['ABC', null]]));
  const view = await service.overview({ id: 'fixture-owner', role: 'USER', email: 'fixture@example.test' });
  expect(readSpot).toHaveBeenCalledWith({ where: { userId: 'fixture-owner' } });
  expect(readFutures).toHaveBeenCalledWith({ where: { userId: 'fixture-owner' } });
  expect(view.real).toMatchObject({ spotValueUsd: 2.3, futuresValueUsd: 7.8, totalValueUsd: 10.1 });
  expect(view.real.spot[1]).toEqual({ asset: 'ABC', available: '4', locked: '0', priceUsd: null, valueUsd: null });
  expect(view.valuationComplete).toBe(false);
  expect(view.unpricedAssets).toEqual(['ABC']);
});

test('authenticated wallet access rechecks session revocation on each read and rejects a pending login', async () => {
  const verify = jest.fn((): any => ({ sub: 'fixture-owner', sid: 'fixture-session' }));
  const { requireAuth } = evaluate('src/api/middleware/auth.ts', { jsonwebtoken: { default: { verify } }, '../../services/ContactEmailPolicy': { isBlockedContactEmail: async () => false, isRevokedContactToken: async () => false } });
  const findUnique = jest.fn(async (): Promise<any> => ({ id: 'fixture-session', userId: 'fixture-owner', revokedAt: null, lastSeenAt: new Date() }));
  const update = jest.fn();
  const gate = requireAuth({ session: { findUnique, update } });
  const response = () => { const res: any = { status: jest.fn(), json: jest.fn() }; res.status.mockReturnValue(res); return res; };
  const next = jest.fn();
  const request = () => ({ headers: { authorization: 'Bearer fixture-token' } });
  await gate(request(), response(), next);
  expect(next).toHaveBeenCalledTimes(1);
  findUnique.mockResolvedValueOnce({ id: 'fixture-session', userId: 'fixture-owner', revokedAt: new Date(), lastSeenAt: new Date() });
  const revoked = response();
  await gate(request(), revoked, next);
  expect(findUnique).toHaveBeenCalledTimes(2);
  expect(revoked.status).toHaveBeenCalledWith(401);
  expect(next).toHaveBeenCalledTimes(1);
  verify.mockReturnValueOnce({ sub: 'fixture-owner', purpose: '2fa' });
  const pending = response();
  await gate(request(), pending, next);
  expect(pending.status).toHaveBeenCalledWith(401);
  expect(next).toHaveBeenCalledTimes(1);
  expect(update).not.toHaveBeenCalled();
});
