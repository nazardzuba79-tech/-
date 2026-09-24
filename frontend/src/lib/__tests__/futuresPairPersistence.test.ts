import { readFileSync } from 'fs';
import { resolve } from 'path';
import { byData, mountComponent, readSource } from '../../../test-utils/terminalMount';
import {
  DEFAULT_FUTURES_PAIR,
  initialFuturesPair,
  isFuturesPair,
  readLastFuturesPair,
  resolveListedFuturesPair,
  writeLastFuturesPair,
} from '../futuresPairRoute';

/**
 * THE THREE OWNER COMPLAINTS THIS FILE PINS.
 *
 *   1. «Я торгую AKE/USDT, оновлюю сторінку, і Futures відкривається на
 *      BTC/USDT.» A refresh must keep the contract that was on screen.
 *   2. «Не можу просто натиснути AKE/USDT у Positions і повернути графік.»
 *      The contract name in a position row must select that contract —
 *      without touching the position.
 *   3. «Админка губиться серед OTC/Crypto Card.» It belongs beside the
 *      wallet, in its own colour, admin-only.
 *
 * The first two are proven end-to-end in a real browser by
 * `scripts/qa-futures-pair-persistence.cjs` — an actual F5, an actual click.
 * What is pinned here is the logic underneath (unit), the wiring that makes
 * the browser behaviour possible (source), and the one behaviour a mounted
 * component can state exactly: pressing the ticker reports the symbol and
 * does NOT close or modify anything.
 */

const frontend = resolve(__dirname, '../../..');
const source = (path: string) => readFileSync(resolve(frontend, 'src', path), 'utf8').replace(/\r\n/g, '\n');
/** Comments explain the rules; they must not be able to satisfy them. */
const strip = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

const PAGE = source('pages/FuturesPage.tsx');
const PAGE_CODE = strip(PAGE);
const PANEL_SOURCE = source('components/FuturesPositionsPanel.tsx');
const NAV = source('components/Nav.tsx');
const NAV_CODE = strip(NAV);
const INDEX_CSS = source('index.css');
const PARITY_CSS = source('components/FuturesPositionParity.css');

// ── 1. The contract survives a refresh ───────────────────────────────────

describe('1. which contract the terminal opens on', () => {
  /** A localStorage that exists only for the assertion that uses it. */
  const store = (seed?: string) => {
    const map = new Map<string, string>();
    if (seed !== undefined) map.set('voltex:futures:last-pair:v1', seed);
    return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } };
  };

  it('prefers the pair in the address — that is what a refresh carries', () => {
    expect(initialFuturesPair('AKE/USDT', 'ETH/USDT')).toBe('AKE/USDT');
    expect(initialFuturesPair('ETH/USDT', null)).toBe('ETH/USDT');
  });

  it('falls back to the pair this browser last had, for a bare /futures', () => {
    expect(initialFuturesPair(null, 'AKE/USDT')).toBe('AKE/USDT');
    expect(initialFuturesPair(undefined, 'SOL/USDT')).toBe('SOL/USDT');
  });

  it('reaches BTC/USDT only when there is nothing to restore', () => {
    expect(initialFuturesPair(null, null)).toBe('BTC/USDT');
    expect(DEFAULT_FUTURES_PAIR).toBe('BTC/USDT');
  });

  it('never selects a query string that is not a pair', () => {
    // `?pair=` is user input and reaches a symbol-keyed data path, so
    // anything that is not a contract name is IGNORED rather than passed on.
    for (const hostile of ['', '  ', 'BTCUSDT', '<script>', '../../etc/passwd', 'BTC/USDT/EXTRA', 'btc/usdt']) {
      expect(isFuturesPair(hostile)).toBe(false);
      expect(initialFuturesPair(hostile, null)).toBe('BTC/USDT');
    }
    expect(isFuturesPair('AKE/USDT')).toBe(true);
    expect(isFuturesPair('1000PEPE/USDT')).toBe(true);
  });

  it('remembers and re-reads a pair, and refuses to store a bad one', () => {
    const storage = store();
    writeLastFuturesPair('AKE/USDT', storage);
    expect(readLastFuturesPair(storage)).toBe('AKE/USDT');
    writeLastFuturesPair('nonsense', storage);
    expect(readLastFuturesPair(storage)).toBe('AKE/USDT');
    // A browser with storage blocked returns null rather than throwing.
    expect(readLastFuturesPair(null)).toBeNull();
    expect(() => writeLastFuturesPair('AKE/USDT', null)).not.toThrow();
  });

  it('reads a stored pair only when it is one', () => {
    expect(readLastFuturesPair(store('AKE/USDT'))).toBe('AKE/USDT');
    expect(readLastFuturesPair(store('BTCUSDT'))).toBeNull();
  });

  it('keeps a listed contract and replaces only a delisted one', () => {
    const listed = ['BTC/USDT', 'ETH/USDT', 'AKE/USDT'];
    expect(resolveListedFuturesPair('AKE/USDT', listed)).toBe('AKE/USDT');
    expect(resolveListedFuturesPair('ETH/USDT', listed)).toBe('ETH/USDT');
    // The owner's third case: the pair no longer exists.
    expect(resolveListedFuturesPair('GONE/USDT', listed)).toBe('BTC/USDT');
    // BTC itself unlisted: the first real contract, never a dead symbol.
    expect(resolveListedFuturesPair('GONE/USDT', ['ETH/USDT', 'SOL/USDT'])).toBe('ETH/USDT');
  });

  it('treats an empty catalogue as "not answered yet", never as a delisting', () => {
    // This is the failure that threw a valid deep link away: refusing a
    // pair for being absent from a list that had not loaded.
    expect(resolveListedFuturesPair('AKE/USDT', [])).toBe('AKE/USDT');
  });
});

