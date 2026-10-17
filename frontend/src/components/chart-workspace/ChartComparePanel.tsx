import { useMemo, useState } from 'react';
import { ICONS } from './chartWorkspaceIcons';
import { COMPARE_COLORS, MAX_COMPARE_SERIES, formatPercent } from '../../lib/chartCompare';
import type { CompareEntry, ComparePeriod } from '../../lib/chartWorkspace';
import type { Key } from '../../lib/i18n';
import type { ChartMarket } from '../../lib/chartCapabilities';

export type CompareStatus = 'loading' | 'ok' | 'failed';

export interface ChartComparePanelProps {
  market: ChartMarket;
  mainPair: string;
  entries: CompareEntry[];
  period: ComparePeriod;
  status: Record<string, CompareStatus>;
  /** Last percentage of each line (the main pair too), when computed. */
  last: Record<string, number | null>;
  baseTime: number | null;
  instruments: string[];
  onAdd: (pair: string) => void;
  onRemove: (pair: string) => void;
  onToggle: (pair: string) => void;
  onPeriod: (period: ComparePeriod) => void;
  onExit: () => void;
  t: (key: Key, params?: Record<string, string | number>) => string;
  lang: string;
  close: () => void;
}

const PERIODS: ComparePeriod[] = ['visible', 'all', '1d', '1w', '1M'];

/** The «Сравнить» menu body: instrument search, the compared list, the period and the way out. */
export function ChartComparePanel({ market, mainPair, entries, period, status, last, baseTime, instruments, onAdd, onRemove, onToggle, onPeriod, onExit, t, lang, close }: ChartComparePanelProps) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toUpperCase().replace(/\s+/g, '');
  const taken = new Set([mainPair, ...entries.map(e => e.pair)]);
  const results = useMemo(() => {
    const pool = instruments.filter(p => !taken.has(p));
    const matched = needle ? pool.filter(p => p.replace('/', '').includes(needle)) : pool;
    return matched.slice(0, 8);
  }, [instruments, needle, mainPair, entries]);
  const full = entries.length >= MAX_COMPARE_SERIES;
  const baseText = baseTime ? new Date(baseTime * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : null;
  return (
    <div className="cw-compare" data-cw-compare>
      <div className="cw-search">
        <input type="search" value={query} placeholder={t('chart.ws.compare.search')} aria-label={t('chart.ws.compare.search')} autoComplete="off" spellCheck={false}
          data-cw-compare-search disabled={full} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && results[0] && !full) { onAdd(results[0]); setQuery(''); } }} />
      </div>
      {full && <p className="cw-hint">{t('chart.ws.compare.max', { n: MAX_COMPARE_SERIES })}</p>}
      {!full && (
        <div className="cw-compare-results" role="listbox" aria-label={t('chart.ws.compare.search')}>
          {results.length === 0 && <p className="cw-hint">{t('chart.ws.compare.noMatch')}</p>}
          {results.map(pair => (
            <button key={pair} type="button" role="option" aria-selected={false} className="cw-item" data-cw-compare-option={pair} onClick={() => { onAdd(pair); setQuery(''); }}>
              <span className="cw-item-label">{pair}</span>
              <span className="cw-item-hint">{t(market === 'spot' ? 'chart.ws.compare.spot' : market === 'cfd' ? 'chart.ws.compare.cfd' : 'chart.ws.compare.futures')}</span>
              <span className="cw-item-tick" aria-hidden="true">{ICONS.plus}</span>
            </button>
          ))}
        </div>
      )}
      <div className="cw-section">
        <div className="cw-section-title">{t('chart.ws.compare.active', { n: entries.length })}</div>
        <div className="cw-compare-row is-main">
          <span className="cw-swatch" style={{ background: '#f0b90b' }} aria-hidden="true" />
          <span className="cw-item-label">{mainPair}</span>
          <span className="cw-item-hint">{t('chart.ws.compare.main')}</span>
          <span className="cw-compare-value" data-cw-compare-value={mainPair}>{formatPercent(last[mainPair] ?? null, lang)}</span>
        </div>
        {entries.length === 0 && <p className="cw-hint">{t('chart.ws.compare.empty', { n: MAX_COMPARE_SERIES })}</p>}
        {entries.map((entry, i) => (
          <div key={entry.pair} className={`cw-compare-row${entry.visible ? '' : ' is-hidden'}`} data-cw-compare-entry={entry.pair}>
            <span className="cw-swatch" style={{ background: entry.color || COMPARE_COLORS[i % COMPARE_COLORS.length] }} aria-hidden="true" />
            <span className="cw-item-label">{entry.pair}</span>
            <span className="cw-item-hint">{status[entry.pair] === 'loading' ? t('chart.ws.compare.loading') : status[entry.pair] === 'failed' ? t('chart.ws.compare.failed', { pair: entry.pair }) : ''}</span>
            <span className="cw-compare-value" data-cw-compare-value={entry.pair}>{formatPercent(last[entry.pair] ?? null, lang)}</span>
            <button type="button" className="cw-icon-button" aria-pressed={entry.visible} aria-label={`${entry.pair}: ${t(entry.visible ? 'chart.ws.compare.hide' : 'chart.ws.compare.show')}`} title={t(entry.visible ? 'chart.ws.compare.hide' : 'chart.ws.compare.show')} data-cw-compare-toggle={entry.pair} onClick={() => onToggle(entry.pair)}>{entry.visible ? ICONS.eye : ICONS.eyeOff}</button>
            <button type="button" className="cw-icon-button is-remove" aria-label={`${entry.pair}: ${t('chart.ws.compare.remove')}`} title={t('chart.ws.compare.remove')} data-cw-compare-remove={entry.pair} onClick={() => onRemove(entry.pair)}>{ICONS.close}</button>
          </div>
        ))}
      </div>
      <div className="cw-section">
        <div className="cw-section-title">{t('chart.ws.compare.period')}</div>
        <div className="cw-chips" role="group" aria-label={t('chart.ws.compare.period')}>
          {PERIODS.map(p => <button key={p} type="button" className={`cw-chip${period === p ? ' active' : ''}`} aria-pressed={period === p} data-cw-compare-period={p} onClick={() => onPeriod(p)}>{t(`chart.ws.period.${p}` as Key)}</button>)}
        </div>
        <p className="cw-hint">{t('chart.ws.compare.scale')}{baseText ? ` · ${t('chart.ws.compare.base', { time: baseText })}` : ''}</p>
      </div>
      {entries.length > 0 && (
        <div className="cw-actions">
          <button type="button" className="cw-button is-primary" data-cw-compare-exit onClick={() => { onExit(); close(); }}>{t('chart.ws.compare.exit')}</button>
        </div>
      )}
    </div>
  );
}
