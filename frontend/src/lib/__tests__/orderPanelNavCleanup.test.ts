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
    // The gap is a CHARACTER, not only a flex gap: a non-breaking space, so
    // a copied balance reads `56 405 024.03 USDT` rather than one run, and
    // the unit can never be left behind on a line of its own.
    for (const unit of units) {
      expect(Array.isArray(unit.props.children)).toBe(true);
      expect(unit.props.children[0]).toBe('\u00A0');
      expect(unit.props.children[1]).toBe('USDT');
    }
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
    expect(flags[0].props.title).toContain('futures.collateralPartial');
    expect(flags[0].props['aria-label']).toBe(flags[0].props.title);
  });

  test('it is not a paragraph of technical text in the panel body', () => {
    expect(withClass(partial(), 'futures-account-state')).toHaveLength(0);
  });

  test('a complete valuation shows no indicator at all', () => {
    expect(withClass(summary({ aggregate: aggregate() }), 'fa-flag')).toHaveLength(0);
  });

  test('the account is still told the total is incomplete', () => {
    // The warning is quieter, NOT dropped: a total that silently omits an
    // asset reads exactly like a smaller account. `unpricedAssets` decides
    // whether it appears, so it cannot be shown without one and cannot be
    // suppressed while one exists.
    expect(SUMMARY_SOURCE).toContain('!aggregate.collateralComplete');
    expect(SUMMARY_SOURCE).toContain('aggregate.unpricedAssets.length > 0');
  });

  test('the tooltip names no assets and does not call the total a lower bound', () => {
    // v4: the old sentence must not simply move into the tooltip. It carried
    // an asset code and the phrase "нижняя граница", which is provider
    // detail; the ticket says the plain fact instead.
    const ru = source('lib/i18n/locales/ru.ts');
    expect(ru).toContain("'futures.collateralPartial': 'Часть активов не учтена в сумме: оценка временно недоступна.',");
    expect(SUMMARY_SOURCE).not.toContain('{ assets:');
    // And the Wallet page, which this brief does not touch, keeps its own
    // longer note verbatim.
    expect(ru).toContain("'futures.collateralIncomplete': 'Нет цены для {assets}. Баланс показан как нижняя граница.',");
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

  test('the right-block wallet link steps aside below the header breakpoint', () => {
    // Found by looking at the real build at 390: the wallet link in the
    // right cluster pushed it left until it sat ON the VOLTEX wordmark, a
    // measured 24px overlap on /futures and exactly 0 clearance on
    // /markets. Below 860 the product sections are already in the drawer,
    // and so is the wallet, so the header link goes with them.
    const css = readFileSync(resolve(frontend, 'src/index.css'), 'utf8');
    const block = /@media \(max-width: 860px\) \{\s*\.global-header \.header-actions > \.nav-wallet-link \{\s*display: none;/;
    expect(css).toMatch(block);
    // And ONLY there. The unconditional rule that styles the desktop link
    // must still be present and must not hide it — the desktop link is the
    // whole point of the header change.
    const desktopRule = /\n\.global-header \.header-actions > \.nav-wallet-link \{([^}]*)\}/.exec(css);
    expect(desktopRule).not.toBeNull();
    expect(desktopRule![1]).not.toMatch(/display:\s*none/);
    expect(desktopRule![1]).toMatch(/padding/);
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

// ── 10. v4: the ticket reads as controls on a dark panel ─────────────────

/**
 * These pin the OUTCOME of the v4 pass, not its taste. Each one is a number
 * that was measured in a browser on the real build and would change silently
 * if a later edit undid the pass: the panel/control separation, the pill, the
 * column width, the split between the two selects, and the disabled style
 * that used to hide its own label.
 */
describe('10. the v4 order ticket', () => {
  const PANEL_CSS = readFileSync(resolve(frontend, 'src/pages/trade-terminal/TerminalAccountPanel.css'), 'utf8');
  const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const luminance = (c: number[]) => {
    const f = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : (((v / 255) + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const contrast = (a: number[], b: number[]) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const token = (name: string) => {
    const m = new RegExp(`--${name}:(#[0-9a-f]{6});`).exec(PANEL_CSS);
    if (!m) throw new Error(`token --${name} is gone`);
    return m[1];
  };

  test('the panel is darker than its controls by more than the old 1.15', () => {
    // The owner's complaint measured: our panel sat 1.15 from the control
    // fill where the reference sat 1.20, so every layer shared one band.
    const surface = hex(token('fo-surface'));
    const control = hex(token('fo-control'));
    expect(luminance(surface)).toBeLessThan(luminance(control));
    expect(contrast(surface, control)).toBeGreaterThan(1.2);
    // Still VOLTEX: the blue channel stays clearly above the red one, so
    // this is a darker navy and not a transplanted neutral graphite.
    expect(surface[2] - surface[0]).toBeGreaterThanOrEqual(8);
    expect(control[2] - control[0]).toBeGreaterThanOrEqual(8);
  });

  test('primary values are clean white and labels are not', () => {
    expect(token('fo-text')).toBe('#ffffff');
    expect(luminance(hex(token('fo-text-2')))).toBeLessThan(luminance(hex(token('fo-text'))));
    expect(luminance(hex(token('fo-text-3')))).toBeLessThan(luminance(hex(token('fo-text-2'))));
    // A label must still be comfortably readable on the control fill.
    expect(contrast(hex(token('fo-text-2')), hex(token('fo-control')))).toBeGreaterThan(4.5);
  });

  test('the border became a hairline instead of an outline', () => {
    // The old #304050 read as a drawn box around every field. The hairline
    // sits within a few steps of the fill, so the FILL draws the shape.
    expect(contrast(hex(token('fo-hairline')), hex(token('fo-control')))).toBeLessThan(1.15);
  });

  test('the order column is wider and the chart absorbs it', () => {
    // Measured from the owner's two same-scale references: the marked
    // control row there is ~1.18x ours. 278 -> 312 is +12.2%.
    expect(PANEL_CSS).toContain('grid-template-columns:212px minmax(0,1fr) 250px 312px;');
    // The pair list and the depth column keep their exact widths — the
    // flexible track is the one that gives.
    expect(PANEL_CSS).not.toMatch(/grid-template-columns:212px minmax\(0,1fr\) 2[0-4]\d px? 312px/);
  });

  test('the leverage select is no longer the squeezed one', () => {
    // 1.18/1 is the reference's own split (171px : 145px in its frame).
    // Ours was 1.55/1, which is what made the right control look cramped.
    expect(PANEL_CSS).toContain('grid-template-columns:minmax(0,1.18fr) minmax(0,1fr);');
  });

  test('the submit pair is a capsule, stated as one', () => {
    expect(PANEL_CSS).toMatch(/\.fo-submitPair \.submit-btn \{[^}]*border-radius:999px;/);
    expect(PANEL_CSS).toMatch(/\.fo-submitPair \.submit-btn \{[^}]*height:44px;/);
  });

  test('enabled trading colours are untouched by the restyle', () => {
    // The owner's frame shows dim buttons because its quantity field is
    // EMPTY. Chasing that with a brighter enabled fill would be styling a
    // disabled state. These are the same two values as before the pass.
    expect(PANEL_CSS).toContain('.submit-btn.buy { background:#00b879; }');
    expect(PANEL_CSS).toContain('.submit-btn.sell { background:#f33451; }');
  });

  test('disabled is its own style, and its label can still be read', () => {
    // `opacity:.45` on the whole button took the label down with the fill.
    expect(PANEL_CSS).toMatch(/\.submit-btn:disabled \{\s*opacity:1;/);
    const buyDisabled = /\.submit-btn\.buy:disabled \{\s*background:(#[0-9a-f]{6});\s*color:(#[0-9a-f]{6});/.exec(PANEL_CSS);
    const sellDisabled = /\.submit-btn\.sell:disabled \{\s*background:(#[0-9a-f]{6});\s*color:(#[0-9a-f]{6});/.exec(PANEL_CSS);
    expect(buyDisabled).not.toBeNull();
    expect(sellDisabled).not.toBeNull();
    for (const m of [buyDisabled!, sellDisabled!]) {
      // Obviously inactive: the fill is far quieter than the enabled one.
      expect(luminance(hex(m[1]))).toBeLessThan(luminance(hex('#00b879')));
      // But still a readable label, which is the whole point.
      expect(contrast(hex(m[2]), hex(m[1]))).toBeGreaterThan(3);
    }
  });

  test('no glow, and focus never moves anything', () => {
    // The ticket gets contrast from tone, not from halos.
    expect(PANEL_CSS).not.toMatch(/\.submit-btn[^{]*\{[^}]*box-shadow:0 0 \d+px/);
    // Hover changes colour only; a size change on hover is what made the
    // panel feel jumpy.
    const hover = /:is\(\.fo-mlTrigger:hover,\.fo-priceInputRow:hover,\.fo-qtyInputRow:hover\) \{([^}]*)\}/.exec(PANEL_CSS);
    expect(hover).not.toBeNull();
    expect(hover![1]).not.toMatch(/height|padding|border-width|font-size/);
  });

  test('one focus ring per field, not two', () => {
    // The row shows focus; the input inside also drew its own outline, and
    // the row clips its children, so all that survived was a stray vertical
    // line between the number and its unit.
    expect(PANEL_CSS).toMatch(/\.fo-input:focus[\s\S]{0,120}outline:none;/);
  });
});

// ── 11. v4 wording: it opens, it closes, it never lies about which ───────

describe('11. the v4 button and metric wording', () => {
  const ru = source('lib/i18n/locales/ru.ts');
  const form = source('components/FuturesOrderForm.tsx');

  test('the submit pair says what it does, in Cyrillic', () => {
    expect(ru).toContain("'futures.buyLong': 'Открыть Лонг',");
    expect(ru).toContain("'futures.sellShort': 'Открыть Шорт',");
    // Not the reference frame's stray English "Short".
    expect(ru).not.toContain("'futures.sellShort': 'Открыть Short',");
  });

  test('reduce-only stops promising it opens anything', () => {
    expect(ru).toContain("'futures.closeShort': 'Закрыть Шорт',");
    expect(ru).toContain("'futures.closeLong': 'Закрыть Лонг',");
    expect(form).toContain("t(reduceOnly ? 'futures.closeShort' : 'futures.buyLong')");
    expect(form).toContain("t(reduceOnly ? 'futures.closeLong' : 'futures.sellShort')");
  });

  test('only the WORDING changes — the order does not', () => {
    // A reduce-only BUY still closes a short. The side, the flag and the
    // submitted command are exactly what they were.
    expect(form).toContain("onClick={() => place('BUY')}");
    expect(form).toContain("onClick={() => place('SELL')}");
    expect(form).toContain('reduceOnly,');
    // And the guard is still the guard.
    expect(form).toContain('const canSubmit = Boolean(config)');
    expect(form).toContain('&& !marginShortfall');
    expect(form).toContain('&& !contractBreach');
    expect(form).toContain('if (!canSubmit) return;');
  });

  test('the margin balance label is shorter, the metric is the same', () => {
    expect(ru).toContain("'futures.marginBalance': 'Баланс маржи',");
    // Same key, same figure, same source — this is a label, not a metric swap.
    expect(SUMMARY_SOURCE).toContain("t('futures.marginBalance')");
    expect(SUMMARY_SOURCE).toContain('Number(aggregate.equity)');
  });

  test('every locale answers for the new keys', () => {
    for (const locale of ['en', 'ru', 'es', 'zh', 'ja', 'ko', 'hi']) {
      const dict = source(`lib/i18n/locales/${locale}.ts`);
      for (const key of ['futures.closeShort', 'futures.closeLong', 'futures.collateralPartial']) {
        expect(`${locale}/${key}: ${dict.includes(`'${key}':`)}`).toBe(`${locale}/${key}: true`);
      }
    }
  });
});
