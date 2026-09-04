import { useMemo, useState } from 'react';
import { LiquidityChart } from './LiquidityChart';
import { buildLiquidityModel, demoBuckets, DEMO_PRICES, EXCHANGE_KEYS, EXCHANGE_LABEL, PERIOD_OPTIONS, ZOOM_OPTIONS, RANGE_PERCENT, RISK_WEIGHTS, cascadeRisk, formatUsd, formatPrice, formatDistance, type Asset, type ExchangeKey, type PeriodKey, type ZoomKey } from './liquidityModel';

export function LiquidationIntelligence({ asset, demo }: { asset: Asset; demo: boolean }) {
  const [zoom, setZoom] = useState<ZoomKey>('±4%');
  const [period, setPeriod] = useState<PeriodKey>('12Ч');
  const [exchanges, setExchanges] = useState<ExchangeKey[]>([...EXCHANGE_KEYS]);
  const range = RANGE_PERCENT[zoom];
  const buckets = useMemo(() => demo ? demoBuckets(asset, range, period) : [], [asset, range, period, demo]);
  const model = useMemo(() => buildLiquidityModel(buckets, exchanges, asset, DEMO_PRICES[asset], range), [buckets, exchanges, asset, range]);
  const { derived, series } = model;
  const populated = demo && derived.total > 0;
  const wall = (group: typeof derived.wallAbove) => populated && group ? `${formatPrice(asset, series[group.peakIdx].price)} · ${formatDistance(series[group.peakIdx].pct)}` : '—';
  const riskFactors = {
    oi: null, funding: null, imbalance: null,
    concentration: populated ? model.groups.filter(g => g.type === 'wall').reduce((sum, g) => sum + g.volumeUnits, 0) / derived.total * 100 : null,
    volatility: null,
  };
  // Liquidation-side shares are not open-position imbalance. Do not fabricate
  // that input (or OI, funding and volatility) from the histogram.
  const risk = cascadeRisk(riskFactors);
  const riskNames = { oi: 'Open Interest', funding: 'Funding', imbalance: 'Дисбаланс позиций', concentration: 'Концентрация ликвидности', volatility: 'Волатильность' };
  return <>
    <section className="surface liqmap" aria-label="Локальная ликвидность">
      <div className="section-heading liqmap-heading">
        <div><h2>Карта ликвидаций и зоны ликвидности</h2><p>Ближайшие стены, кластеры и пустые коридоры вокруг цены · {asset}</p></div>
        <div className="liqmap-controls">
          <div className="toggle" role="group" aria-label="Диапазон цены">{ZOOM_OPTIONS.map(z => <button key={z} aria-pressed={zoom === z} className={zoom === z ? 'selected' : ''} onClick={() => setZoom(z)}>{z}</button>)}</div>
          <div className="toggle" role="group" aria-label="Период ликвидаций">{PERIOD_OPTIONS.map(p => <button key={p} aria-pressed={period === p} className={period === p ? 'selected' : ''} onClick={() => setPeriod(p)}>{p}</button>)}</div>
        </div>
      </div>
      <fieldset className="exchange-filters"><legend>Биржи</legend>
        <button type="button" onClick={() => setExchanges([...EXCHANGE_KEYS])} disabled={exchanges.length === EXCHANGE_KEYS.length}>Все биржи</button>
        {EXCHANGE_KEYS.map(k => <label key={k}><input type="checkbox" checked={exchanges.includes(k)} onChange={() => setExchanges(prev => prev.includes(k) ? prev.filter(e => e !== k) : [...prev, k])}/>{EXCHANGE_LABEL[k]}</label>)}
        <button type="button" onClick={() => setExchanges([])} disabled={!exchanges.length}>Сбросить</button>
      </fieldset>
      <p className="module-source">Источник данных не подключен{demo ? ' · Демонстрационная модель, не реальные ликвидации' : ''}</p>
      <div className="metric-summary liqmap-summary" aria-live="polite">
        <div><small>Ликвидации {period.toLowerCase()} · в диапазоне</small><strong data-testid="liquidation-total">{demo ? formatUsd(derived.total) : '—'}</strong></div>
        <div><small>Ближайшая стена выше</small><b data-testid="wall-above">{wall(derived.wallAbove)}</b></div>
        <div><small>Ближайшая стена ниже</small><b data-testid="wall-below">{wall(derived.wallBelow)}</b></div>
        <div><small>Видимый диапазон</small><b>±{range}% · {asset}</b></div>
      </div>
      <div className="liqmap-body">{populated ? <LiquidityChart model={model}/> : <div className="analytics-empty" role="status"><strong>{demo ? 'Биржи не выбраны' : 'Источник данных не подключен'}</strong><p>{demo ? 'Выберите хотя бы одну биржу для отображения структуры.' : 'Карта, стены и кластеры появятся после подключения источника ликвидаций. Демонстрационный режим позволяет изучить дизайн и фильтры.'}</p></div>}</div>
      <div className="liq-derived-summary">
        <div><small>Long · {period.toLowerCase()}</small><b className="positive" data-testid="long-total">{demo ? formatUsd(derived.totalLong) : '—'}</b></div>
        <div><small>Short · {period.toLowerCase()}</small><b className="negative" data-testid="short-total">{demo ? formatUsd(derived.totalShort) : '—'}</b></div>
        <div><small>Выбранные биржи</small><b>{exchanges.length} / 5</b></div>
        <div><small>Плотность карты</small><b>{populated ? `${model.bucketCount} ценовых интервалов` : '—'}</b></div>
      </div>
    </section>
    <div className="liq-grid-2">
      <section className="surface"><div className="section-heading"><h2>Распределение Long / Short</h2><span>{period.toLowerCase()} · выбранные биржи</span></div>
        {populated ? <div className="positioning"><div className="position-total"><b className="positive">{derived.longSharePct.toFixed(1)}%</b><span>Long</span><b className="negative">{derived.shortSharePct.toFixed(1)}%</b><span>Short</span></div><div className="split-bar"><i style={{width:`${derived.longSharePct}%`}}/><b style={{width:`${derived.shortSharePct}%`}}/></div><p className="panel-subnote">Доли объёма ликвидаций на карте. Это не соотношение открытых позиций.</p></div> : <div className="analytics-empty compact">Нет данных для выбранного контекста</div>}
      </section>
      <section className="surface"><div className="section-heading"><h2>Риск каскадных ликвидаций</h2><span>Cascade Risk</span></div>
        <div className="pressure-head"><strong>{risk ?? '—'}</strong><span>{risk === null ? 'Недостаточно данных' : '/ 100'}</span></div>
        <div className="risk-factors">{(Object.keys(RISK_WEIGHTS) as (keyof typeof RISK_WEIGHTS)[]).map(k => <div key={k}><span>{riskNames[k]}</span><small>{RISK_WEIGHTS[k] * 100}%</small><b>{riskFactors[k] === null ? '—' : Math.round(riskFactors[k]!)}</b><meter aria-label={riskNames[k]} min={0} max={100} value={riskFactors[k] ?? 0}/></div>)}</div>
        <small className="panel-footnote">Веса: 25 / 20 / 15 / 25 / 15. Для оценки нужны все пять факторов. {demo && 'Концентрация рассчитана из демонстрационной карты.'}</small>
      </section>
    </div>
  </>;
}
