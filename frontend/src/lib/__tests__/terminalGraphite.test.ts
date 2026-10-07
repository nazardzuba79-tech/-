import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * THE GRAPHITE FINISH ON THE LIVE FUTURES TERMINAL (owner, 2026-09-30).
 *
 * Chart settings with green / red candles by default, the calmer order form
 * and margin selects, IBM Plex Sans, a quieter order book, no «+» beside
 * «Доступно», and — in its own sheet — the panels as tiles. What is pinned
 * here: the viewer's chart preferences are validated and kept per browser,
 * the terminal is wired to them, and the presentation sheets say what the
 * owner asked for and nothing about data or orders.
 */

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: () => null,
  get length() { return store.size; },
} as Storage;

import {
  CHART_PRESETS, CHART_SETTINGS_KEY, DEFAULT_CHART_SETTINGS, getChartSettings, getSavedChartSettings, normalizeChartSettings,
  previewChartSettings, resetChartSettingsCache, revertChartSettings, rgbaOf, saveChartSettings, subscribeChartSettings, withPreset,
} from '../chartSettings';

const root = resolve(__dirname, '../../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');

beforeEach(() => { store.clear(); resetChartSettingsCache(); });

describe('chart settings', () => {
  it('defaults to the standard green / red, the book\'s own buy and sell', () => {
    expect(CHART_PRESETS.standard).toEqual(['#2ebd85', '#f6465d']);
    expect(CHART_PRESETS.classic).toEqual(['#ffffff', '#ff9800']);
    expect(DEFAULT_CHART_SETTINGS).toMatchObject({ preset: 'standard', bodyUp: '#2ebd85', bodyDown: '#f6465d', background: null, grid: 'none', volume: true, lastPriceLine: true });
    expect(getChartSettings()).toEqual(DEFAULT_CHART_SETTINGS);
  });

  it('checks every stored field and falls back where one is bad', () => {
    const s = normalizeChartSettings({ bodyUp: 'red', bodyDown: '#ABCDEF', grid: 'diagonal', preset: 'neon', background: 'url(x)', volume: 'yes', body: false, border: false });
    expect(s.bodyUp).toBe(DEFAULT_CHART_SETTINGS.bodyUp);
    expect(s.bodyDown).toBe('#abcdef');
    expect(s.grid).toBe('none');
    expect(s.preset).toBe('standard');
    expect(s.background).toBeNull();
    expect(s.volume).toBe(true);
    // A candle with neither a body nor an outline would vanish.
    expect(s.body).toBe(true);
    expect(normalizeChartSettings('{"broken"')).toEqual(DEFAULT_CHART_SETTINGS);
  });

  it('paints a preset on body, border and wick alike', () => {
    const s = withPreset(DEFAULT_CHART_SETTINGS, 'classic');
    expect([s.bodyUp, s.borderUp, s.wickUp]).toEqual(['#ffffff', '#ffffff', '#ffffff']);
    expect([s.bodyDown, s.borderDown, s.wickDown]).toEqual(['#ff9800', '#ff9800', '#ff9800']);
  });

  it('previews a draft, puts back what is kept on cancel, and keeps it in this browser on Ok', () => {
    const seen: string[] = [];
    const off = subscribeChartSettings(s => seen.push(s.preset));
    previewChartSettings(withPreset(getSavedChartSettings(), 'asia'));
    expect(getChartSettings().preset).toBe('asia');
    expect(store.has(CHART_SETTINGS_KEY)).toBe(false);
    revertChartSettings();
    expect(getChartSettings().preset).toBe('standard');
    saveChartSettings(withPreset(getSavedChartSettings(), 'classic'));
    expect(JSON.parse(store.get(CHART_SETTINGS_KEY)!).preset).toBe('classic');
    resetChartSettingsCache();
    expect(getChartSettings().preset).toBe('classic');
    off();
    expect(seen).toEqual(['asia', 'standard', 'classic']);
  });

  it('draws volume in the candle colours', () => {
    expect(rgbaOf('#2ebd85', 0.35)).toBe('rgba(46,189,133,0.35)');
  });

  it('is wired into the futures chart only, with its gear and dialog', () => {
    const page = read('frontend/src/pages/FuturesPage.tsx');
    expect(page).toContain('positionLines={chartPositionLines} chartSettings foldHeading={archivePreview && desktopMarkets} />');
    const chart = read('frontend/src/components/PriceChart.tsx');
    expect(chart).toContain("aria-label={t('chart.settings.open')}");
    expect(chart).toContain('{settingsOpen && <ChartSettingsDialog onClose={() => setSettingsOpen(false)} />}');
    expect(chart).toContain("fontFamily: token('--voltex-chart-font', 'Inter, Arial, sans-serif')");
    // Volume in its own strip under the candles, as Binance draws it (owner, 2026-09-30).
    expect(chart).toContain('const volumePane = s.volume ? 1 : 0;');
    expect(chart).toContain('if (volume.getPane().paneIndex() !== volumePane) volume.moveToPane(volumePane);');
    expect(chart).toContain('panes[1]?.setStretchFactor(0.2);');
    for (const other of ['frontend/src/pages/TradePage.tsx', 'frontend/src/pages/CfdPage.tsx']) {
      if (existsSync(resolve(root, other))) expect(read(other)).not.toContain('chartSettings');
    }
    const dialog = read('frontend/src/components/ChartSettingsDialog.tsx');
    expect(dialog).toContain('role="dialog" aria-modal="true"');
    expect(dialog).toContain("if (e.key === 'Escape')");
  });

  it('has every dialog string in all seven languages', () => {
    const keys = [...read('frontend/src/components/ChartSettingsDialog.tsx').matchAll(/t\('(chart\.settings\.[\w.]+)'\)/g)].map(m => m[1]);
    expect(keys.length).toBeGreaterThan(20);
    for (const locale of ['ru', 'en', 'zh', 'es', 'hi', 'ja', 'ko']) {
      const dict = read(`frontend/src/lib/i18n/locales/${locale}.ts`);
      for (const key of new Set(keys)) expect(dict).toContain(`'${key}':`);
    }
  });
});

