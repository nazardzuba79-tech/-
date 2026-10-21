/**
 * The Futures chart / account divider: the height the trader sets is kept,
 * clamped and applied through the grid's own variable; the tables and every
 * trading action are untouched. Pure helpers and the wiring, read from source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FUTURES_ACCOUNT_PANEL_KEY, FUTURES_ACCOUNT_PANEL_MIN, FUTURES_CHART_FLOOR,
  clampFuturesAccountPanelHeight, futuresAccountPanelMax, readFuturesAccountPanelHeight, writeFuturesAccountPanelHeight,
} from '../futuresAccountPanelHeight';

const src = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, map: m }; };

describe('futures account panel height', () => {
  test('clamps between the panel minimum and the terminal ceiling', () => {
    expect(clampFuturesAccountPanelHeight(10, 460)).toBe(FUTURES_ACCOUNT_PANEL_MIN);
    expect(clampFuturesAccountPanelHeight(9999, 460)).toBe(460);
    expect(clampFuturesAccountPanelHeight(268.4, 460)).toBe(268);
    // A ceiling under the minimum never produces a panel smaller than the minimum.
    expect(clampFuturesAccountPanelHeight(500, 100)).toBe(FUTURES_ACCOUNT_PANEL_MIN);
  });

  test('the ceiling leaves the chart its 300px floor after the instrument row and the grid gaps', () => {
    // 1440x900: the terminal is 824px tall, the instrument row 56px, two 4px gaps.
    expect(futuresAccountPanelMax({ height: 824, firstRow: 56, rowGap: 4 })).toBe(824 - 56 - 8 - FUTURES_CHART_FLOOR);
    // 1280x720: 644px, a 52px row.
    expect(futuresAccountPanelMax({ height: 644, firstRow: 52, rowGap: 4 })).toBe(284);
    // A terminal too short for both still answers the minimum, never a negative number.
    expect(futuresAccountPanelMax({ height: 400, firstRow: 56, rowGap: 4 })).toBe(FUTURES_ACCOUNT_PANEL_MIN);
  });

  test('a stored height is read back; junk, out-of-range and missing values mean the design default', () => {
    const s = memory();
    expect(readFuturesAccountPanelHeight(s)).toBeNull();
    writeFuturesAccountPanelHeight(268, s);
    expect(s.map.get(FUTURES_ACCOUNT_PANEL_KEY)).toBe('{"height":268}');
    expect(readFuturesAccountPanelHeight(s)).toBe(268);
    s.setItem(FUTURES_ACCOUNT_PANEL_KEY, '{"height":"tall"}'); expect(readFuturesAccountPanelHeight(s)).toBeNull();
    s.setItem(FUTURES_ACCOUNT_PANEL_KEY, '{"height":12}'); expect(readFuturesAccountPanelHeight(s)).toBeNull();
    s.setItem(FUTURES_ACCOUNT_PANEL_KEY, 'not json'); expect(readFuturesAccountPanelHeight(s)).toBeNull();
    writeFuturesAccountPanelHeight(null, s); expect(s.map.has(FUTURES_ACCOUNT_PANEL_KEY)).toBe(false);
    // No storage at all (SSR, a locked-down browser): nothing throws.
    expect(readFuturesAccountPanelHeight(null)).toBeNull();
    expect(() => writeFuturesAccountPanelHeight(200, null)).not.toThrow();
  });

  test('FuturesPage renders the divider only on a desktop with the panel open, and the grid reads the variable', () => {
    const page = src('pages/FuturesPage.tsx');
    expect(page).toContain("useFuturesAccountPanelHeight(!compact && !accountPanel.compact, terminalRef)");
    expect(page).toContain('{!compact && !accountPanel.compact && <div\n            className="orders-resize-handle"\n            role="separator"');
    expect(page).toContain('aria-valuemin={accountHeight.min}');
    expect(page).toContain('onDoubleClick={accountHeight.reset}');
    expect(page).toContain('className="terminal" ref={terminalRef} style={accountHeight.style} data-account-height={accountHeight.active ? \'user\' : undefined}');
    const css = src('pages/trade-terminal/TerminalAccountPanel.css');
    expect(css).toMatch(/@media \(min-width:901px\) \{[\s\S]*\.orders-resize-handle \{[\s\S]*cursor:row-resize/);
    expect(css).toContain('#archive-terminal-preview.futures-terminal .terminal[data-account-height=user]:not([data-account-compact=true]) {\n    grid-template-rows:var(--futures-ticker-height) minmax(300px,1fr) var(--futures-account-height);');
    expect(css).toMatch(/@media \(max-width:900px\) \{\n  \.trade-terminal\.futures-terminal \.orders-resize-handle \{ display:none; \}/);
    // The approved desktop default is not touched: 200px populated, 160px empty.
    const figma = src('pages/trade-terminal/FuturesFigmaDesktop.css');
    expect(figma).toContain('--futures-account-height: 200px;');
    expect(figma).toContain('--futures-account-height: 160px;');
  });

  test('every locale names the separator', () => {
    for (const locale of ['ru', 'en', 'es', 'zh', 'ja', 'ko', 'hi']) {
      expect(src(`lib/i18n/locales/${locale}.ts`)).toMatch(/'futures\.accountPanelHeight': '[^']+',/);
    }
  });
});
