import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../lib/i18n';
import {
  CHART_PRESETS, DEFAULT_CHART_SETTINGS, getSavedChartSettings, previewChartSettings, revertChartSettings, saveChartSettings, withPreset,
  type ChartColorPreset, type ChartGridMode, type ChartSettings,
} from '../lib/chartSettings';
import './ChartSettingsDialog.css';

type Tab = 'candles' | 'look' | 'scales';

/**
 * The chart's «Настройки» dialog, laid out as the reference's TradingView
 * one: a section list on the left, the section on the right, «Сбросить»,
 * «Отмена» and «Ок» along the foot. Every change paints the chart at once;
 * «Отмена», Esc, the close button and a click outside put back what was
 * saved, «Ок» keeps the draft in this browser.
 */
export function ChartSettingsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<Tab>('candles');
  const [draft, setDraft] = useState<ChartSettings>(() => ({ ...getSavedChartSettings() }));
  const boxRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<Element | null>(typeof document === 'undefined' ? null : document.activeElement);

  const change = (next: ChartSettings) => { setDraft(next); previewChartSettings(next); };
  const set = <K extends keyof ChartSettings>(key: K, value: ChartSettings[K]) => {
    const colour = /Up$|Down$/.test(String(key));
    change({ ...draft, [key]: value, ...(colour ? { preset: 'custom' as ChartColorPreset } : {}) });
  };
  const cancel = () => { revertChartSettings(); onClose(); };
  const ok = () => { saveChartSettings(draft); onClose(); };

  useEffect(() => {
    boxRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      (openerRef.current as HTMLElement | null)?.focus?.();
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
  const tabs: [Tab, string][] = [['candles', t('chart.settings.tab.candles')], ['look', t('chart.settings.tab.look')], ['scales', t('chart.settings.tab.scales')]];

  return createPortal(
    <div className="vx-chart-settings" onMouseDown={e => { if (e.target === e.currentTarget) cancel(); }}>
      <div className="vcs-box" ref={boxRef} role="dialog" aria-modal="true" aria-labelledby="vcs-title">
        <div className="vcs-head">
          <h2 id="vcs-title">{t('chart.settings.title')}</h2>
          <button type="button" className="vcs-close" onClick={cancel} aria-label={t('chart.settings.cancel')}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="vcs-body">
          <div className="vcs-nav" role="tablist" aria-orientation="vertical">
            {tabs.map(([key, label]) => (
              <button key={key} type="button" role="tab" id={`vcs-tab-${key}`} aria-controls={`vcs-pane-${key}`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1}
                onClick={() => setTab(key)}
                onKeyDown={e => {
                  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                  e.preventDefault();
                  const i = tabs.findIndex(([k]) => k === tab), next = tabs[(i + (e.key === 'ArrowDown' ? 1 : tabs.length - 1)) % tabs.length][0];
                  setTab(next); boxRef.current?.querySelector<HTMLElement>(`#vcs-tab-${next}`)?.focus();
                }}>{label}</button>
            ))}
          </div>
          <div className="vcs-pane" role="tabpanel" id={`vcs-pane-${tab}`} aria-labelledby={`vcs-tab-${tab}`}>
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
              {parts.map(([key, label]) => (
                <div className="vcs-row" key={key}>
                  <label className="vcs-check">
                    <input type="checkbox" checked={draft[key]} disabled={key !== 'wick' && draft[key] && !draft[key === 'body' ? 'border' : 'body']}
                      onChange={e => set(key, e.target.checked)} />
                    <span>{label}</span>
                  </label>
                  <span className="vcs-colors">
                    <input type="color" value={draft[`${key}Up`]} onChange={e => set(`${key}Up`, e.target.value)} aria-label={`${label}: ${t('chart.settings.up')}`} title={t('chart.settings.up')} />
                    <input type="color" value={draft[`${key}Down`]} onChange={e => set(`${key}Down`, e.target.value)} aria-label={`${label}: ${t('chart.settings.down')}`} title={t('chart.settings.down')} />
                  </span>
                </div>
              ))}
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
                    {grids.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                  <input type="color" value={draft.gridColor} onChange={e => change({ ...draft, gridColor: e.target.value })} aria-label={t('chart.settings.gridColor')} disabled={draft.grid === 'none'} />
                </span>
              </div>
              <div className="vcs-row">
                <span>{t('chart.settings.crosshair')}</span>
                <span className="vcs-colors"><input type="color" value={draft.crosshair} onChange={e => change({ ...draft, crosshair: e.target.value })} aria-label={t('chart.settings.crosshair')} /></span>
              </div>
              <label className="vcs-check vcs-line"><input type="checkbox" checked={draft.watermark} onChange={e => change({ ...draft, watermark: e.target.checked })} /><span>{t('chart.settings.watermark')}</span></label>
            </>}
            {tab === 'scales' && <>
              <p className="vcs-cap">{t('chart.settings.show')}</p>
              <label className="vcs-check vcs-line"><input type="checkbox" checked={draft.volume} onChange={e => change({ ...draft, volume: e.target.checked })} /><span>{t('chart.settings.volume')}</span></label>
              <label className="vcs-check vcs-line"><input type="checkbox" checked={draft.lastPriceLine} onChange={e => change({ ...draft, lastPriceLine: e.target.checked })} /><span>{t('chart.settings.lastPrice')}</span></label>
            </>}
          </div>
        </div>
        <div className="vcs-foot">
          <button type="button" className="vcs-btn" onClick={() => change({ ...DEFAULT_CHART_SETTINGS })}>{t('chart.settings.reset')}</button>
          <span className="vcs-grow" />
          <button type="button" className="vcs-btn" onClick={cancel}>{t('chart.settings.cancel')}</button>
          <button type="button" className="vcs-btn vcs-ok" onClick={ok}>{t('chart.settings.ok')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