describe('the Graphite sheet', () => {
  const css = read('frontend/src/pages/trade-terminal/TerminalGraphite.css');
  const page = read('frontend/src/pages/FuturesPage.tsx');

  it('loads after every other terminal sheet', () => {
    const order = [...page.matchAll(/import '\.\/trade-terminal\/(\w+)\.css';/g)].map(m => m[1]);
    expect(order.indexOf('TerminalGraphite')).toBe(order.indexOf('FuturesOrderPanelRefinement') + 1);
  });

  it('sets the terminal in the self-hosted IBM Plex Sans, figures included', () => {
    expect(css).toContain("--font-family:'IBM Plex Sans Terminal','Inter Terminal',Inter,system-ui,sans-serif;");
    expect(css).toContain('#archive-terminal-preview .terminal :is(.mono,.chart-tab,.chart-tool-btn,.voltex-plot-title) { font-family:var(--font-family); font-variant-numeric:tabular-nums; }');
    const fonts = read('frontend/src/pages/trade-terminal/TerminalFonts.css');
    const urls = [...fonts.matchAll(/url\((\/fonts\/ibm-plex-sans\/[\w-]+\.woff2)\)/g)].map(m => m[1]);
    expect(urls).toHaveLength(16);
    for (const url of urls) expect(existsSync(resolve(root, 'frontend/public' + url))).toBe(true);
    expect(read('frontend/public/fonts/ibm-plex-sans/OFL.txt')).toContain('SIL Open Font License');
  });

  // Owner, 2026-09-30, with a Bybit screenshot: «зроби ці форми по
  // контрасності і формі в точності як на байбіт». Values read off it.
  it('draws the margin and leverage selects as Bybit does: filled, no outline, 38px, 4px corner', () => {
    expect(css).toContain('#archive-terminal-preview .fo-mlTrigger { height:38px; min-height:38px; padding:0 10px 0 12px; border-radius:4px; font-size:14px; font-weight:600; color:#ffffff; }');
    expect(css).toMatch(/:is\(\.fo-mlTrigger, \.fo-priceInputRow, \.fo-qtyInputRow[^)]*\) \{\n\s+background:#232227 !important; border:1px solid transparent !important;/);
    // Leverage in the accent (Bybit's orange there), red past the warning threshold.
    expect(css).toContain('#archive-terminal-preview .fo-mlTrigger .fo-mlTriggerLev { color:var(--accent); font-size:14px; font-weight:500; }');
    expect(css).toContain('#archive-terminal-preview .fo-mlTrigger .fo-mlTriggerLev.fo-mlHigh { color:#f6465d; }');
  });

  it('gives price and quantity Bybit\'s 48px field with a floating label', () => {
    expect(css).toContain('#archive-terminal-preview .fo-field { --fo-field-height:48px; }');
    expect(css).toContain('#archive-terminal-preview .fo-field .fo-fieldRow { border-radius:6px; min-height:var(--fo-field-height); }');
    // Empty: the caption stands in the middle as the placeholder, and the numeric placeholder is not painted.
    expect(css).toMatch(/\.fo-field:has\(\.fo-input:placeholder-shown\):not\(:focus-within\) > \.fo-fieldCaption \{\n\s+top:calc\(var\(--fo-field-height\) \/ 2\); transform:translateY\(-50%\); font-size:14px;/);
    expect(css).toContain('#archive-terminal-preview .fo-field .fo-input::placeholder { color:transparent; -webkit-text-fill-color:transparent; opacity:0; }');
    // Filled: the figure white 16px at the left; «Последняя» in the accent.
    expect(css).toMatch(/\.fo-field :is\(\.fo-input,\.fo-markPrice\) \{\n\s+padding:21px 0 5px 13px; text-align:left;\n\s+font-size:16px; line-height:20px; font-weight:600; color:#ffffff;/);
    expect(css).toContain('.fo-fieldTrailing .fo-lastPriceBtn { font-size:14px; font-weight:600; color:var(--accent);');
  });

  it('compacts desktop controls without reducing numeric text or mobile touch targets', () => {
    const desktop = /@media \(min-width:901px\) \{\s*(#archive-terminal-preview \.fo-mlRow[\s\S]*?)\n\}/.exec(css)?.[1];
    expect(desktop).toBeDefined();
    expect(desktop).toContain('grid-template-columns:minmax(0,1.35fr) minmax(0,1fr)');
    expect(desktop).toContain('.fo-mlTrigger { height:36px; min-height:36px;');
    expect(desktop).toContain('.fo-field { --fo-field-height:46px; }');
    expect(desktop).not.toMatch(/\.fo-field :is\(\.fo-input,\.fo-markPrice\) \{[^}]*font-size:/);
    expect(css).toContain('font-size:16px; line-height:20px; font-weight:600; color:#ffffff;');
    expect(css).toMatch(/@media \(max-width:900px\), \(pointer:coarse\) \{\s*#archive-terminal-preview \.fo-mlTrigger \{ min-height:44px; \}/);
    expect(css).toContain('.fo-mlTrigger[aria-expanded="true"] { border-color:var(--accent) !important; }');
    expect(css).toContain(':has(.fo-input[aria-invalid="true"]) { border-color:var(--sell, #f6465d) !important; }');
  });

  it('leaves the TP / SL «+» exactly as the exchange has it', () => {
    expect(css).not.toMatch(/fo-tpsl/);
  });

  it('quiets the order book: both sides\' bars at .12', () => {
    expect(css).toContain('#archive-terminal-preview .rb-row.bid .rb-depth { background:rgba(46,189,133,.12); }');
    expect(css).toContain('#archive-terminal-preview .rb-row.ask .rb-depth { background:rgba(246,70,93,.12); }');
  });

  it('keeps the positions panel to two whole rows on desktop so the chart and book take the rest', () => {
    expect(css).toContain('#archive-terminal-preview .terminal:not([data-account-compact=true]) { grid-template-rows:var(--futures-ticker-height) minmax(280px,1fr) 220px; }');
  });

  it('draws P&L, ROI and «≈… USD» as Bybit does: one size, one weight, one colour, nothing dimmed', () => {
    expect(css).toMatch(/\.futures-unrealized :is\(\.futures-position-money,\.futures-unrealized-unit,\.futures-position-roi,\.futures-position-approx\),\n#archive-terminal-preview \.bottom-panel \.futures-position-pnl :is\(\.futures-position-realized,\.futures-position-approx\) \{\n\s+font-size:13px; font-weight:500; line-height:17px; opacity:1; color:inherit;/);
  });

  it('leaves «Доступно» without its «+»', () => {
    const form = read('frontend/src/components/FuturesOrderForm.tsx');
    expect(form).not.toContain('fo-availTransfer');
    expect(form).not.toContain('onTransfer');
    expect(page).not.toContain('onTransfer=');
  });

  it('touches presentation only', () => {
    expect(css).not.toMatch(/content:\s*'[^']+'/);
    expect(css).not.toMatch(/display:\s*none/);
  });
});
