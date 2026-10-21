import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  clampPanelHeight, readStoredPanelHeight, writeStoredPanelHeight, maxPanelHeightFor, effectivePanelHeight,
  FUTURES_PANEL_HEIGHT_KEY, FUTURES_PANEL_MIN_HEIGHT, FUTURES_PANEL_MAX_HEIGHT_FALLBACK, FUTURES_CHART_MIN_HEIGHT, FUTURES_PANEL_PREFERENCE_CEILING,
} from '../useFuturesPanelHeight';

/** The Futures account panel's draggable top edge: what is remembered, what is clamped, what the page wires. */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
  setItem(key: string, value: string) { this.map.set(key, String(value)); }
  removeItem(key: string) { this.map.delete(key); }
}

describe('clampPanelHeight', () => {
  test('keeps whole pixels inside the range and refuses nonsense', () => {
    expect(clampPanelHeight(300)).toBe(300);
    expect(clampPanelHeight('300')).toBe(300);
    expect(clampPanelHeight(299.6)).toBe(300);
    expect(clampPanelHeight(10)).toBe(FUTURES_PANEL_MIN_HEIGHT);
    expect(clampPanelHeight(10_000)).toBe(FUTURES_PANEL_MAX_HEIGHT_FALLBACK);
    expect(clampPanelHeight(500, FUTURES_PANEL_MIN_HEIGHT, 420)).toBe(420);
    // A ceiling below the floor never inverts the range.
    expect(clampPanelHeight(500, FUTURES_PANEL_MIN_HEIGHT, 100)).toBe(FUTURES_PANEL_MIN_HEIGHT);
    for (const bad of [NaN, Infinity, -Infinity, 'tall', '', null, undefined, {}]) expect(clampPanelHeight(bad)).toBeNull();
  });
});

describe('stored height', () => {
  test('round-trips, clamps a tampered value and forgets on reset', () => {
    const store = new MemoryStorage();
    expect(readStoredPanelHeight(store)).toBeNull();
    writeStoredPanelHeight(320, store);
    expect(store.getItem(FUTURES_PANEL_HEIGHT_KEY)).toBe('320');
    expect(readStoredPanelHeight(store)).toBe(320);
    // A remembered height is a preference: it may exceed the keyboard fallback (a large screen allows more), never any screen's room.
    store.setItem(FUTURES_PANEL_HEIGHT_KEY, '900');
    expect(readStoredPanelHeight(store)).toBe(900);
    store.setItem(FUTURES_PANEL_HEIGHT_KEY, '99999');
    expect(readStoredPanelHeight(store)).toBe(FUTURES_PANEL_PREFERENCE_CEILING);
    store.setItem(FUTURES_PANEL_HEIGHT_KEY, 'garbage');
    expect(readStoredPanelHeight(store)).toBeNull();
    writeStoredPanelHeight(null, store);
    expect(store.getItem(FUTURES_PANEL_HEIGHT_KEY)).toBeNull();
    // No storage at all (private mode): nothing throws, nothing is remembered.
    expect(() => writeStoredPanelHeight(300, null)).not.toThrow();
    expect(readStoredPanelHeight(null)).toBeNull();
  });
});

describe('maxPanelHeightFor', () => {
  test('leaves the chart its minimum track and the pair row its height', () => {
    // 1000px viewport, 92px header → 908px terminal, 56px ticker, 16px of padding and gaps.
    expect(maxPanelHeightFor(908, 56)).toBe(908 - 56 - FUTURES_CHART_MIN_HEIGHT - 16);
    expect(maxPanelHeightFor(908, 56, 12)).toBe(908 - 56 - FUTURES_CHART_MIN_HEIGHT - 12);
    // A tiny window never yields less than the floor.
    expect(maxPanelHeightFor(400, 56)).toBe(FUTURES_PANEL_MIN_HEIGHT);
    expect(maxPanelHeightFor(NaN, 56)).toBe(FUTURES_PANEL_MIN_HEIGHT);
  });
});

