import type {ReactNode} from 'react'
import {EXCHANGE_KEYS,EXCHANGE_LABEL,EXCHANGE_COLOR,formatPrice,formatUsd,formatDistance,type LiquidityModel} from './liquidityModel'
function Unavailable({label='Недоступно'}:{label?:string}) {return <span className="unavailable">{label}</span>}
export function LiquidityChart({model}:{model:LiquidityModel}) {
  const {asset,basePrice,series,currentIndex,maxTotal,maxCumulative,bucketCount,derived} = model
  const W = 1000
  const H = 320
  const barGap = 1
  const barW = W / bucketCount
  const yFor = (v: number) => H - (v / Math.max(1, maxTotal)) * (H * 0.92)
  const yForCum = (v: number) => H - (v / Math.max(1, maxCumulative)) * (H * 0.86) - H * 0.04
  const xFor = (i: number) => i * barW + barW / 2

  const longPath = series.map((b, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yForCum(b.cumLong)}`).join(' ')
  const shortPath = series.map((b, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yForCum(b.cumShort)}`).join(' ')

  const tickIdx = [0, 1, 2, 3, 4, 5, 6].map((k) => Math.round((k * (bucketCount - 1)) / 6))
  const yTicks = [1, 0.75, 0.5, 0.25, 0].map((f) => Math.round(maxTotal * f))
  const svgMinWidth = Math.max(640, Math.round(bucketCount * 4.1))

  return (
    <div className="liqchart-wrap">
      <div className="liqchart-scale"><span>Объём интервала · до {formatUsd(maxTotal)}</span><span>Кумулятивные кривые · до {formatUsd(maxCumulative)}</span></div>
      <div className="liqchart-scroll" tabIndex={0} role="region" aria-label="Прокручиваемая карта ликвидности">
        <svg data-testid="liquidity-chart" data-buckets={bucketCount} className="liqchart-svg" style={{ minWidth: svgMinWidth }} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Локальная карта ликвидаций ${asset}`}>

          {yTicks.map((t, i) => {
            const y = yFor(t)
            return <line key={i} x1="0" x2={W} y1={y} y2={y} className="liqchart-grid" />
          })}

          {series.map((b, i) => {
            let yOffset = H
            const rects: ReactNode[] = []
            for (const k of EXCHANGE_KEYS) {
              const h = b.exch[k] / Math.max(1,maxTotal) * H * 0.92
              yOffset -= h
              if (h > 0) rects.push(<rect key={k} x={xFor(i)-barW/2+barGap/2} y={yOffset} width={Math.max(.4,barW-barGap)} height={h} fill={EXCHANGE_COLOR[k]} opacity={.88}/>)
            }
            return <g key={i}><title>{formatPrice(asset,b.price)} · Long {formatUsd(b.longLiq)} · Short {formatUsd(b.shortLiq)}</title>{rects}</g>
          })}

          <path d={longPath} className="liqchart-curve long" fill="none" />
          <path d={shortPath} className="liqchart-curve short" fill="none" />

          <line x1={W / 2} x2={W / 2} y1="0" y2={H} className="liqchart-current-line" />

          {derived.voidLabels.map((v) => (
            <g key={`void-${v.index}`} className="liqchart-void-label">
              <text x={xFor(v.index)} y={H - 10} textAnchor="middle">{v.label}</text>
            </g>
          ))}

          {derived.callouts.map((c) => {
            const x = xFor(c.index)
            const barY = yFor(series[c.index].total)
            const labelY = c.up ? Math.max(14, barY - 26) : Math.min(H - 8, barY + 26)
            const textW = c.label.length * 5.6 + 10
            const labelX = Math.min(W-textW/2-4, Math.max(textW/2+4,x))
            return (
              <g key={c.index} className="liqchart-callout">
                <line x1={x} x2={x} y1={barY} y2={labelY + (c.up ? 8 : -8)} />
                <rect x={labelX - textW / 2} y={labelY - 9} width={textW} height={14} rx="2" />
                <text x={labelX} y={labelY + 1} textAnchor="middle">{c.label}</text>
              </g>
            )
          })}
        </svg>

        <div className="liqchart-axis" style={{ position: 'relative', minWidth: svgMinWidth }}>
          {tickIdx.map((i) => (
            <span key={i} style={{ left: `${(i / (bucketCount - 1)) * 100}%` }}>{formatPrice(asset, series[i].price)}</span>
          ))}
        </div>
      </div>

      <div className="liqchart-current-price">Текущая цена: <b>{formatPrice(asset, basePrice)}</b></div>

      <div className="liqchart-legend">
        {EXCHANGE_KEYS.map((k) => (
          <span key={k}><i style={{ background: EXCHANGE_COLOR[k] }} />{EXCHANGE_LABEL[k]}</span>
        ))}
        <span className="sep" />
        <span><i className="curve-dot long" />Кумулятивные Long</span>
        <span><i className="curve-dot short" />Кумулятивные Short</span>
      </div>

      <div className="liq-structure-strip">
        <div className="section-heading"><h3>Ближайшие стены и пустой коридор</h3></div>
        <div className="structure-grid">
          <div className="structure-item">
            <small>Выше цены</small>
            {derived.wallAbove ? (
              <>
                <strong>{formatPrice(asset, series[derived.wallAbove.peakIdx].price)}</strong>
                <b className="positive">{formatDistance(series[derived.wallAbove.peakIdx].pct)}</b>
                <span>{derived.wallAbove.type === 'wall' ? 'Критическая плотность' : 'Высокая плотность'} · {formatUsd(derived.wallAbove.volumeUnits)}</span>
              </>
            ) : <Unavailable label="Нет значимых уровней выше в текущем диапазоне" />}
          </div>
          <div className="structure-item">
            <small>Ниже цены</small>
            {derived.wallBelow ? (
              <>
                <strong>{formatPrice(asset, series[derived.wallBelow.peakIdx].price)}</strong>
                <b className="negative">{formatDistance(series[derived.wallBelow.peakIdx].pct)}</b>
                <span>{derived.wallBelow.type === 'wall' ? 'Критическая плотность' : 'Высокая плотность'} · {formatUsd(derived.wallBelow.volumeUnits)}</span>
              </>
            ) : <Unavailable label="Нет значимых уровней ниже в текущем диапазоне" />}
          </div>
          <div className="structure-item">
            <small>Ближайшая зона низкой ликвидности</small>
            {derived.nearestVoid ? (
              <>
                <strong>{derived.nearestVoid.g.startIdx < currentIndex && derived.nearestVoid.g.endIdx < currentIndex ? 'Ниже цены' : derived.nearestVoid.g.startIdx > currentIndex ? 'Выше цены' : 'У цены'}</strong>
                <b>{derived.nearestVoid.g.startIdx <= currentIndex && derived.nearestVoid.g.endIdx >= currentIndex ? '0.0%' : formatDistance(series[derived.nearestVoid.g.startIdx > currentIndex ? derived.nearestVoid.g.startIdx : derived.nearestVoid.g.endIdx].pct)}</b>
                <span>{formatPrice(asset,series[derived.nearestVoid.g.startIdx].price)} — {formatPrice(asset,series[derived.nearestVoid.g.endIdx].price)}</span>
              </>
            ) : <Unavailable label="Зоны низкой ликвидности не найдены" />}
          </div>
        </div>
      </div>

      <div className="liq-cluster-table">
        <div className="section-heading"><h3>Кластеры ликвидности</h3></div>
        <p className="panel-subnote">Ранжирование соответствует текущему графику карты ликвидаций</p>
        <div className="table-scroll clusters-table">
          <table>
            <thead><tr><th>Цена</th><th>Сторона</th><th>Плотность</th><th>Объём</th><th>Расстояние</th><th>Тип зоны</th></tr></thead>
            <tbody>
              {derived.rankedZones.map((z, i) => (
                <tr key={i}>
                  <td><b>{z.price}</b></td>
                  <td className={z.side === 'Long' ? 'positive' : z.side === 'Short' ? 'negative' : ''}>{z.side}</td>
                  <td>{z.density}</td>
                  <td>{z.volume}</td>
                  <td className={z.distance.startsWith('+') ? 'positive' : 'negative'}>{z.distance}</td>
                  <td>{z.zoneType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="liq-derived-summary">
        <div><small>Long-ликвидность</small><b className="positive">{derived.longSharePct.toFixed(0)}%</b></div>
        <div><small>Short-ликвидность</small><b className="negative">{derived.shortSharePct.toFixed(0)}%</b></div>
        <div><small>Крупнейший кластер</small>{derived.largest ? <b>{formatPrice(asset, series[derived.largest.peakIdx].price)}</b> : <Unavailable />}</div>
        <div><small>Баланс вокруг цены (±2%)</small><b>Выше {derived.balanceAbovePct}% / Ниже {100 - derived.balanceAbovePct}%</b></div>
      </div>
    </div>
  )
}
