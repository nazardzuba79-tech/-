import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { futuresSwitchHref, resolveSwitchedPair, spotSwitchHref, switchedFrom, FUTURES_CORE_PAIRS } from '../terminalMarketSwitch';
import { onDepositRequest, requestDeposit } from '../depositRequest';

/* Mobile Spot / Futures / deposit (owner reference, 2026-10-04). */
const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const read = (path: string) => readFileSync(resolve(frontend, 'src', path), 'utf8').replace(/\r\n/g, '\n');
const compile = (text: string) => ts.transpileModule(text, { compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
}}).outputText;
function load(path: string, mocks: Record<string, unknown>) {
  const module = { exports: {} as any };
  new Function('module', 'exports', 'require', compile(read(path)))(module, module.exports,
    (name: string) => name in mocks ? mocks[name] : req(name));
  return module.exports;
}
const i18nStub = { useLanguage: () => ({ t: (key: string, vars?: Record<string, string>) => vars ? `${key}:${JSON.stringify(vars)}` : key }) };

describe('«Спот / Фьючерсы» targets', () => {
  it('passes a pair the other market lists and only names an unknown one', () => {
    expect(futuresSwitchHref('ETH/USDT', ['BTC/USDT', 'ETH/USDT'])).toBe('/futures?pair=ETH%2FUSDT');
    expect(futuresSwitchHref('PEPE/USDT', ['BTC/USDT', 'ETH/USDT'])).toBe('/futures?from=PEPE%2FUSDT');
    // No catalogue in memory: only the core contracts are assumed to exist.
    for (const pair of FUTURES_CORE_PAIRS) expect(futuresSwitchHref(pair, null)).toBe(`/futures?pair=${encodeURIComponent(pair)}`);
    expect(futuresSwitchHref('DOGE/USDT', null)).toBe('/futures?from=DOGE%2FUSDT');
    expect(spotSwitchHref('BTC/USDT', null)).toBe('/trade?pair=BTC%2FUSDT');
    expect(spotSwitchHref('BTC/USDT', new Set(['BTC/USDT']))).toBe('/trade?pair=BTC%2FUSDT');
    expect(spotSwitchHref('XYZ/USDT', new Set(['BTC/USDT']))).toBe('/trade?from=XYZ%2FUSDT');
  });

  it('never builds a link from a malformed name', () => {
    expect(futuresSwitchHref('<script>', null)).toBe('/futures');
    expect(spotSwitchHref('btc usdt', null)).toBe('/trade');
    expect(switchedFrom('BTC/USDT')).toBe('BTC/USDT');
    expect(switchedFrom('javascript:alert(1)')).toBeNull();
    expect(switchedFrom('')).toBeNull();
    expect(switchedFrom(null)).toBeNull();
  });

  it('waits for the catalogue, then selects or opens the picker', () => {
    expect(resolveSwitchedPair('PEPE/USDT', null, false)).toBe('wait');
    expect(resolveSwitchedPair('PEPE/USDT', new Set(['BTC/USDT']), false)).toBe('wait');
    expect(resolveSwitchedPair('PEPE/USDT', new Set(['BTC/USDT']), true)).toBe('choose');
    expect(resolveSwitchedPair('BTC/USDT', new Set(['BTC/USDT']), false)).toBe('select');
  });

  it('renders two links-worth of choices: the current market as text, the other as one link', () => {
    const { StaticRouter } = req('react-router-dom');
    const { TerminalMarketSwitch } = load('components/TerminalMarketSwitch.tsx', {
      '../lib/i18n': i18nStub,
      '../lib/marketDataStore': { marketDataStore: { getState: () => ({ tickersMeta: {}, tickers: new Map([['BTC/USDT', {}]]) }) } },
      '../lib/terminalWarmCache': { readFuturesSymbolCache: () => ['BTC/USDT'] },
      '../lib/terminalMarketSwitch': { futuresSwitchHref, spotSwitchHref },
    });
    const html = (current: 'spot' | 'futures', pair: string) => renderToStaticMarkup(React.createElement(StaticRouter, { location: '/' },
      React.createElement(TerminalMarketSwitch, { current, pair })));
    const spot = html('spot', 'PEPE/USDT');
    expect(spot).toContain('aria-current="page"');
    expect(spot.match(/<a /g)).toHaveLength(1);
    expect(spot).toContain('href="/futures?from=PEPE%2FUSDT"');
    expect(html('futures', 'BTC/USDT')).toContain('href="/trade?pair=BTC%2FUSDT"');
    expect(html('futures', 'ETH/USDT')).toContain('href="/trade?from=ETH%2FUSDT"');
  });
});

