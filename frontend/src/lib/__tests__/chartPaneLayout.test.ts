import {
  adoptedPaneRatios, getChartPaneLayout, indicatorPane, normalizePaneRatios, paneFactors, prunePaneRatios,
  resetChartPaneLayout, resetChartPaneLayoutCache, saveChartPaneLayout,
  CHART_PANE_LAYOUT_KEY, DEFAULT_CROWDED_INDICATOR_RATIO, DEFAULT_INDICATOR_RATIO, DEFAULT_VOLUME_RATIO, PRICE_PANE, VOLUME_PANE,
} from '../chartPaneLayout';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (file: string) => readFileSync(resolve(__dirname, '../../../..', file), 'utf8').replace(/\r\n/g, '\n');

describe('chart pane heights the viewer chose (owner, 2026-11-12)', () => {
  // The suite runs under node: a plain in-memory stand-in for the browser's storage.
  const memory = new Map<string, string>();
  beforeAll(() => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: (key: string) => (memory.has(key) ? memory.get(key)! : null),
      setItem: (key: string, value: string) => { memory.set(key, String(value)); },
      removeItem: (key: string) => { memory.delete(key); },
      clear: () => memory.clear(),
    } });
  });
  afterAll(() => { delete (globalThis as { localStorage?: unknown }).localStorage; });
  beforeEach(() => { memory.clear(); resetChartPaneLayoutCache(); });

  it('lays the panes out at the chart\'s own sizes until the viewer drags one', () => {
    // Volume a fifth of candles + volume, exactly as the chart always drew it (0.8 : 0.2).
    const [price, volume] = paneFactors([PRICE_PANE, VOLUME_PANE], {});
    expect(volume / (price + volume)).toBeCloseTo(0.2, 10);
    expect(DEFAULT_VOLUME_RATIO).toBe(0.25);
    // Lower-pane indicators keep their former 0.24 / 0.18 against the candles' 0.8.
    expect(DEFAULT_INDICATOR_RATIO).toBeCloseTo(0.24 / 0.8, 10);
    expect(DEFAULT_CROWDED_INDICATOR_RATIO).toBeCloseTo(0.18 / 0.8, 10);
    expect(paneFactors([PRICE_PANE, VOLUME_PANE, indicatorPane('a'), indicatorPane('b')], {})).toEqual([1, 0.25, 0.3, 0.3]);
    expect(paneFactors([PRICE_PANE, indicatorPane('a'), indicatorPane('b'), indicatorPane('c')], {})).toEqual([1, 0.225, 0.225, 0.225]);
  });

  it('reads a separator drag as the viewer\'s size and keeps it', () => {
    const roles = [PRICE_PANE, VOLUME_PANE];
    const applied = { roles, factors: paneFactors(roles, {}) };
    // Lightweight Charts moves both neighbours and keeps their sum: 1 + 0.25 → 1.15 + 0.10.
    const adopted = adoptedPaneRatios(applied, roles, [1.15, 0.1], {});
    expect(adopted).not.toBeNull();
    expect(adopted![VOLUME_PANE]).toBeCloseTo(0.1 / 1.15, 10);
    // The next layout writes the viewer's size back, not the default.
    const [price, volume] = paneFactors(roles, adopted!);
    expect(volume / (price + volume)).toBeCloseTo(0.1 / 1.25, 10);
    expect(volume / (price + volume)).toBeLessThan(0.2);
  });

  it('does not mistake its own layout, a rescale or a changed set of panes for a drag', () => {
    const roles = [PRICE_PANE, VOLUME_PANE];
    const applied = { roles, factors: [1, 0.25] };
    expect(adoptedPaneRatios(null, roles, [1.15, 0.1], {})).toBeNull();
    expect(adoptedPaneRatios(applied, roles, [1, 0.25], {})).toBeNull();
    expect(adoptedPaneRatios(applied, roles, [0.8, 0.2], {})).toBeNull(); // the same shape at another scale
    expect(adoptedPaneRatios(applied, roles, [1, 0.25 + 1e-7], {})).toBeNull(); // float noise
    // A pane appeared or went away: the library reshuffles factors itself then.
    expect(adoptedPaneRatios(applied, [PRICE_PANE, VOLUME_PANE, indicatorPane('rsi')], [1, 0.25, 0.5], {})).toBeNull();
    expect(adoptedPaneRatios(applied, [PRICE_PANE, indicatorPane('rsi')], [1, 0.5], {})).toBeNull();
    expect(adoptedPaneRatios(applied, [PRICE_PANE], [1], {})).toBeNull();
    expect(adoptedPaneRatios(applied, roles, [1, Number.NaN], {})).toBeNull();
    expect(adoptedPaneRatios(applied, roles, [0, 0.25], {})).toBeNull();
  });

  it('keeps the size of a pane that is not on the chart now, and of every pane that is', () => {
    const roles = [PRICE_PANE, VOLUME_PANE, indicatorPane('rsi')];
    const applied = { roles, factors: paneFactors(roles, {}) };
    // The candles/volume separator moved; the RSI pane kept its absolute height.
    const adopted = adoptedPaneRatios(applied, roles, [1.2, 0.05, 0.3], { [indicatorPane('macd')]: 0.4 })!;
    expect(adopted[VOLUME_PANE]).toBeCloseTo(0.05 / 1.2, 10);
    expect(adopted[indicatorPane('rsi')]).toBeCloseTo(0.3 / 1.2, 10);
    expect(adopted[indicatorPane('macd')]).toBe(0.4);
    // An indicator that was deleted leaves nothing behind.
    expect(Object.keys(prunePaneRatios(adopted, ['rsi'])).sort()).toEqual([indicatorPane('rsi'), VOLUME_PANE].sort());
    // A pane with no role of its own (nothing identifiable in it) is laid out but never stored.
    const anonymous = [PRICE_PANE, 'pane:1'];
    expect(adoptedPaneRatios({ roles: anonymous, factors: [1, 0.3] }, anonymous, [1.1, 0.2], {})).toEqual({});
  });

  it('stores the sizes per market in the browser and survives a reload', () => {
    saveChartPaneLayout('spot', { [VOLUME_PANE]: 0.08 });
    saveChartPaneLayout('futures', { [VOLUME_PANE]: 0.5, [indicatorPane('rsi')]: 0.2 });
    expect(JSON.parse(localStorage.getItem(CHART_PANE_LAYOUT_KEY)!)).toEqual({ spot: { volume: 0.08 }, futures: { volume: 0.5, 'ind:rsi': 0.2 }, cfd: {} });
    resetChartPaneLayoutCache(); // a new page load
    expect(getChartPaneLayout('spot')).toEqual({ volume: 0.08 });
    expect(getChartPaneLayout('futures')).toEqual({ volume: 0.5, 'ind:rsi': 0.2 });
    expect(getChartPaneLayout('cfd')).toEqual({});
    resetChartPaneLayout('spot');
    resetChartPaneLayoutCache();
    expect(getChartPaneLayout('spot')).toEqual({});
    expect(getChartPaneLayout('futures')).toEqual({ volume: 0.5, 'ind:rsi': 0.2 });
  });

  it('ignores damaged or hostile stored data', () => {
    for (const raw of ['', 'null', '[]', '{"spot":7}', '{"spot":{"volume":"big"}}', '{"spot":{"__proto__":1,"price":3,"volume":-1,"ind:":2}}', '{bad json']) {
      localStorage.setItem(CHART_PANE_LAYOUT_KEY, raw);
      resetChartPaneLayoutCache();
      expect(getChartPaneLayout('spot')).toEqual({});
    }
    // Sizes are clamped to something a chart can draw.
    expect(normalizePaneRatios({ volume: 0.000001, 'ind:a': 900 })).toEqual({ volume: 0.02, 'ind:a': 4 });
    expect(normalizePaneRatios({ volume: Number.POSITIVE_INFINITY, 'ind:b': Number.NaN })).toEqual({});
  });

  it('is what the chart uses: no fixed heights written over the viewer\'s any more', () => {
    const chart = read('frontend/src/components/PriceChart.tsx');
    expect(chart).toContain('adoptPaneResize();\n    const roles = paneRoles(), factors = paneFactors(roles, paneLayoutRef.current);');
    expect(chart).toContain("window.addEventListener('pointerup', released);");
    expect(chart).not.toContain('setStretchFactor(0.2)');
    expect(chart).not.toContain('setStretchFactor(0.8)');
    // «Сбросить» returns the chart's own heights.
    expect(chart).toContain('resetChartPaneLayout(market); paneLayoutRef.current = getChartPaneLayout(market); appliedPanesRef.current = null; layoutPanes();');
  });

  it('lets everything drawn on the chart be taken off it', () => {
    const chart = read('frontend/src/components/PriceChart.tsx');
    // Each legend line carries its own settings and remove buttons; the volume strip has a line of its own on the desktop chart.
    expect(chart).toContain("remove={{ label: `${t('chart.settings.indicatorRemove')}: ${name}`, run: () => saveChartIndicators(getChartIndicators(market).filter(x => x.id !== i.id), market) }} />];");
    expect(chart).toContain("if (volumeToggle?.on && !compactLayout) items.push(<LegendItem key=\"volume\"");
    // The Indicators menu switches the volume strip too, on every screen.
    expect(chart).toContain("...(volumeToggle ? [{ key: 'volume', label: t('chart.settings.volume'), params: '', color: '#8b9098', pane: 'lower' as const, builtIn: true, active: volumeToggle.on, onToggle: volumeToggle.toggle }] : []),");
    // …under an attribute of its own: it is the chart's strip, not a 16th catalogue indicator.
    expect(read('frontend/src/components/ChartToolbarMenus.tsx')).toContain("{...(item.builtIn ? { 'data-chart-builtin': item.key } : { 'data-chart-indicator': item.key })}");
    // The buttons add no words to a legend line (QA reads the line as the indicator's name).
    expect(chart).toContain('aria-label={remove.label} title={remove.label} data-legend-remove={id} onClick={remove.run}>{LEGEND_CROSS}</button>');
    const css = read('frontend/src/components/ChartLegend.css');
    expect(css).toContain('.voltex-indicator-legend .voltex-legend-row { pointer-events: auto; }');
    expect(css).toContain('@media (hover: none)');
  });

  it('arms the existing ruler on Shift over the chart and never during a press or in a field', () => {
    const chart = read('frontend/src/components/PriceChart.tsx');
    expect(chart).toContain("if (pointerHeld || toolRef.current !== 'cursor' || lockedRef.current || tradingRef.current?.selecting || !chartAreaRef.current?.matches(':hover')) return;");
    expect(chart).toContain("if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || typing(event.target)) return;");
    // Shift let go before a click puts the cursor back; a measurement that was started goes on.
    expect(chart).toContain("const unused = shiftRulerRef.current === 'armed';\n      shiftRulerRef.current = null;\n      if (unused && toolRef.current === 'ruler') setTool('cursor');");
  });

  it('keeps the phone sheet open while its indicator list is used, and the list above the sheet', () => {
    expect(read('frontend/src/components/chart-workspace/ChartWorkspaceMenu.tsx')).toContain("if (target instanceof Element && target.closest('.chart-menu')) return;");
    const menus = read('frontend/src/components/ChartToolbarMenus.css');
    const sheet = read('frontend/src/components/chart-workspace/ChartWorkspace.css');
    const z = (css: string, selector: string) => Number(new RegExp(`${selector.replace(/[.]/g, '\\.')}\\s*\\{[^}]*z-index:\\s*(\\d+)`).exec(css)?.[1]);
    expect(z(menus, '.chart-menu')).toBeGreaterThan(z(sheet, '.cw-menu-layer.is-sheet'));
    expect(z(menus, '.chart-menu')).toBeLessThan(1200);
  });
});