describe('effectivePanelHeight', () => {
  test('the preference is shown inside today\'s ceiling and kept as it is (CTO, 2026-10-21: 552 at 1920×1000, then 1366×768)', () => {
    // 1920×1000: 908px terminal, 56px pair row, 16px chrome → 536 of room; 1366×768: 676 → 304.
    const large = maxPanelHeightFor(908, 56), small = maxPanelHeightFor(676, 56);
    expect(effectivePanelHeight(null, large)).toBeNull();
    expect(effectivePanelHeight(300, large)).toBe(300);
    expect(effectivePanelHeight(552, large)).toBe(Math.min(552, large));
    expect(effectivePanelHeight(552, small)).toBe(small);
    expect(small).toBe(676 - 56 - FUTURES_CHART_MIN_HEIGHT - 16);
    // Back on the large screen the same preference is shown again.
    expect(effectivePanelHeight(552, large)).toBeGreaterThan(effectivePanelHeight(552, small)!);
    expect(effectivePanelHeight(100, large)).toBe(FUTURES_PANEL_MIN_HEIGHT);
    // A window too small even for the floor: the floor, never an inverted range.
    expect(effectivePanelHeight(552, 100)).toBe(FUTURES_PANEL_MIN_HEIGHT);
  });
});

describe('the page and the sheet', () => {
  const page = readFileSync(resolve(__dirname, '../../pages/FuturesPage.tsx'), 'utf8');
  const sheet = readFileSync(resolve(__dirname, '../../pages/trade-terminal/FuturesPanelResize.css'), 'utf8');

  test('the grid carries the chosen height as the variable FuturesFigmaDesktop already reads', () => {
    // The grid gets the preference held inside today's ceiling, measured before the first paint; the preference itself is what is remembered.
    expect(page).toContain("'--futures-account-height': `${panelShown}px`");
    expect(page).toContain('const panelShown = effectivePanelHeight(panelHeight.height, panelMax);');
    expect(page).toMatch(/useLayoutEffect\(\(\) => \{\s*const terminal = terminalRef\.current, panel = bottomPanelRef\.current;/);
    expect(page).toContain("data-account-height={panelHeight.height !== null ? 'user' : undefined}");
    expect(page).toContain("data-account-height-limited={panelLimited ? 'true' : undefined}");
    expect(page).toContain('aria-valuenow={panelShown ?? panelMeasured}');
    const figma = readFileSync(resolve(__dirname, '../../pages/trade-terminal/FuturesFigmaDesktop.css'), 'utf8');
    expect(figma).toContain('grid-template-rows: var(--futures-ticker-height) minmax(300px, 1fr) var(--futures-account-height);');
  });

  test('the handle is the Spot terminal\'s separator, first in the panel, with keyboard and reset', () => {
    const panelStart = page.indexOf('className="bottom-panel" ref={bottomPanelRef}');
    const handle = page.indexOf('className="orders-resize-handle" role="separator"', panelStart);
    const header = page.indexOf('className="terminal-account-header"', panelStart);
    expect(panelStart).toBeGreaterThan(0);
    expect(handle).toBeGreaterThan(panelStart);
    expect(handle).toBeLessThan(header);
    const markup = page.slice(handle, header);
    for (const attr of ['tabIndex={0}', "aria-label={t('futures.panelHeight')}", 'aria-orientation="horizontal"', 'aria-valuemin={FUTURES_PANEL_MIN_HEIGHT}', 'aria-valuemax={panelMax}',
      'onPointerDown={startPanelResize}', 'onDoubleClick={panelHeight.reset}', "event.key === 'ArrowUp'", "event.key === 'Escape'"]) expect(markup).toContain(attr);
  });

  test('desktop only: a phone hides the handle, the folded panel keeps the existing hide rule', () => {
    expect(sheet).toMatch(/@media \(min-width: 901px\)[\s\S]*\.orders-resize-handle \{[^}]*cursor: row-resize/);
    expect(sheet).toMatch(/@media \(max-width: 900px\)[\s\S]*\.orders-resize-handle \{ display: none; \}/);
    const accountPanel = readFileSync(resolve(__dirname, '../../pages/trade-terminal/TerminalAccountPanel.css'), 'utf8');
    expect(accountPanel).toContain('.bottom-panel[data-account-compact=true] .orders-resize-handle { display:none; }');
    // Two whole position rows by default, and every tab's body scrolls inside the panel.
    expect(sheet).toContain('--futures-account-height: 252px;');
    expect(sheet).toContain('.bottom-content { overflow-x: hidden; overflow-y: auto; }');
  });

  test('the label exists in every locale', () => {
    for (const locale of ['ru', 'en', 'es', 'hi', 'ja', 'ko', 'zh']) {
      const text = readFileSync(resolve(__dirname, `../i18n/locales/${locale}.ts`), 'utf8');
      expect(text).toMatch(/'futures\.panelHeight': '[^']+'/);
    }
  });
});
