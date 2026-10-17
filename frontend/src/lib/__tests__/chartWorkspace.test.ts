import {
  BUILT_IN_PRESETS, DEFAULT_WORKSPACE, MAX_WORKSPACE_PRESETS, deleteWorkspacePreset, getChartWorkspace, getWorkspacePresets, normalizeCompare, normalizePresetsFile,
  normalizeWorkspace, presetFromWorkspace, presetsStorageKey, renameWorkspacePreset, resetChartWorkspaceCache, resetWorkspacePresetsCache, saveWorkspacePreset,
  subscribeChartWorkspace, updateChartWorkspace, workspaceStorageKey,
} from '../chartWorkspace';
import { INDICATOR_CATALOGUE } from '../chartIndicators';

const store = new Map<string, string>();
beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); },
  } });
});
beforeEach(() => { store.clear(); resetChartWorkspaceCache(); resetWorkspacePresetsCache(); });

describe('workspace state', () => {
  it('opens with the defaults and re-checks every stored field', () => {
    expect(normalizeWorkspace(null)).toEqual(DEFAULT_WORKSPACE);
    expect(normalizeWorkspace({ version: 2, timeframe: '1d' }).timeframe).toBe('1h');
    const s = normalizeWorkspace({ version: 1, view: 'data', timeframe: '1M', quickTimeframes: ['1d', 'x', '1m'], barType: 'renko', layout: 3, compare: [{ pair: 'eth/usdt', color: 'red' }, { pair: 'bad pair' }], comparePeriod: '1w', syncCursor: false, activePane: 3 });
    expect(s).toMatchObject({ view: 'data', timeframe: '1M', quickTimeframes: ['1m', '1d'], barType: 'candles', layout: 1, comparePeriod: '1w', syncCursor: false, activePane: 0 });
    expect(s.compare).toEqual([{ pair: 'ETH/USDT', color: '#60a5fa', visible: true }]);
    expect(normalizeWorkspace({ version: 1, layout: 4, activePane: 3 }).activePane).toBe(3);
  });
  it('keeps at most three compared instruments, each once, with a colour of its own', () => {
    const list = normalizeCompare([{ pair: 'A/USDT' }, { pair: 'a/usdt' }, { pair: 'B/USDT', color: '#ABCDEF', visible: false }, { pair: 'C/USDT' }, { pair: 'D/USDT' }]);
    expect(list.map(e => e.pair)).toEqual(['A/USDT', 'B/USDT', 'C/USDT']);
    expect(list[1]).toEqual({ pair: 'B/USDT', color: '#abcdef', visible: false });
  });
  it('persists changes per market without the view, and tells subscribers', () => {
    const seen: string[] = [];
    const off = subscribeChartWorkspace('futures', s => seen.push(s.timeframe));
    updateChartWorkspace('futures', { timeframe: '4h', view: 'analytics' });
    updateChartWorkspace('spot', s => ({ layout: s.layout === 1 ? 2 : 1 }));
    off();
    expect(seen).toEqual(['4h']);
    expect(getChartWorkspace('futures')).toMatchObject({ timeframe: '4h', view: 'analytics' });
    expect(getChartWorkspace('spot')).toMatchObject({ timeframe: '1h', layout: 2 });
    expect(JSON.parse(store.get(workspaceStorageKey('futures'))!)).not.toHaveProperty('view');
    resetChartWorkspaceCache();
    expect(getChartWorkspace('futures')).toMatchObject({ timeframe: '4h', view: 'chart' });
  });
});

describe('presets', () => {
  const draft = () => presetFromWorkspace(normalizeWorkspace({ version: 1, timeframe: '15m', barType: 'bars' }), [{ id: 'x', type: 'ema', params: { period: 9 }, colors: ['#60a5fa'], lineWidth: 1, visible: true }], { volume: true, indicatorLegend: false }, 'Моя');
  it('ships four built-ins with catalogue indicators only', () => {
    expect(BUILT_IN_PRESETS.map(p => p.id)).toEqual(['builtin-scalping', 'builtin-intraday', 'builtin-swing', 'builtin-clean']);
    for (const preset of BUILT_IN_PRESETS) for (const inst of preset.indicators) expect(INDICATOR_CATALOGUE.some(d => d.type === inst.type)).toBe(true);
    expect(BUILT_IN_PRESETS[3].indicators).toEqual([]);
  });
  it('saves, renames and deletes the viewer\'s own presets within the cap', () => {
    const saved = saveWorkspacePreset('spot', draft())!;
    expect(saved).toMatchObject({ name: 'Моя', timeframe: '15m', barType: 'bars', volume: true, indicatorLegend: false });
    expect(saved.indicators[0]).toMatchObject({ type: 'ema', params: { period: 9 } });
    expect(getWorkspacePresets('spot')).toHaveLength(1);
    expect(getWorkspacePresets('futures')).toHaveLength(0);
    expect(renameWorkspacePreset('spot', saved.id, '  Новая  ')).toBe(true);
    expect(renameWorkspacePreset('spot', saved.id, '   ')).toBe(false);
    expect(renameWorkspacePreset('spot', 'nope', 'x')).toBe(false);
    resetWorkspacePresetsCache();
    expect(getWorkspacePresets('spot')[0].name).toBe('Новая');
    deleteWorkspacePreset('spot', saved.id);
    expect(getWorkspacePresets('spot')).toHaveLength(0);
    for (let i = 0; i < MAX_WORKSPACE_PRESETS; i++) expect(saveWorkspacePreset('spot', { ...draft(), name: `p${i}` })).not.toBeNull();
    expect(saveWorkspacePreset('spot', { ...draft(), name: 'one too many' })).toBeNull();
    expect(saveWorkspacePreset('futures', { ...draft(), name: '' })).toBeNull();
  });
  it('re-checks a stored file: version, ids, names, and never a built-in id', () => {
    expect(normalizePresetsFile(null)).toEqual({ version: 1, presets: [] });
    expect(normalizePresetsFile({ version: 3, presets: [{ id: 'a', name: 'A' }] }).presets).toEqual([]);
    const file = normalizePresetsFile({ version: 1, presets: [
      { id: 'builtin-clean', name: 'fake' }, { id: 'ok-1', name: 'One', timeframe: '99m', barType: 'heikin', indicators: [{ type: 'rsi', params: { period: 7 } }, { type: 'nope' }] },
      { id: 'ok-1', name: 'Duplicate' }, { id: 'bad id!', name: 'X' }, { name: 'no id' },
    ] });
    expect(file.presets).toHaveLength(1);
    expect(file.presets[0]).toMatchObject({ id: 'ok-1', name: 'One', timeframe: '1h', barType: 'heikin' });
    expect(file.presets[0].indicators).toHaveLength(1);
    store.set(presetsStorageKey('futures'), 'not json');
    resetWorkspacePresetsCache();
    expect(getWorkspacePresets('futures')).toEqual([]);
  });
});
