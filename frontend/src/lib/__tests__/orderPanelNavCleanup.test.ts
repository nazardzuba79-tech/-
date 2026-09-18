import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as futuresMath from '../futuresMath';

/**
 * The owner-approved order-panel and header cleanup, asserted on the real
 * components.
 *
 * Two things are being protected here at once, and they pull in opposite
 * directions. The panel had to get SHORTER — one margin-mode row removed,
 * two metric names abbreviated, two full-width bars reduced to inline
 * indicators — without any figure changing meaning on the way. So every
 * layout assertion below sits next to a figure assertion: a known 0.04%
 * stays 0.04%, a real zero stays a zero, an unknown stays a dash, and an
 * eight-digit balance keeps all eight digits.
 *
 * The header change is the same shape: the wallet link MOVES on desktop,
 * and the tests insist it is still exactly one link, still to /wallet, and
 * still in the mobile menu it never left.
 */

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const source = (path: string) => readFileSync(resolve(frontend, 'src', path), 'utf8');
const pending = () => new Promise<any>(() => {});

type Resource = { data: unknown; loading?: boolean; refreshing?: boolean; failed?: boolean; loaded?: boolean; fetchedAt?: number };
const resource = (data: unknown, failed = false): Resource =>
  ({ data, loading: false, refreshing: false, failed, loaded: data !== null || failed, fetchedAt: data === null ? 0 : 1 });

const accountState = (over: Partial<Record<'balances' | 'positions' | 'orders' | 'positionHistory', Resource>> = {}) => ({
  balances: over.balances ?? resource([{ asset: 'USDT', available: '1000000', locked: '0' }]),
  positions: over.positions ?? resource([]),
  orders: over.orders ?? resource([]),
  positionHistory: over.positionHistory ?? resource([]),
});

/**
 * An engine aggregate, which is where every figure on the card comes from
 * when one exists. Tests pose it directly so the percentage under test is
 * a known quantity rather than something re-derived here.
 */
function aggregate(over: Record<string, unknown> = {}) {
  return {
    equity: '1000', available: '900', unrealizedPnl: '0',
    initialMargin: '0.4', orderReserve: '0', maintenanceMargin: '0',
    collateralComplete: true, unpricedAssets: [],
    ...over,
  };
}

