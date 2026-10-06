import type { ListingPreview } from './adminListingsApi';

const price = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 10 });
const time = (value: number) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(value * 1000);

/** Presentation only: every OHLC value comes from the saved server configuration. */
export function ListingCandlePreview({ candles }: { candles: ListingPreview['candles'] }) {
  if (!candles.length) return <p className="listing-muted">Свечей ещё нет — рынок до листинга.</p>;
  const width = Math.max(720, candles.length * 4 + 112), left = 20, right = width - 100;
  const low = Math.min(...candles.map(c => c.low)), high = Math.max(...candles.map(c => c.high));
  const span = high - low || high * 0.01 || 1;
  const y = (value: number) => 26 + (high - value) / span * 226;
  const step = (right - left) / candles.length;
  return <div className="listing-candle-scroll" tabIndex={0} aria-label="Свечной предпросмотр сохранённых настроек">
    <svg width={width} height={300} viewBox={`0 0 ${width} 300`} role="img" aria-label="Свечи с тенями из общего генератора" data-server-candle-chart>
      <rect width={width} height={300} fill="#fff" />
      {[0, 1, 2, 3, 4].map(i => <g key={i}>
        <line x1={left} x2={right} y1={y(high - span * i / 4)} y2={y(high - span * i / 4)} stroke="#edf0f4" />
        <text x={right + 10} y={y(high - span * i / 4) + 4} fill="#64748b" fontSize="11">{price(high - span * i / 4)}</text>
      </g>)}
      {candles.map((c, i) => {
        const x = left + step * (i + 0.5), color = c.close >= c.open ? '#14836a' : '#cf495c';
        return <g key={c.time} data-server-candle={c.time}>
          <title>{`${time(c.time)} UTC. Открытие: ${price(c.open)}; максимум: ${price(c.high)}; минимум: ${price(c.low)}; закрытие: ${price(c.close)}. Модельный объём: ${price(c.volume)}.`}</title>
          <line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={color} />
          <rect x={x - step * .31} y={Math.min(y(c.open), y(c.close))} width={Math.max(1, step * .62)} height={Math.max(1, Math.abs(y(c.open) - y(c.close)))} fill={color} />
          {i % Math.max(1, Math.ceil(candles.length / 5)) === 0 && <text x={x} y={281} fill="#64748b" fontSize="10">{time(c.time)}</text>}
        </g>;
      })}
    </svg>
  </div>;
}