describe('one deposit dialog per page', () => {
  it('tells the caller to fall back when no header dialog is mounted', () => {
    expect(requestDeposit({ asset: 'USDT' })).toBe(false);
  });

  it('hands the request to the mounted owner and stops after unsubscribe', () => {
    const seen: unknown[] = [];
    const off = onDepositRequest(request => seen.push(request));
    expect(requestDeposit({ asset: 'USDT' })).toBe(true);
    expect(seen).toEqual([{ asset: 'USDT' }]);
    off();
    expect(requestDeposit()).toBe(false);
    expect(seen).toHaveLength(1);
  });

  it('wires the header as the owner and the Futures account button as a requester', () => {
    const nav = read('components/Nav.tsx');
    expect(nav).toContain("useEffect(()=>onDepositRequest(request=>{setMobileOpen(false);setDeposit(request);}),[]);");
    expect(nav).toContain("data-terminal-header={terminalSwitch?'true':undefined}");
    expect(nav).toContain("tone={terminalCopy?'terminal':'light'}");
    const summary = read('components/FuturesAccountSummary.tsx');
    expect(summary).toContain("if (!requestDeposit({ asset: quoteAsset })) navigate('/wallet?action=deposit');");
  });

  it('keeps the existing dialog: address first, QR only on press, copy rules untouched', () => {
    const dialog = read('components/DepositCatalogueDialog.tsx');
    expect(dialog).toContain("useState<Step>('address')");
    expect(dialog).toContain("wallet?.address && step === 'qr' ? QRCode.create(");
    expect(dialog).toContain('aria-expanded={step === \'qr\'}');
    expect(dialog).toContain('data-tone={tone}');
    expect(dialog).toContain("t('deposit.ui.memoRequired')");
    expect(dialog).toContain('reportDepositAddressCopy');
    const css = read('components/DepositCatalogueDialog.css');
    expect(css).toMatch(/\.dc-qr\s*\{[^}]*width:\s*168px/);
    expect(css).toContain('.dc-overlay[data-tone=terminal]');
  });
});

describe('phone order-type selector', () => {
  const { OrderFamilyTabs } = load('components/OrderFamilyPresentation.tsx', { '../lib/i18n': i18nStub });
  const render = (props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(OrderFamilyTabs, { value: 'LIMIT', onChange: () => {}, ...props }));

  it('is ONE select with the same families as the tabs', () => {
    const tabs = render({});
    const select = render({ compact: true });
    const tabValues = [...tabs.matchAll(/role="tab"[^>]*>([^<]+)</g)].map(match => match[1]);
    const optionValues = [...select.matchAll(/<option value="([A-Z_]+)"[^>]*>([^<]+)</g)].map(match => match[2]);
    expect(select.match(/<select/g)).toHaveLength(1);
    expect(select).not.toContain('role="tab"');
    expect(optionValues).toEqual(tabValues);
    expect(optionValues).toHaveLength(5);
  });

  it('keeps the archive set (no OCO) in the select', () => {
    const select = render({ compact: true, archive: true });
    expect(select).not.toContain('value="OCO"');
    expect(select.match(/<option/g)).toHaveLength(4);
  });
});

describe('phone workspace structure', () => {
  const futures = read('pages/FuturesPage.tsx');
  const trade = read('pages/TradePage.tsx');

  it('mounts one ticket and one book on each terminal', () => {
    expect(futures.match(/<FuturesOrderForm\b/g)).toHaveLength(1);
    expect(futures.match(/<FuturesReferenceBook\b/g)).toHaveLength(1);
    expect(trade.match(/<OrderForm\b/g)).toHaveLength(1);
    expect(trade.match(/\{spotOrderForm\}/g)).toHaveLength(1);
    expect(trade.match(/<OrderBookPanel\b/g)).toHaveLength(1);
  });

  it('shows contract facts in exactly one place per width', () => {
    expect(futures).toContain('{archivePreview && !compact && <FuturesContractDetails symbol={symbol} />}');
    expect(futures).toContain('{compact && <div className="futures-mobile-extras">');
  });

  it('opens the Trade tab first, keeping the chart first for prelisting, display-only and CFD', () => {
    expect(trade).toContain("const mobileTab = mobileTabChoice ?? (marketType === 'cfd' || prelisting || displayOnly ? 'chart' : 'trade');");
  });
});

describe('phone stylesheets stay below 900px', () => {
  const topLevel = (css: string) => {
    const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const blocks: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === '{') { if (depth === 0) blocks.push(text.slice(start, i).trim()); depth += 1; }
      else if (text[i] === '}') { depth -= 1; if (depth === 0) start = i + 1; }
    }
    return blocks;
  };
  const phoneOnly = (prelude: string) => /^@media \(max-width:\s*(\d+)px\)$/.test(prelude) && Number(prelude.match(/(\d+)px/)![1]) <= 900;

  it.each(['pages/trade-terminal/FuturesMobileCompact.css', 'pages/trade-terminal/SpotMobileCompact.css'])('%s', path => {
    const blocks = topLevel(read(path));
    expect(blocks.length).toBeGreaterThan(0);
    for (const prelude of blocks) expect(phoneOnly(prelude)).toBe(true);
  });

  it('TerminalMobileHeader.css only hides its own phone controls outside the media queries', () => {
    const blocks = topLevel(read('pages/trade-terminal/TerminalMobileHeader.css'));
    expect(blocks[0]).toBe('.nav-terminal-switch,\n.spot-mobile-stats-toggle');
    for (const prelude of blocks.slice(1)) expect(phoneOnly(prelude)).toBe(true);
  });
});