/** Run the real TSX with isolated hooks. No network, no money writes. */
function mount(file: string, overrides: Record<string, any> = {}) {
  let index = 0;
  const hooks: any[] = [], effects: (() => void)[] = [];
  const components: Record<string, any> = {};
  const api = new Proxy(overrides.api ?? {}, { get: (target, key: string) => target[key] ?? pending });

  const react = { ...React, memo: (fn: any) => fn,
    useState(initial: any) {
      const i = index++;
      if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial;
      return [hooks[i], (next: any) => { hooks[i] = typeof next === 'function' ? next(hooks[i]) : next; }];
    },
    useRef(initial: any) { const i = index++; return hooks[i] ?? (hooks[i] = { current: initial }); },
    useMemo(fn: any) { return fn(); },
    useCallback(fn: any) { return fn; },
    useEffect(fn: any, deps: any[]) {
      const i = index++, previous = hooks[i];
      if (!previous || deps.some((value, n) => !Object.is(value, previous.deps[n]))) {
        hooks[i] = { deps, cleanup: undefined };
        effects.push(() => { previous?.cleanup?.(); hooks[i].cleanup = fn(); });
      }
    },
  };

  const execution = {
    engine: 'REAL', ready: true, account: null, marginType: null, defaultMarginType: 'ISOLATED',
    candle: null, contract: null, activation: overrides.activation ?? null,
    account_aggregate: overrides.aggregate ?? null,
    refresh: () => {},
  };

  const output: any = {};
  const compiled = ts.transpileModule(source(file), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function('require', 'exports', 'window', compiled)((name: string) => {
    if (name === 'react') return react;
    if (name === 'react-router-dom') return {
      useNavigate: () => jest.fn(),
      useLocation: () => ({ pathname: '/futures' }),
      Link: (props: any) => React.createElement('a', { href: props.to, className: props.className, style: props.style }, props.children),
    };
    if (name === '../lib/api') return { api, ApiError: Error, clearToken: jest.fn(), getToken: () => null };
    if (name === '../lib/futuresExecution') return { useFuturesExecution: () => execution, REAL_FUTURES_EXECUTION: execution };
    if (name === '../lib/useFuturesAccount') return { useFuturesAccount: () => overrides.account ?? accountState(), refreshFuturesAccount: () => {} };
    if (name === '../lib/useAdminAlerts') return { useAdminAlertSound: () => {} };
    if (name === '../lib/useCopyMarketplace') return { prefetchCopyMarketplace: () => {} };
    if (name === '../lib/i18n') return { useLanguage: () => ({ t: (key: string) => key }) };
    if (name === '../lib/futuresMath') return futuresMath;
    if (name.endsWith('.css')) return {};
    if (name.startsWith('./') || name.startsWith('../components/')) {
      const label = name.split('/').pop()!;
      const component = components[label] ?? (components[label] = () => null);
      return { [label]: component };
    }
    return req(name);
  }, output, { setTimeout, clearTimeout, setInterval, clearInterval, confirm: jest.fn(() => true), document: { addEventListener() {}, removeEventListener() {} } });

  return {
    components,
    render(props: any = {}) {
      index = 0;
      const tree = output[Object.keys(output)[0]](props);
      effects.splice(0).forEach((fn) => fn());
      return tree;
    },
  };
}

function nodes(tree: any): any[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
}
const text = (tree: any) => JSON.stringify(tree);
const withClass = (tree: any, cls: string) =>
  nodes(tree).filter((n) => typeof n?.props?.className === 'string' && n.props.className.split(' ').includes(cls));

const summary = (over: Record<string, any> = {}) =>
  mount('components/FuturesAccountSummary.tsx', over).render({ quoteAsset: 'USDT', config: null });

const SUMMARY_SOURCE = source('components/FuturesAccountSummary.tsx');
const NAV_SOURCE = source('components/Nav.tsx');

// ── 1. The duplicated margin-mode row is gone ────────────────────────────

describe('1. the bottom account card no longer repeats the margin mode', () => {
  test('no margin-mode row is rendered, in either mode', () => {
    // Removed, not hidden: the row must not be in the tree at all, so there
    // is no transparent element still taking vertical space.
    expect(text(summary())).not.toContain('futures.marginType');
    expect(text(summary({ aggregate: aggregate() }))).not.toContain('futures.marginType');
    expect(SUMMARY_SOURCE).not.toContain("t('futures.marginType')");
  });

  test('the working switcher at the top of the panel still owns that label', () => {
    // The row was a duplicate of a CONTROL, and the control stays. This is
    // the assertion that catches deleting the wrong one.
    expect(source('components/FuturesMarginLeverage.tsx')).toContain("t('futures.marginType')");
  });

  test('marginType is still carried by the order the panel submits', () => {
    // Display-only change. The field never left the payload.
    expect(source('components/FuturesOrderForm.tsx')).toContain('marginType');
  });
});

// ── 2. Two metrics, one appearance each, short label + full tooltip ──────

describe('2. the two margin-usage rows', () => {
  test('each short label appears exactly once', () => {
    const rendered = text(summary({ aggregate: aggregate() }));
    expect(rendered.split('futures.initialMarginUsed').length - 1).toBe(1);
    expect(rendered.split('futures.maintenanceMarginUsed').length - 1).toBe(1);
  });

  test('the full name survives as the row tooltip', () => {
    const labels = withClass(summary({ aggregate: aggregate() }), 'fa-label');
    const titles = labels.map((n) => n.props.title).filter(Boolean);
    expect(titles).toContain('futures.initialMarginPct');
    expect(titles).toContain('futures.maintenanceMarginPct');
  });

  test('both bars are built from the same markup, so neither can drift', () => {
    const tracks = withClass(summary({ aggregate: aggregate() }), 'fa-track');
    expect(tracks).toHaveLength(2);
    // Width lives on the FILL. Nothing sets a per-row track width, which is
    // what would make one bar longer than the other.
    for (const track of tracks) expect(track.props.style).toBeUndefined();
  });
});

// ── 3. The percentages are the same numbers as before ────────────────────

describe('3. the figures the rows show', () => {
  test('a known small percentage is shown, not rounded to a tidy 0%', () => {
    // 0.4 initial margin against 1000 equity is 0.04%. The whole point of
    // the reference screenshot showing 0% is that it is someone ELSE's
    // account, not a target to round towards.
    const rendered = text(summary({ aggregate: aggregate({ initialMargin: '0.4' }) }));
    expect(rendered).toContain('0.04%');
  });

  test('a real zero is a zero', () => {
    const rendered = text(summary({ aggregate: aggregate({ initialMargin: '0', orderReserve: '0' }) }));
    expect(rendered).toContain('0.00%');
  });

  test('an unknown percentage is a dash, never 0%', () => {
    // Balances that failed to load: the account is not empty, it is unread.
    const rendered = text(summary({ account: accountState({ balances: resource(null, true), positions: resource(null, true) }) }));
    expect(rendered).toContain('—');
    expect(rendered).not.toContain('0.00%');
  });

  test('the percentage is not multiplied by 100 a second time', () => {
    // One `* 100`, in the one `pct` helper the card always used.
    expect(SUMMARY_SOURCE.split('* 100').length - 1).toBe(1);
    expect(SUMMARY_SOURCE).toContain('marginBalance > 0 ? (part / marginBalance) * 100 : 0');
  });

  test('no fixed percentage is written into the card', () => {
    expect(SUMMARY_SOURCE).not.toMatch(/['"`]0%['"`]/);
  });
});

// ── 4. Amounts read cleanly and completely ───────────────────────────────

describe('4. sums, units and the right axis', () => {
  const big = () => summary({ aggregate: aggregate({ equity: '56405024.03', available: '56381922.68' }) });

  test('a large balance is grouped, with every digit still present', () => {
    const rendered = text(big());
    expect(rendered).toContain('56 405 024.03');
    expect(rendered).toContain('56 381 922.68');
  });

  test('it is never abbreviated or truncated', () => {
    const rendered = big();
    expect(text(rendered)).not.toMatch(/56\.4\s*M/);
    expect(text(rendered)).not.toContain('…');
    expect(SUMMARY_SOURCE).not.toMatch(/toPrecision|1e6|e\+6|'M'/);
  });

  test('the currency is a separate, quieter element beside the amount', () => {
    // Its own node is what lets the unit step back typographically AND what
    // guarantees a real gap — the collision in the old card was a label and
    // a number sharing one text run.
    const units = withClass(big(), 'fa-unit');
    expect(units.length).toBeGreaterThanOrEqual(2);
    expect(units.every((n) => n.props.children === 'USDT')).toBe(true);
  });

  test('every row puts its value in the same kind of cell', () => {
    // One right axis: each row is label + value, and nothing renders a
    // value outside that cell.
    const rows = withClass(big(), 'futures-account-stat');
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const row of rows) {
      const children = nodes(row.props.children);
      expect(children.some((n: any) => n?.props?.className?.includes?.('fa-label'))).toBe(true);
      expect(children.some((n: any) => n?.props?.className?.includes?.('fa-value'))).toBe(true);
    }
  });

  test('hiding the balance hides the sums, not the layout', () => {
    const card = mount('components/FuturesAccountSummary.tsx', { aggregate: aggregate({ equity: '56405024.03' }) });
    card.render({ quoteAsset: 'USDT', config: null });
    const toggle = nodes(card.render({ quoteAsset: 'USDT', config: null })).find((n) => n.type === 'button' && n.props['aria-label']);
    toggle.props.onClick();
    const hidden = card.render({ quoteAsset: 'USDT', config: null });
    expect(text(hidden)).not.toContain('56 405 024.03');
    expect(withClass(hidden, 'futures-account-stat').length).toBeGreaterThanOrEqual(5);
  });
});

// ── 5. Technical prose became a mark next to the figure ──────────────────

describe('5. an incomplete valuation', () => {
  const partial = () => summary({ aggregate: aggregate({ collateralComplete: false, unpricedAssets: ['EUR'] }) });

  test('the warning is a compact indicator carrying a tooltip', () => {
    const flags = withClass(partial(), 'fa-flag');
    expect(flags).toHaveLength(1);
    expect(flags[0].props.title).toContain('futures.collateralIncomplete');
    expect(flags[0].props['aria-label']).toBe(flags[0].props.title);
  });

  test('it is not a paragraph of technical text in the panel body', () => {
    expect(withClass(partial(), 'futures-account-state')).toHaveLength(0);
  });

  test('a complete valuation shows no indicator at all', () => {
    expect(withClass(summary({ aggregate: aggregate() }), 'fa-flag')).toHaveLength(0);
  });

  test('the account is still told the total is a lower bound', () => {
    // The warning is quieter, NOT dropped: a total that silently omits an
    // asset reads exactly like a smaller account.
    expect(SUMMARY_SOURCE).toContain('!aggregate.collateralComplete');
    expect(SUMMARY_SOURCE).toContain('aggregate.unpricedAssets.join');
  });
});

// ── 6. The order form keeps every control, minus one repeated number ─────

describe('6. the order form above the card', () => {
  test('the slider no longer prints its own percentage over the track', () => {
    const css = readFileSync(resolve(frontend, 'src/pages/trade-terminal/ApprovedFuturesTerminal.css'), 'utf8');
    const rule = css.split('\n').find((line) => line.includes('.percent-slider-value {'))!;
    expect(rule).toContain('clip-path: inset(50%)');
    expect(rule).not.toContain('top: -13px');
  });

  test('the current value is still announced and still on the scale', () => {
    const slider = source('components/PercentSlider.tsx');
    expect(slider).toContain('aria-valuetext={`${safeValue}%`}');
    expect(slider).toContain('aria-pressed={safeValue === pct}');
    expect(slider).toContain('<output className="percent-slider-value">');
  });

  test('sizing behaviour is untouched', () => {
    expect(source('components/FuturesOrderForm.tsx')).toContain('applyPercent');
  });
});

// ── 7. The header: wallet moved, it did not multiply ─────────────────────

describe('7. the desktop header right block', () => {
  const nav = () => mount('components/Nav.tsx').render({ active: '/futures' });

  test('the wallet is a plain link in the right block, immediately before the deposit button', () => {
    const right = withClass(nav(), 'nav-desktop-right')[0];
    const children = nodes(right.props.children);
    const wallet = children.findIndex((n: any) => n?.props?.className?.includes?.('nav-wallet-link'));
    const deposit = children.findIndex((n: any) => n?.props?.className?.includes?.('deposit-button'));
    expect(wallet).toBeGreaterThanOrEqual(0);
    expect(deposit).toBe(wallet + 1);
  });

  test('language and profile come after the money pair', () => {
    const right = withClass(nav(), 'nav-desktop-right')[0];
    const children = nodes(right.props.children);
    const deposit = children.findIndex((n: any) => n?.props?.className?.includes?.('deposit-button'));
    const profile = children.findIndex((n: any) => n?.props?.className?.includes?.('top-nav-profile-wrap'));
    expect(profile).toBeGreaterThan(deposit);
  });

  test('the wallet link is not a second accent button', () => {
    const wallet = withClass(nav(), 'nav-wallet-link')[0];
    expect(wallet.props.className).toContain('nav-item');
    expect(wallet.props.className).not.toContain('deposit-button');
    expect(wallet.props.to).toBe('/wallet');
  });

  test('it keeps its active state on the wallet page', () => {
    const onWallet = mount('components/Nav.tsx').render({ active: '/wallet' });
    expect(withClass(onWallet, 'nav-wallet-link')[0].props.className).toContain('nav-active');
  });

  test('the old left-hand wallet section is gone, and there is exactly one on desktop', () => {
    const left = withClass(nav(), 'nav-desktop-links')[0];
    expect(nodes(left).filter((n: any) => n?.props?.to === '/wallet')).toHaveLength(0);
    expect(withClass(nav(), 'nav-wallet-link')).toHaveLength(1);
  });

  test('no dropdown was introduced in front of the wallet', () => {
    const wallet = withClass(nav(), 'nav-wallet-link')[0];
    expect(wallet.props['aria-haspopup']).toBeUndefined();
  });

  test('the deposit button lost its arrow and kept its action', () => {
    expect(NAV_SOURCE).not.toContain('ArrowUpRight');
    const deposit = withClass(nav(), 'top-nav-fund-btn')[0];
    expect(nodes(deposit).some((n: any) => n?.props?.children === 'wallet.deposit')).toBe(true);
    expect(typeof deposit.props.onClick).toBe('function');
    // Still the in-app modal, not a route change or a new window.
    expect(NAV_SOURCE).toContain('setShowDeposit(true)');
    expect(NAV_SOURCE).toContain('<DepositModal');
  });
});

// ── 8. Mobile kept everything it had ─────────────────────────────────────

describe('8. mobile access', () => {
  test('the wallet is still in the mobile menu', () => {
    const menu = nav_mobile();
    expect(nodes(menu).filter((n: any) => n?.props?.to === '/wallet').length).toBeGreaterThanOrEqual(1);
  });

  test('the mobile deposit button is still there', () => {
    expect(text(nav_mobile())).toContain('wallet.deposit');
  });

  test('the bottom mobile navigation was not rebuilt', () => {
    expect(NAV_SOURCE).toContain('<BottomNav/>');
    expect(source('components/BottomNav.tsx')).toContain('/wallet');
  });

  function nav_mobile() {
    const tree = mount('components/Nav.tsx').render({ active: '/futures' });
    return nodes(tree).find((n: any) => typeof n?.props?.className === 'string' && n.props.className.startsWith('nav-mobile-menu'));
  }
});

// ── 9. One CTA label, and only for the CTA ───────────────────────────────

describe('9. the deposit label', () => {
  const ru = source('lib/i18n/locales/ru.ts');

  test('the Russian call to action reads Депозит', () => {
    expect(ru).toContain("'wallet.deposit': 'Депозит',");
  });

  test('history and status wording is untouched', () => {
    // A blind replace would have renamed the LEDGER, which is a different
    // word for a different thing.
    expect(ru).toContain("'wallet.txDeposit': 'Пополнение',");
    expect(ru).toContain("'wallet.txDeposits': 'Пополнения',");
    expect(ru).toContain("'deposit.title': 'Пополнение',");
  });

  test('the same action reads the same on the header, the Wallet and the panel', () => {
    expect(source('components/Nav.tsx')).toContain("t('wallet.deposit')");
    expect(source('pages/wallet-v3/FundingView.tsx')).toContain("t('wallet.deposit')");
    expect(ru).toContain("'futures.depositAction': 'Депозит',");
  });

  test('every locale still answers for the new short margin labels', () => {
    for (const locale of ['en', 'ru', 'es', 'zh', 'ja', 'ko', 'hi']) {
      const dict = source(`lib/i18n/locales/${locale}.ts`);
      expect(`${locale}: ${dict.includes("'futures.initialMarginUsed':")}`).toBe(`${locale}: true`);
      expect(`${locale}: ${dict.includes("'futures.maintenanceMarginUsed':")}`).toBe(`${locale}: true`);
    }
  });
});
