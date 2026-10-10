import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../lib/i18n';
import {
  AXIS_FONT_SIZES, AXIS_WHITE, CHART_PRESETS, DEFAULT_CHART_SETTINGS, PRICE_DECIMALS, getSavedChartSettings, previewChartSettings, revertChartSettings, saveChartSettings, withPreset,
  type ChartAxisFont, type ChartColorPreset, type ChartGridMode, type ChartLineStyle, type ChartPriceDecimals, type ChartScaleMode, type ChartSettings,
} from '../lib/chartSettings';
import {
  DEFAULT_CHART_INDICATORS, INDICATOR_CATALOGUE, MAX_CHART_INDICATORS, getSavedChartIndicators, indicatorDefinition, indicatorInstanceLabel, newIndicatorInstance,
  previewChartIndicators, revertChartIndicators, saveChartIndicators, type IndicatorInstance, type IndicatorLineWidth, type IndicatorType,
} from '../lib/chartIndicators';
import './ChartSettingsDialog.css';

export type ChartSettingsTab = 'scales' | 'look' | 'candles' | 'indicators';

let requested: { tab: ChartSettingsTab; focus?: string } | null = null;
/** Ask the next dialog to open on a section (and an indicator's row); the chart's gear keeps opening on Candles. */
export function requestChartSettingsView(tab: ChartSettingsTab, focus?: string): void { requested = { tab, focus }; }

/**
 * The chart's «Настройки» dialog, laid out as the reference's TradingView
 * one: a section list on the left, the section on the right, «Сбросить»,
 * «Отмена» and «Ок» along the foot. Every change paints the chart at once;
 * «Отмена», Esc, the close button and a click outside put back what was
 * saved, «Ок» keeps the draft in this browser.
 *
 * 2026-10-10 (Issue #502): four sections as Bybit groups them — Scales
 * (the right price scale's digits, with a plain-white preset, the time
 * scale's labels, font, borders, ticks, visibility, log mode, decimals),
 * Appearance, Candles and Indicators (every instance's parameters, colours,
 * width and visibility, plus the catalogue). Indicators follow the same
 * draft / keep / throw-away flow as the paint settings.
 */