describe('2. the page keeps state, address and memory in step', () => {
  it('reads the address first and the remembered pair second, in one call', () => {
    expect(PAGE_CODE).toContain("useState(() => initialFuturesPair(searchParams.get('pair')))");
    // The hard-coded default is gone from the page: it lives in the module
    // that also states the precedence, so there is one place to read.
    expect(PAGE_CODE).not.toMatch(/useState\([^)]*searchParams\.get\('pair'\)\s*\|\|\s*'BTC\/USDT'/);
  });

  it('writes the contract back into ?pair= on every selection, replacing history', () => {
    const select = PAGE_CODE.slice(PAGE_CODE.indexOf('const selectSymbol = useCallback'));
    const body = select.slice(0, select.indexOf('}, [setSearchParams]);'));
    expect(body).toContain('setSymbol(next)');
    expect(body).toContain('writeLastFuturesPair(next)');
    expect(body).toContain("params.set('pair', next)");
    // Replace, not push: switching contracts is not navigation, and a push
    // would turn the back button into a list of every symbol glanced at.
    expect(body).toContain('{ replace: true }');
  });

  it('routes EVERY selection through it — no second path can bypass the address', () => {
    // `setSymbol` survives only as the state setter itself and inside
    // `selectSymbol`; every caller goes through `selectSymbol`.
    const callers = PAGE_CODE.match(/setSymbol\(/g) ?? [];
    expect(callers).toHaveLength(2); // the one in selectSymbol, the one in the ?pair= sync
    expect(PAGE_CODE).toContain('useNativeDemo(symbol,selectSymbol)');
    expect(PAGE_CODE).toContain('onSelect={selectSymbol}');
    expect(PAGE_CODE).toContain('if (symbols.includes(pair)) selectSymbol(pair);');
  });

  it('seeds the address once when the terminal is opened without a pair', () => {
    // Arriving from the header link restores the remembered contract into
    // state; writing it into the address is what makes the NEXT refresh
    // keep it too.
    expect(PAGE_CODE).toContain("if (!searchParams.get('pair')) selectSymbol(symbol);");
  });

  it('corrects the address when the venue has dropped the restored contract', () => {
    expect(PAGE_CODE).toContain('resolveListedFuturesPair(symbolRef.current, listed)');
    expect(PAGE_CODE).toContain('if (resolved !== symbolRef.current) selectSymbol(resolved);');
  });

  it('leaves the deep-link sync in place, so a second link still switches', () => {
    expect(PAGE_CODE).toMatch(/const next = searchParams\.get\('pair'\);\s*\n\s*if \(next\) \{ setSymbol\(next\); writeLastFuturesPair\(next\); \}/);
  });

  it('changes no trading path while doing it', () => {
    // The guard the owner asked for in words: nothing about orders,
    // positions, leverage or liquidation is touched by this work. The
    // selection path is where a mistake would land, so it is read directly:
    // it sets state, remembers the pair and writes the address. Nothing
    // else.
    const select = PAGE_CODE.slice(PAGE_CODE.indexOf('const selectSymbol = useCallback'));
    const body = select.slice(0, select.indexOf('}, [setSearchParams]);'));
    expect(body).not.toMatch(/placeOrder|closePosition|cancelOrder|setProtection|leverage|api\./);
    // And the panel still closes positions through the engine seam it
    // always did — the new prop is beside that path, not in it.
    expect(PANEL_SOURCE).toContain('execution.closePosition');
    const tickerButton = PANEL_SOURCE.slice(PANEL_SOURCE.indexOf('futures-position-symbol-link'));
    expect(tickerButton.slice(0, tickerButton.indexOf('</button>')))
      .not.toMatch(/closePosition|cancelOrder|setProtection|placeOrder/);
  });
});

// ── 2. The contract name in a position opens that contract ───────────────

const settled = <T,>(data: T) => ({ data, loading: false, refreshing: false, failed: false });
const position = (id: string, symbol: string, side: 'LONG' | 'SHORT' = 'LONG') => ({
  id, symbol, side, size: '1500000', entryPrice: '0.004', leverage: 3,
  marginType: 'CROSS', initialMargin: '2000', liquidationPrice: '0.002', markPrice: '0.0538',
  unrealizedPnl: '74700', realizedPnl: '0', roe: '3735', openedAt: '2026-01-01T00:00:00Z',
  protection: { takeProfit: null, stopLoss: null },
});

function openPanel(onSelectSymbol?: jest.Mock, extra: Record<string, unknown> = {}) {
  const closePosition = jest.fn().mockResolvedValue(undefined);
  const mounted = mountComponent('components/FuturesPositionsPanel.tsx', {
    account: {
      balances: settled([{ asset: 'USDT', available: '10000', balance: '10000' }]),
      positions: settled([position('p1', 'AKE/USDT'), position('p2', 'BTC/USDT', 'SHORT')]),
      positionHistory: settled([]),
      orders: settled([]),
    },
    execution: { closePosition },
    ...extra,
  });
  const props = { tab: 'open' as const, refreshKey: 0, onSelectSymbol };
  mounted.render(props);
  return { closePosition, render: () => mounted.render(props) };
}

describe('3. the contract name in an open position is the control', () => {
  it('renders one button per row, carrying that row’s own contract', () => {
    const p = openPanel(jest.fn());
    const tickers = byData(p.render(), 'data-position-symbol');
    expect(tickers.map((n: any) => n.props['data-position-symbol'])).toEqual(['AKE/USDT', 'BTC/USDT']);
    // A real button, so it is reachable by keyboard and announced as an
    // action rather than as text that happens to respond to a mouse.
    expect(tickers.every((n: any) => n.type === 'button' && n.props.type === 'button')).toBe(true);
    expect(tickers.every((n: any) => typeof n.props['aria-label'] === 'string' && n.props['aria-label'].length > 0)).toBe(true);
  });

  it('reports the pressed row’s contract — AKE opens AKE, BTC opens BTC', () => {
    const onSelectSymbol = jest.fn();
    const p = openPanel(onSelectSymbol);
    byData(p.render(), 'data-position-symbol')[0].props.onClick();
    expect(onSelectSymbol.mock.calls).toEqual([['AKE/USDT']]);
    byData(p.render(), 'data-position-symbol')[1].props.onClick();
    expect(onSelectSymbol.mock.calls).toEqual([['AKE/USDT'], ['BTC/USDT']]);
  });

  it('DOES NOT touch the position: nothing is closed, nothing is modified', () => {
    // The owner's words: «позиція при цьому НЕ змінюється і НЕ закривається».
    const onSelectSymbol = jest.fn();
    const p = openPanel(onSelectSymbol);
    byData(p.render(), 'data-position-symbol')[0].props.onClick();
    expect(p.closePosition).not.toHaveBeenCalled();
    // Both rows are still there afterwards, unchanged.
    expect(byData(p.render(), 'data-position-symbol')).toHaveLength(2);
  });

  it('stays plain text when no terminal is listening', () => {
    // Standalone (the position-history tab, any other embed) renders the
    // name rather than a button that would do nothing.
    const p = openPanel(undefined);
    expect(byData(p.render(), 'data-position-symbol')).toHaveLength(0);
  });

  it('does not make the whole row clickable', () => {
    // Close and the leverage editor sit in the same row; a row-wide target
    // puts a mis-aimed press one pixel from an action on real money.
    const rowMarkup = PANEL_SOURCE.slice(PANEL_SOURCE.indexOf('className="futures-position-row"'));
    const rowTag = rowMarkup.slice(0, rowMarkup.indexOf('>'));
    expect(rowTag).not.toContain('onClick');
  });

  it('is handed the page’s single selection path, and brings the chart forward on mobile', () => {
    expect(PAGE_CODE).toContain("onSelectSymbol={(next) => { selectSymbol(next); selectMobileTab('chart', true); }}");
    // `selectMobileTab` is a no-op above 900px, so desktop is untouched.
    expect(PAGE_CODE).toContain("if (!window.matchMedia('(max-width: 900px)').matches");
  });

  it('weighs what the text weighed: the button is fully reset, not restyled', () => {
    const rule = PARITY_CSS.match(/\.futures-position-symbol-link \{[^}]+\}/)![0];
    for (const property of ['appearance', 'padding: 0', 'border: 0', 'background: transparent', 'font: inherit', 'color: inherit']) {
      expect(rule).toContain(property);
    }
    // And it says it is pressable, in both pointer and keyboard terms.
    expect(rule).toContain('cursor: pointer');
    expect(PARITY_CSS).toContain('.futures-position-symbol-link:focus-visible {');
    // A 44px target on a phone, like the leverage control beside it.
    expect(source('pages/trade-terminal/FuturesMobile.css'))
      .toContain('#archive-terminal-preview .futures-position-symbol-link { min-height:44px;');
  });
});

