import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import { createHash } from 'crypto';
import ts from 'typescript';

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
const translations = evaluate('frontend/src/lib/i18n.tsx', {}, '\nexports.qaDictionaries = DICTS;');
const language = (lang = 'ru') => ({ lang, t: (key: string) => translations.qaDictionaries[lang][key] ?? key });
const fmt = evaluate(wallet + 'format.ts', { '../../lib/i18n': translations });
const ui = evaluate(wallet + 'ui.tsx', { '../../lib/i18n': { useLanguage: () => language() } });

const rows = [
  { symbol: 'BTC', name: 'Bitcoin', total: 271, available: 268.5, locked: 2.5, priceUsd: 80450.25, changePercent24h: 1.24, valueUsd: 21802017.75, spendable: true },
  { symbol: 'USDT', name: 'Tether', total: 32726245, available: 32726245, locked: 0, priceUsd: 1, changePercent24h: 0, valueUsd: 32726245, spendable: true },
  { symbol: 'XRP', name: 'XRP', total: 1200000, available: 1200000, locked: 0, priceUsd: 2.85, changePercent24h: -2.13, valueUsd: 3420000, spendable: true },
  { symbol: 'ETH', name: 'Ethereum', total: .00412, available: .00412, locked: 0, priceUsd: 4321.09, changePercent24h: null, valueUsd: 17.8028908, spendable: true },
  { symbol: 'SOL', name: 'Solana', total: 0, available: 0, locked: 0, priceUsd: 167.42, changePercent24h: 3.45, valueUsd: 0, spendable: true },
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

test('desktop ledger has exactly six requested columns and original quantity/USD meaning', () => {
  const fixture = ledgerFixture();
  const headings = nodes(fixture.render(), node => node.type === 'th').map(text);
  expect(headings).toEqual(['Актив', 'Баланс', 'Доступно', '24ч', 'Стоимость', 'Действия']);
  expect(nodes(fixture.render(), node => node.type === 'col')).toHaveLength(6);
  for (const row of fixture.tableRows()) expect(nodes(row, node => node.type === 'td')).toHaveLength(6);
  const html = fixture.html();
  for (const amount of ['271 BTC', '32 726 245 USDT', '1 200 000 XRP', '0,00412 ETH']) expect(html).toContain(amount);
  expect(html).not.toMatch(/32\.7[MК]|1\.2[MК]|271\s*\$/);
  expect(html).toContain('$32 726 245,00');
});

test.each(['ru', 'en', 'zh', 'es', 'hi', 'ja', 'ko'])('all %s columns/actions are localized and quantities preserve units', lang => {
  const fixture = ledgerFixture({}, lang);
  expect(nodes(fixture.render(), node => node.type === 'th')).toHaveLength(6);
  expect(fixture.html()).not.toMatch(/wallet\.(actions|tradeAction|col)/);
  expect(fixture.html()).toContain(normalize(fmt.formatAmount(32726245, lang, 2) + ' USDT'));
  expect(fixture.html()).toContain(normalize(fmt.formatUsd(32726245, lang)));
});

test('locked balance appears conditionally below Available, never as its own column or zero-filled row', () => {
  const fixture = ledgerFixture();
  const locked = byClass(fixture.render(), 'wallet-ledger-locked');
  expect(locked).toHaveLength(1);
  expect(normalize(text(locked[0]))).toBe('В ордерах: 2,5 BTC');
  const btc = fixture.tableRows().find(row => text(row).includes('Bitcoin'));
  const cells = nodes(btc, node => node.type === 'td');
  expect(byClass(cells[2], 'wallet-ledger-locked')).toHaveLength(1);
  expect(fixture.html()).not.toContain('В ордерах: 0');
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
  expect(normalize(text(detail))).toContain('В ордерах: 2,5 BTC');
  expect(byClass(detail, 'wallet-ledger-row-actions')).toHaveLength(1);
});

test('hidden balances mask quantity/available/locked/value on desktop and mobile while retaining market change', () => {
  const fixture = ledgerFixture({ hidden: true });
  for (const className of ['wallet-ledger-quantity', 'wallet-ledger-available', 'wallet-ledger-value', 'wallet-ledger-mobile-quantity', 'wallet-ledger-mobile-value']) {
    expect(byClass(fixture.render(), className).every(node => text(node) === fmt.MASK)).toBe(true);
  }
  expect(text(byClass(fixture.render(), 'wallet-ledger-locked')[0])).toBe('В ордерах: ' + fmt.MASK);
  expect(fixture.html()).not.toMatch(/32 726 245|268,5|2,5 BTC|21 802 017/);
  expect(fixture.html()).toContain('+1,24%');
});

test('actual search, hide-zero and sort handlers preserve original filtering and value order without row mutation', () => {
  const before = JSON.stringify(rows), fixture = ledgerFixture();
  expect(fixture.tableRows().map(row => row.key)).toEqual(['USDT', 'BTC', 'XRP', 'ETH']);
  const search = nodes(fixture.render(), node => node.type === 'input' && node.props.type === 'search')[0];
  search.props.onChange({ target: { value: '  bitCOIN ' } });
  expect(fixture.tableRows().map(row => row.key)).toEqual(['BTC']);
  search.props.onChange({ target: { value: '' } });
  const hideZero = nodes(fixture.render(), node => node.type === 'button' && node.props['aria-pressed'] !== undefined)[0];
  hideZero.props.onClick();
  expect(fixture.tableRows().map(row => row.key)).toContain('SOL');
  const balanceHeader = nodes(fixture.render(), node => node.type === 'th').find(node => text(node) === 'Баланс');
  nodes(balanceHeader, node => node.type === 'button')[0].props.onClick();
  expect(fixture.tableRows().map(row => row.key)).toEqual(['USDT', 'XRP', 'BTC', 'ETH', 'SOL']);
  nodes(nodes(fixture.render(), node => node.type === 'th').find(node => text(node) === 'Баланс'), node => node.type === 'button')[0].props.onClick();
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
    byClass(fixture.render(), 'wallet-ledger-transfer')[0].props.onClick();
    expect(fixture.callbacks.onTransfer).toHaveBeenCalledTimes(1);
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
    for (const [index, callback] of [[0, 'onDeposit'], [1, 'onWithdraw']] as const) {
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
  expect(declarations.color).toBe('#111318');
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
  [false, false, '$12 345 678,91'],
  [true, false, fmt.MASK],
  [false, true, fmt.EM_DASH],
])('full-width total retains original authoritative financial expression (hidden=%s, unavailable=%s)', (hidden, unavailable, expected) => {
  const { PortfolioStrip } = evaluate(wallet + 'PortfolioStrip.tsx', {
    '../../lib/i18n': { useLanguage: () => language() }, './format': fmt,
    './useWalletData': { PERFORMANCE_PERIODS: ['7d', '30d', '90d', '1y', 'all'] },
  });
  const overview = { displayTotalUsd: 12345678.91, displaySpotUsd: 1.25, displayFuturesUsd: 2.75 };
  const before = JSON.stringify(overview), onToggleHidden = jest.fn();
  const tree = PortfolioStrip({ overview, performance: null, performanceLoading: false,
    btcEquivalent: 153.459124, hidden, unavailable, onToggleHidden,
    period: '7d', onPeriodChange: jest.fn(), onDeposit: jest.fn(), onWithdraw: jest.fn(), onTransfer: jest.fn() });
  const totals = byClass(tree, 'wallet-total-value');
  expect(totals).toHaveLength(1);
  expect(normalize(text(totals[0]))).toBe(expected);
  expect(totals[0].type).toBe('p');
  expect(nodes(totals[0], node => node.type === 'button')).toHaveLength(0);
  const totalParent = nodes(tree, node => Array.isArray(node.props?.children) && node.props.children.includes(totals[0]));
  expect(totalParent).toHaveLength(1);
  const headingRow = totalParent[0].props.children[0];
  expect(nodes(headingRow, node => node.type === 'h2')).toHaveLength(1);
  const toggle = nodes(headingRow, node => node.type === 'button');
  expect(toggle).toHaveLength(1);
  expect(toggle[0].props['aria-pressed']).toBe(hidden);
  toggle[0].props.onClick();
  expect(onToggleHidden).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(overview)).toBe(before);
  if (!hidden) {
    const btc = `${fmt.formatAmount(153.459124, 'ru', fmt.btcEquivalentDecimals(153.459124))} BTC`;
    expect(normalize(text(tree))).toContain(normalize(btc));
  }
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
  [wallet + 'useWalletData.ts', '5de3f8d0ba911ece47608c9e257d0463589bfb004f6ec5b47da971575bb09b52'],
  [wallet + 'format.ts', '2ffab4fe344b95d04379ac3a85663ffde5a94cf5fbe171a80973c67494d846a0'],
  [wallet + 'DepositModal.tsx', '1db97b349fe86b39fd81c8a35129ebfc319d47b866b0572963483ef76c8d61e4'],
  [wallet + 'WithdrawModal.tsx', 'fe3a8d9fa872116f18ccd03aa530f3bf82787ab7652634e88af6efa977dc4220'],
  [wallet + 'TransferModal.tsx', '69cae20e547f1f9945f3960647519eb3e7a44fa53980ea905b85cb11ccb705e4'],
  [wallet + 'ui.tsx', 'b23415fc704a89bab6592ec2148e4869f3fcbbc5d4980e31bd1dd9e8e30f153e'],
  [wallet + 'TransactionHistory.tsx', '3650f07956b54e5451e945d6d3e4561cfa0247bfd00d3549d6770374545037d5'],
  ['frontend/src/lib/api.ts', '364345bc08c0084e09387aaad375b185ca0c854d88ffe782c396b59617705d19'],
  ['src/services/WalletPortfolioService.ts', '047512e8372faa714e6ba9a91dd2d8d0ad6ccf47d7b39399b866186fe204f1f9'],
  ['src/services/PortfolioPerformanceEngine.ts', '7df2bd63857e0f710d020caaabcdc7b42f3269d8949ae03e908251562ab523b6'],
  ['src/api/routes/portfolio.ts', 'e943dce097247b01f5d001770c816faa5be4b024755724b8da2b90822f05f016'],
  ['src/api/middleware/auth.ts', 'a2f258c6b2a3993670ec8378f82e36fb4132ab803036dd1ecd4bd1751ac3e13c'],
])('preserves existing financial/data/format/modal source %s exactly', (file, hash) => {
  let source = file === wallet + 'TransactionHistory.tsx' ? restoreApprovedHistoryTypography(read(file)) : read(file);
  if (file === 'frontend/src/lib/api.ts') {
    // Remove exactly this task's additive read method before the historical
    // fingerprint. Its pre-existing mismatch must remain visible unchanged.
    const bootstrap = "  getCopyMarketplace: (signal?: AbortSignal) => request<import('./copyMarketplaceStore').CopyMarketplaceResponse>('/copy-trading/marketplace', { signal }),\n";
    expect(source.split(bootstrap)).toHaveLength(2);
    source = source.replace(bootstrap, '');
  }
  expect(createHash('sha256').update(source).digest('hex')).toBe(hash);
});
