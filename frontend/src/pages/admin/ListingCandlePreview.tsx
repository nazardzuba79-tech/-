import type { ListingPreview } from './adminListingsApi';

const price = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 10 });
const time = (value: number) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(value * 1000);

/** Source observations only. Connecting points does not assert an intraday price path. */
export function ListingReferencePreview({ points }: { points: readonly { time: number; value: number }[] }) {
  if (!points.length) return <p className="listing-muted">Опорных цен нет.</p>;
  const width = 720, left = 20, right = width - 100;
  const low = Math.min(...points.map(p => p.value)), high = Math.max(...points.map(p => p.value));
  const span = high - low || high * .01 || 1;
  const x = (i: number) => left + (right - left) * i / Math.max(1, points.length - 1);
  const y = (v: number) => 26 + (high - v) / span * 226;
  return <div className="listing-candle-scroll" tabIndex={0} aria-label="Опорные цены за сутки; горизонтальная прокрутка графика">
    <svg width={width} height={300} viewBox={`0 0 ${width} 300`} role="img" data-historical-reference-chart
      aria-label="Дневные опорные цены: без исторических OHLC и внутрисуточных наблюдений">
      <rect width={width} height={300} fill="#fff" />
      {[0, 1, 2, 3, 4].map(i => <g key={i}>
        <line x1={left} x2={right} y1={y(high - span * i / 4)} y2={y(high - span * i / 4)} stroke="#edf0f4" />
        <text x={right + 10} y={y(high - span * i / 4) + 4} fill="#64748b" fontSize="11">{price(high - span * i / 4)}</text>
      </g>)}
      <polyline points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')} fill="none" stroke="#14836a" />
      {points.map((p, i) => <g key={p.time}>
        <circle cx={x(i)} cy={y(p.value)} r={1.4} fill="#14836a" data-reference-point={p.time}>
          <title>{`${time(p.time)} UTC. Опорная цена: ${price(p.value)} SIMUSDT. OHLC и объём отсутствуют.`}</title>
        </circle>
        {i % Math.max(1, Math.ceil(points.length / 5)) === 0 && <text x={x(i)} y={281} fill="#64748b" fontSize="10">{time(p.time)}</text>}
      </g>)}
    </svg>
  </div>;
}

/** Presentation only: every OHLC value comes from the saved server configuration. */
export function ListingCandlePreview({ candles, plan = false }: {
  candles: ListingPreview['candles'];
  /** Candles drawn from a historical plan's relative moves, not by the server generator. */
  plan?: boolean;
}) {
  if (!candles.length) return <p className="listing-muted">Свечей ещё нет — рынок до листинга.</p>;
  const width = Math.max(720, candles.length * 4 + 112), left = 20, right = width - 100;
  const low = Math.min(...candles.map(c => c.low)), high = Math.max(...candles.map(c => c.high));
  const span = high - low || high * 0.01 || 1;
  const y = (value: number) => 26 + (high - value) / span * 226;
  const step = (right - left) / candles.length;
  return <div className="listing-candle-scroll" tabIndex={0} aria-label={plan ? 'Дневные свечи исторического отрезка' : 'Свечной предпросмотр сохранённых настроек'}>
    <svg width={width} height={300} viewBox={`0 0 ${width} 300`} role="img" aria-label={plan ? 'Дневные свечи по относительным часовым движениям источника, без модельных теней' : 'Свечи с тенями из общего генератора'}
      {...(plan ? { 'data-historical-plan-chart': '' } : { 'data-server-candle-chart': '' })}>
      <rect width={width} height={300} fill="#fff" />
      {[0, 1, 2, 3, 4].map(i => <g key={i}>
        <line x1={left} x2={right} y1={y(high - span * i / 4)} y2={y(high - span * i / 4)} stroke="#edf0f4" />
        <text x={right + 10} y={y(high - span * i / 4) + 4} fill="#64748b" fontSize="11">{price(high - span * i / 4)}</text>
      </g>)}
      {candles.map((c, i) => {
        const x = left + step * (i + 0.5), color = c.close >= c.open ? '#14836a' : '#cf495c';
        return <g key={c.time} {...(plan ? { 'data-plan-candle': c.time } : { 'data-server-candle': c.time })}>
          <title>{`${time(c.time)} UTC. Открытие: ${price(c.open)}; максимум: ${price(c.high)}; минимум: ${price(c.low)}; закрытие: ${price(c.close)}. ${plan ? '' : `Модельный объём: ${price(c.volume)}.`}`}</title>
          <line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={color} />
          <rect x={x - step * .31} y={Math.min(y(c.open), y(c.close))} width={Math.max(1, step * .62)} height={Math.max(1, Math.abs(y(c.open) - y(c.close)))} fill={color} />
          {i % Math.max(1, Math.ceil(candles.length / 5)) === 0 && <text x={x} y={281} fill="#64748b" fontSize="10">{time(c.time)}</text>}
        </g>;
      })}
    </svg>
  </div>;
}