// ── 3. Админка sits beside the wallet, in its own colour ─────────────────

describe('4. the admin entry lives in the profile menu (owner, 2026-09-24)', () => {
  // The owner first had «Админка» moved out of the product sections into a
  // violet chip beside «Кошелёк»; on 2026-09-24 they asked for it to go into
  // the profile menu, with «Профиль» and «Выйти», and out of the header row.
  const MENU = NAV_CODE.slice(NAV_CODE.indexOf('className="top-nav-profile-menu"'));
  const menu = MENU.slice(0, MENU.indexOf('</div>'));

  it('is not a product section on the left, and not a chip in the account row', () => {
    const leftNav = NAV_CODE.slice(NAV_CODE.indexOf('className="main-nav'), NAV_CODE.indexOf('className="header-actions'));
    expect(leftNav).toContain("to=\"/otc\"");
    expect(leftNav).not.toContain('to="/admin"');
    const row = NAV_CODE.slice(NAV_CODE.indexOf('className="header-actions'), NAV_CODE.indexOf('className="top-nav-profile-wrap"'));
    expect(row).not.toContain('to="/admin"');
    expect(NAV_CODE).not.toContain('nav-admin-chip');
    expect(INDEX_CSS).not.toContain('nav-admin-chip');
  });

  it('sits in the profile menu between «Профиль» and «Выйти», admin-only on the same gate', () => {
    const profile = menu.indexOf('to="/settings"');
    const admin = menu.indexOf('{isAdmin&&<Link to="/admin" className="top-nav-profile-admin"');
    const logout = menu.indexOf('onClick={handleLogout}');
    expect(profile).toBeGreaterThan(-1);
    expect(admin).toBeGreaterThan(profile);
    expect(logout).toBeGreaterThan(admin);
    // Choosing it closes the menu, like «Профиль».
    expect(menu).toContain('<Link to="/admin" className="top-nav-profile-admin" onClick={()=>setProfileMenuOpen(false)}>');
    expect(NAV_CODE).toContain('api.getMe().then(me=>{setIsAdmin(me.isAdmin)');
    // Menu + mobile drawer, nowhere else.
    expect(NAV_CODE.match(/to="\/admin"/g)).toHaveLength(2);
  });

  it('keeps the drawer entry on a phone, in the same violet family', () => {
    expect(NAV_CODE).toContain('styles.adminBadge');
    expect(NAV).toMatch(/adminBadge:\{[^}]*color:'#c3c1ff'/);
  });

  it('no longer collapses the terminal\'s product nav for admins: the row is the same as everyone\'s', () => {
    expect(INDEX_CSS).not.toContain(':has(.nav-admin)');
    expect(INDEX_CSS).toContain('.top-nav-profile-menu .top-nav-profile-admin svg {\n  color: var(--h-admin);\n}');
  });
});