export function ChartSettingsDialog({ onClose, initialTab = 'candles', focusIndicator }: { onClose: () => void; initialTab?: ChartSettingsTab; focusIndicator?: string }) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<ChartSettingsTab>(() => { const r = requested; requested = null; if (r) focusIndicator = r.focus; return r?.tab ?? initialTab; });
  const [draft, setDraft] = useState<ChartSettings>(() => ({ ...getSavedChartSettings() }));
  const [indicators, setIndicators] = useState<IndicatorInstance[]>(() => getSavedChartIndicators().map(i => ({ ...i, params: { ...i.params }, colors: [...i.colors] })));
  const [query, setQuery] = useState('');
  const boxRef = useRef<HTMLDivElement | null>(null);
  const focusRef = useRef<string | undefined>(focusIndicator);
  const openerRef = useRef<Element | null>(typeof document === 'undefined' ? null : document.activeElement);

  const change = (next: ChartSettings) => { setDraft(next); previewChartSettings(next); };
  const set = <K extends keyof ChartSettings>(key: K, value: ChartSettings[K]) => {
    const colour = /Up$|Down$/.test(String(key));
    change({ ...draft, [key]: value, ...(colour ? { preset: 'custom' as ChartColorPreset } : {}) });
  };
  const changeIndicators = (next: IndicatorInstance[]) => { setIndicators(next); previewChartIndicators(next); };
  const updateIndicator = (id: string, patch: (inst: IndicatorInstance) => IndicatorInstance) => changeIndicators(indicators.map(i => (i.id === id ? patch(i) : i)));
  const cancel = () => { revertChartSettings(); revertChartIndicators(); onClose(); };
  const ok = () => { saveChartSettings(draft); saveChartIndicators(indicators); onClose(); };
  const reset = () => {
    change({ ...DEFAULT_CHART_SETTINGS });
    changeIndicators(DEFAULT_CHART_INDICATORS.map(i => ({ ...i, params: { ...i.params }, colors: [...i.colors] })));
  };

  useEffect(() => {
    const focused = focusRef.current ? boxRef.current?.querySelector<HTMLElement>(`[data-indicator-row="${focusRef.current}"] input, [data-indicator-row="${focusRef.current}"] select`) : null;
    (focused ?? boxRef.current?.querySelector<HTMLElement>('[aria-selected="true"]'))?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); return; }
      if (e.key !== 'Tab') return;
      const box = boxRef.current;
      if (!box) return;
      const focusable = Array.from(box.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]'
      )).filter(element => element.tabIndex >= 0 && !element.hidden);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (!first || !last) { e.preventDefault(); box.focus(); return; }
      // Do not let keyboard navigation reach the trading ticket behind the modal.
      if (!box.contains(document.activeElement)) {
        e.preventDefault(); (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      // Pair/route changes can unmount the dialog without calling Cancel.
      // Reverting after Ok is also safe: saveChartSettings already kept the draft.
      revertChartSettings();
      revertChartIndicators();
      const opener = openerRef.current as HTMLElement | null;
      if (opener?.isConnected) opener.focus?.();
    };
    // cancel only reads module state; binding once is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const presets: [Exclude<ChartColorPreset, 'custom'>, string, string][] = [
    ['standard', t('chart.settings.preset.standard'), t('chart.settings.preset.standardHint')],
    ['classic', t('chart.settings.preset.classic'), t('chart.settings.preset.classicHint')],
    ['asia', t('chart.settings.preset.asia'), t('chart.settings.preset.asiaHint')],
  ];
  const parts: ['body' | 'border' | 'wick', string][] = [['body', t('chart.settings.body')], ['border', t('chart.settings.border')], ['wick', t('chart.settings.wick')]];
  const grids: [ChartGridMode, string][] = [['none', t('chart.settings.grid.none')], ['horizontal', t('chart.settings.grid.horizontal')], ['vertical', t('chart.settings.grid.vertical')], ['all', t('chart.settings.grid.all')]];
  const lineStyles: [ChartLineStyle, string][] = [['dashed', t('chart.settings.lineDashed')], ['solid', t('chart.settings.lineSolid')], ['dotted', t('chart.settings.lineDotted')]];
  const fonts: [ChartAxisFont, string][] = [['terminal', t('chart.settings.axisFontTerminal')], ['inter', t('chart.settings.axisFontInter')], ['mono', t('chart.settings.axisFontMono')]];
  const tabs: [ChartSettingsTab, string][] = [['scales', t('chart.settings.tab.scales')], ['look', t('chart.settings.tab.look')], ['candles', t('chart.settings.tab.candles')], ['indicators', t('chart.settings.tab.indicators')]];
  const label = (key: string) => (key.includes('.') ? t(key as never) : key);

  /** A colour that is either «as the terminal» (null), white, or a picked hex. */
  const axisColour = (key: 'priceAxisText' | 'timeAxisText', caption: string, testId: string) => {
    const value = draft[key];
    const mode = value === null ? 'terminal' : value === AXIS_WHITE ? 'white' : 'custom';
    return (
      <div className="vcs-row" data-setting={testId}>
        <span>{caption}</span>
        <span className="vcs-colors">
          <select value={mode} aria-label={caption} data-axis-mode={testId}
            onChange={e => change({ ...draft, [key]: e.target.value === 'terminal' ? null : e.target.value === 'white' ? AXIS_WHITE : (value ?? '#c7d2e0') })}>
            <option value="terminal">{t('chart.settings.axisTerminal')}</option>
            <option value="white">{t('chart.settings.axisWhite')}</option>
            <option value="custom">{t('chart.settings.axisCustom')}</option>
          </select>
          <button type="button" className={`vcs-white${value === AXIS_WHITE ? ' is-on' : ''}`} aria-pressed={value === AXIS_WHITE} data-axis-white={testId}
            title={t('chart.settings.axisWhite')} aria-label={`${caption}: ${t('chart.settings.axisWhite')}`} onClick={() => change({ ...draft, [key]: AXIS_WHITE })}>#FFFFFF</button>
          <input type="color" value={value ?? '#c7d2e0'} disabled={value === null} aria-label={`${caption}: ${t('chart.settings.axisCustom')}`} data-axis-color={testId}
            onChange={e => change({ ...draft, [key]: e.target.value })} />
        </span>
      </div>
    );
  };

  const needle = query.trim().toLowerCase();
  const catalogue = useMemo(() => INDICATOR_CATALOGUE.filter(d => !needle || `${d.short} ${t(d.label as never)} ${d.type}`.toLowerCase().includes(needle)), [needle, t]);

  return createPortal(
    <div className="vx-chart-settings" onMouseDown={e => { if (e.target === e.currentTarget) cancel(); }}>
      <div className="vcs-box" ref={boxRef} role="dialog" aria-modal="true" aria-labelledby="vcs-title" tabIndex={-1}>
        <div className="vcs-head">
          <h2 id="vcs-title">{t('chart.settings.title')}</h2>
          <button type="button" className="vcs-close" onClick={cancel} aria-label={t('chart.settings.cancel')}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="vcs-body">
          <div className="vcs-nav" role="tablist" aria-orientation="vertical">
            {tabs.map(([key, name]) => (
              <button key={key} type="button" role="tab" id={`vcs-tab-${key}`} aria-controls={`vcs-pane-${key}`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1}
                onClick={() => setTab(key)}
                onKeyDown={e => {
                  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                  e.preventDefault();
                  const i = tabs.findIndex(([k]) => k === tab), next = tabs[(i + (e.key === 'ArrowDown' ? 1 : tabs.length - 1)) % tabs.length][0];
                  setTab(next); boxRef.current?.querySelector<HTMLElement>(`#vcs-tab-${next}`)?.focus();
                }}>{name}</button>
            ))}
          </div>
          <div className="vcs-pane" role="tabpanel" id={`vcs-pane-${tab}`} aria-labelledby={`vcs-tab-${tab}`}>
            {tab === 'scales' && <>
              <p className="vcs-cap">{t('chart.settings.scales')}</p>
              {axisColour('priceAxisText', t('chart.settings.priceAxisText'), 'price-axis')}
              {axisColour('timeAxisText', t('chart.settings.timeAxisText'), 'time-axis')}
              <p className="vcs-hint">{t('chart.settings.axesHint')}</p>
              <div className="vcs-row">
                <span>{t('chart.settings.axisFontSize')}</span>
                <span className="vcs-colors">
                  <select value={draft.axisFontSize === null ? 'auto' : String(draft.axisFontSize)} aria-label={t('chart.settings.axisFontSize')} data-setting="axis-font-size"
                    onChange={e => change({ ...draft, axisFontSize: e.target.value === 'auto' ? null : Number(e.target.value) })}>
                    <option value="auto">{t('chart.settings.axisFontAuto')}</option>
                    {AXIS_FONT_SIZES.map(size => <option key={size} value={size}>{size} px</option>)}
                  </select>
                </span>
              </div>
              <div className="vcs-row">
                <span>{t('chart.settings.axisFont')}</span>
                <span className="vcs-colors">
                  <select value={draft.axisFont} aria-label={t('chart.settings.axisFont')} data-setting="axis-font" onChange={e => change({ ...draft, axisFont: e.target.value as ChartAxisFont })}>
                    {fonts.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
                  </select>
                </span>
              </div>
              <p className="vcs-cap">{t('chart.settings.show')}</p>
              <label className="vcs-check vcs-line"><input type="checkbox" checked={draft.priceScaleVisible} data-setting="price-scale-visible" onChange={e => change({ ...draft, priceScaleVisible: e.target.checked })} /><span>{t('chart.settings.priceScaleVisible')}</span></label>
              <label className="vcs-check vcs-line"><input type="checkbox" checked={draft.timeScaleVisible} data-setting="time-scale-visible" onChange={e => change({ ...draft, timeScaleVisible: e.target.checked })} /><span>{t('chart.settings.timeScaleVisible')}</span></label>
              <div className="vcs-row">
                <label className="vcs-check"><input type="checkbox" checked={draft.scaleBorders} data-setting="scale-borders" onChange={e => change({ ...draft, scaleBorders: e.target.checked })} /><span>{t('chart.settings.scaleBorders')}</span></label>
                <span className="vcs-colors">
                  <select value={draft.scaleBorderColor === null ? 'terminal' : 'custom'} aria-label={t('chart.settings.scaleBorderColor')} disabled={!draft.scaleBorders}
                    onChange={e => change({ ...draft, scaleBorderColor: e.target.value === 'terminal' ? null : '#292c34' })}>
                    <option value="terminal">{t('chart.settings.axisTerminal')}</option>
                    <option value="custom">{t('chart.settings.axisCustom')}</option>
                  </select>
                  {draft.scaleBorderColor !== null && <input type="color" value={draft.scaleBorderColor} disabled={!draft.scaleBorders} aria-label={t('chart.settings.scaleBorderColor')} onChange={e => change({ ...draft, scaleBorderColor: e.target.value })} />}
                </span>
              </div>
              <label className="vcs-check vcs-line"><input type="checkbox" checked={draft.scaleTicks} data-setting="scale-ticks" onChange={e => change({ ...draft, scaleTicks: e.target.checked })} /><span>{t('chart.settings.scaleTicks')}</span></label>
              <div className="vcs-row">
                <span>{t('chart.settings.scaleMode')}</span>
                <span className="vcs-colors">
                  <select value={draft.scaleMode} aria-label={t('chart.settings.scaleMode')} data-setting="scale-mode" onChange={e => change({ ...draft, scaleMode: e.target.value as ChartScaleMode })}>
                    <option value="normal">{t('chart.settings.scaleNormal')}</option>
                    <option value="logarithmic">{t('chart.settings.scaleLog')}</option>
                  </select>
                </span>
              </div>
              <div className="vcs-row">
                <span>{t('chart.settings.priceDecimals')}</span>
                <span className="vcs-colors">
                  <select value={String(draft.priceDecimals)} aria-label={t('chart.settings.priceDecimals')} data-setting="price-decimals"
                    onChange={e => change({ ...draft, priceDecimals: (e.target.value === 'auto' ? 'auto' : Number(e.target.value)) as ChartPriceDecimals })}>
                    {PRICE_DECIMALS.map(d => <option key={String(d)} value={String(d)}>{d === 'auto' ? t('chart.settings.priceDecimalsAuto') : d}</option>)}
                  </select>
                </span>
              </div>
            </>}
            {tab === 'candles' && <>
              <p className="vcs-cap">{t('chart.settings.colors')}</p>
              <div className="vcs-presets">
                {presets.map(([key, name, hint]) => (
                  <button key={key} type="button" aria-pressed={draft.preset === key} onClick={() => change(withPreset(draft, key))}>
                    <span className="vcs-swatch" aria-hidden="true"><i style={{ background: CHART_PRESETS[key][0] }} /><i style={{ background: CHART_PRESETS[key][1] }} /></span>
                    <b>{name}</b><small>{hint}</small>
                  </button>
                ))}
              </div>
              <p className="vcs-cap">{t('chart.settings.candles')}</p>
              {parts.map(([key, name]) => (
                <div className="vcs-row" key={key}>
                  <label className="vcs-check">
                    <input type="checkbox" checked={draft[key]} disabled={key !== 'wick' && draft[key] && !draft[key === 'body' ? 'border' : 'body']}
                      onChange={e => set(key, e.target.checked)} />
                    <span>{name}</span>
                  </label>
                  <span className="vcs-colors">
                    <input type="color" value={draft[`${key}Up`]} onChange={e => set(`${key}Up`, e.target.value)} aria-label={`${name}: ${t('chart.settings.up')}`} title={t('chart.settings.up')} />
                    <input type="color" value={draft[`${key}Down`]} onChange={e => set(`${key}Down`, e.target.value)} aria-label={`${name}: ${t('chart.settings.down')}`} title={t('chart.settings.down')} />
                  </span>
                </div>
              ))}
              <label className="vcs-check vcs-line"><input type="checkbox" checked={draft.lastPriceLine} onChange={e => change({ ...draft, lastPriceLine: e.target.checked })} /><span>{t('chart.settings.lastPrice')}</span></label>
            </>}
            {tab === 'look' && <>
              <p className="vcs-cap">{t('chart.settings.style')}</p>
              <div className="vcs-row">
                <span>{t('chart.settings.background')}</span>
                <span className="vcs-colors">
                  <select value={draft.background === null ? 'terminal' : 'custom'} aria-label={t('chart.settings.background')}
                    onChange={e => change({ ...draft, background: e.target.value === 'terminal' ? null : '#111216' })}>
                    <option value="terminal">{t('chart.settings.backgroundTerminal')}</option>
                    <option value="custom">{t('chart.settings.backgroundCustom')}</option>
                  </select>
                  {draft.background !== null && <input type="color" value={draft.background} onChange={e => change({ ...draft, background: e.target.value })} aria-label={t('chart.settings.backgroundCustom')} />}
                </span>
              </div>
              <div className="vcs-row">
                <span>{t('chart.settings.grid')}</span>
                <span className="vcs-colors">
                  <select value={draft.grid} onChange={e => change({ ...draft, grid: e.target.value as ChartGridMode })} aria-label={t('chart.settings.grid')}>
                    {grids.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
                  </select>
                  <input type="color" value={draft.gridColor} onChange={e => change({ ...draft, gridColor: e.target.value })} aria-label={t('chart.settings.gridColor')} disabled={draft.grid === 'none'} />
                </span>
              </div>
              <div className="vcs-row">
                <span>{t('chart.settings.gridOpacity')}</span>
                <span className="vcs-colors vcs-range">
                  <input type="range" min={10} max={100} step={5} value={Math.round(draft.gridOpacity * 100)} disabled={draft.grid === 'none'} aria-label={t('chart.settings.gridOpacity')} data-setting="grid-opacity"
                    onChange={e => change({ ...draft, gridOpacity: Number(e.target.value) / 100 })} />
                  <output>{Math.round(draft.gridOpacity * 100)}%</output>
                </span>
              </div>
              <div className="vcs-row">
                <span>{t('chart.settings.crosshair')}</span>
                <span className="vcs-colors">
                  <select value={draft.crosshairStyle} aria-label={t('chart.settings.crosshairStyle')} data-setting="crosshair-style" onChange={e => change({ ...draft, crosshairStyle: e.target.value as ChartLineStyle })}>
                    {lineStyles.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
                  </select>
                  <input type="color" value={draft.crosshair} onChange={e => change({ ...draft, crosshair: e.target.value })} aria-label={t('chart.settings.crosshair')} />
                </span>
              </div>
              <label className="vcs-check vcs-line"><input type="checkbox" checked={draft.watermark} onChange={e => change({ ...draft, watermark: e.target.checked })} /><span>{t('chart.settings.watermark')}</span></label>
              <label className="vcs-check vcs-line"><input type="checkbox" checked={draft.indicatorLegend} data-setting="indicator-legend" onChange={e => change({ ...draft, indicatorLegend: e.target.checked })} /><span>{t('chart.settings.indicatorLegend')}</span></label>
              <p className="vcs-cap">{t('chart.settings.volume')}</p>
              <label className="vcs-check vcs-line"><input type="checkbox" checked={draft.volume} onChange={e => change({ ...draft, volume: e.target.checked })} /><span>{t('chart.settings.volume')}</span></label>
              <div className="vcs-row">
                <span>{t('chart.settings.volumeOpacity')}</span>
                <span className="vcs-colors vcs-range">
                  <input type="range" min={20} max={100} step={5} value={Math.round(draft.volumeOpacity * 100)} disabled={!draft.volume} aria-label={t('chart.settings.volumeOpacity')} data-setting="volume-opacity"
                    onChange={e => change({ ...draft, volumeOpacity: Number(e.target.value) / 100 })} />
                  <output>{Math.round(draft.volumeOpacity * 100)}%</output>
                </span>
              </div>
            </>}
            {tab === 'indicators' && <>
              <p className="vcs-cap">{t('chart.settings.indicatorsActive')}</p>
              {indicators.length === 0 && <p className="vcs-hint">{t('chart.settings.indicatorsEmpty')}</p>}
              {indicators.map(inst => {
                const def = indicatorDefinition(inst.type);
                const name = indicatorInstanceLabel(inst);
                return (
                  <div className="vcs-indicator" key={inst.id} data-indicator-row={inst.id}>
                    <div className="vcs-indicator-head">
                      <label className="vcs-check">
                        <input type="checkbox" checked={inst.visible} aria-label={`${t('chart.settings.indicatorVisible')}: ${name}`} onChange={e => updateIndicator(inst.id, i => ({ ...i, visible: e.target.checked }))} />
                        <b>{name}</b>
                      </label>
                      <small>{def.pane === 'lower' ? t('chart.settings.lowerPane') : t('chart.settings.pricePane')}</small>
                      <button type="button" className="vcs-btn vcs-small" aria-label={`${t('chart.settings.indicatorRemove')}: ${name}`} data-indicator-remove={inst.id} onClick={() => changeIndicators(indicators.filter(i => i.id !== inst.id))}>{t('chart.settings.indicatorRemove')}</button>
                    </div>
                    <div className="vcs-indicator-body">
                      {def.params.map(param => (
                        <label className="vcs-field" key={param.key}>
                          <span>{label(param.label)}</span>
                          <input type="number" min={param.min} max={param.max} step={param.step} value={inst.params[param.key]} aria-label={`${name}: ${label(param.label)}`} data-indicator-param={`${inst.id}:${param.key}`}
                            onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v)) updateIndicator(inst.id, i => ({ ...i, params: { ...i.params, [param.key]: v } })); }} />
                        </label>
                      ))}
                      <label className="vcs-field">
                        <span>{t('chart.settings.lineWidth')}</span>
                        <select value={inst.lineWidth} aria-label={`${name}: ${t('chart.settings.lineWidth')}`} onChange={e => updateIndicator(inst.id, i => ({ ...i, lineWidth: Number(e.target.value) as IndicatorLineWidth }))}>
                          {[1, 2, 3, 4].map(w => <option key={w} value={w}>{w} px</option>)}
                        </select>
                      </label>
                      {def.lines.map((line, index) => (
                        <label className="vcs-field vcs-field-color" key={line.key}>
                          <span>{label(line.label)}</span>
                          <input type="color" value={inst.colors[index]} aria-label={`${name}: ${label(line.label)} — ${t('chart.settings.indicatorColor')}`} data-indicator-color={`${inst.id}:${line.key}`}
                            onChange={e => updateIndicator(inst.id, i => ({ ...i, colors: i.colors.map((c, k) => (k === index ? e.target.value : c)) }))} />
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
              <p className="vcs-cap">{t('chart.settings.indicatorsCatalogue')}</p>
              <input type="search" className="vcs-search" value={query} placeholder={t('chart.settings.indicatorSearch')} aria-label={t('chart.settings.indicatorSearch')} onChange={e => setQuery(e.target.value)} />
              {indicators.length >= MAX_CHART_INDICATORS && <p className="vcs-hint">{t('chart.settings.indicatorsMax')}</p>}
              <div className="vcs-catalogue">
                {catalogue.length === 0 && <p className="vcs-hint">{t('chart.settings.indicatorNoMatch')}</p>}
                {catalogue.map(def => (
                  <button key={def.type} type="button" className="vcs-catalogue-item" data-indicator-add={def.type} disabled={indicators.length >= MAX_CHART_INDICATORS}
                    onClick={() => changeIndicators([...indicators, newIndicatorInstance(def.type as IndicatorType)])}>
                    <span className="vcs-swatch" aria-hidden="true"><i style={{ background: def.lines[0].color, width: 14, height: 3, marginTop: 10 }} /></span>
                    <b>{def.short}</b><small>{t(def.label as never)}</small>
                    <em>{def.pane === 'lower' ? t('chart.settings.lowerPane') : t('chart.settings.pricePane')}</em>
                  </button>
                ))}
              </div>
            </>}
          </div>
        </div>
        <div className="vcs-foot">
          <button type="button" className="vcs-btn" onClick={reset}>{t('chart.settings.reset')}</button>
          <span className="vcs-grow" />
          <button type="button" className="vcs-btn" onClick={cancel}>{t('chart.settings.cancel')}</button>
          <button type="button" className="vcs-btn vcs-ok" onClick={ok}>{t('chart.settings.ok')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
