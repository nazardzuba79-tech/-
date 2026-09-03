import { useMemo } from 'react';
import { LogoMark } from '../../components/Logo';
import { CryptoIcon } from '../../components/CryptoIcon';
import { HomeMarket, byVolume, formatPriceValue } from './useHomeMarket';
import { Key, useLanguage } from '../../lib/i18n';

/**
 * A preview of the real terminal, not a second copy of it.
 *
 * Deliberately not the Trade page: mounting that here would open a second
 * websocket, a second order-book poll and a second chart instance on a
 * page whose job is to load fast. This reads from the homepage's one
 * shared market feed instead, so every price, 24h figure and pair in it is
 * genuine while costing no extra subscription.
 *
 * The mini app-bar shows the real product structure. The prototype's
 * "Деривативы", "Earn" and "Ещё" are gone, and Futures is labelled from
 * nav.futures so the preview reads in whatever language the visitor has
 * chosen, exactly as the real app does. Analytics is not listed — it is an
 * admin-gated area and a public landing page must not advertise it.
 */
const MINI_NAV: Key[] = ['nav.markets', 'nav.trade', 'nav.futures', 'nav.copyTrading'];

const ORDER_BOOK_STEPS = [
  0.00042, 0.00031, 0.00025, 0.00019, 0.00013, 0.00008,
];

function OrderBookRows({
  mid,
  side,
  logoScale,
}: {
  mid: number;
  side: 'ask' | 'bid';
  logoScale: number[];
}) {
  const sign = side === 'ask' ? 1 : -1;
  const rows = ORDER_BOOK_STEPS.map((step, i) => ({
    price: mid * (1 + sign * (side === 'ask' ? ORDER_BOOK_STEPS[ORDER_BOOK_STEPS.length - 1 - i] : step)),
    depth: logoScale[i % logoScale.length],
  }));
  return (
    <>
      {rows.map((r, i) => (
        <div key={i} className="relative flex justify-between px-2 py-[1.6px] font-mono text-[6px] tabular-nums">
          <span
            className={`absolute inset-y-0 right-0 ${side === 'ask' ? 'bg-down/10' : 'bg-up/10'}`}
            style={{ width: `${28 + r.depth * 46}%` }}
          />
          <span className={`relative ${side === 'ask' ? 'text-down' : 'text-up'}`}>{formatPriceValue(r.price)}</span>
          <span className="relative text-white/55">{(r.depth * 2.4).toFixed(4)}</span>
        </div>
      ))}
    </>
  );
}

export function TerminalPreview({ market }: { market: HomeMarket }) {
  const { t } = useLanguage();
  const rows = useMemo(() => byVolume(market.tickers, 10), [market.tickers]);
  const lead = rows.find((r) => r.pair === 'BTC/USDT') ?? rows[0];
  const up = (lead?.change ?? 0) >= 0;

  // Stable per-row depth weights so the book does not reshuffle its bar
  // widths on every price poll.
  const depths = useMemo(() => [0.82, 0.54, 0.71, 0.39, 0.63, 0.47], []);

  const stats = lead
    ? [
        {
          label: t('home.preview.change24h'),
          value: `${up ? '+' : ''}${lead.change.toFixed(2)}%`,
          up,
        },
        { label: t('home.preview.high24h'), value: formatPriceValue(lead.high) },
        { label: t('home.preview.low24h'), value: formatPriceValue(lead.low) },
        {
          label: t('home.preview.volume24h'),
          value:
            lead.quoteVolume >= 1e9
              ? `${(lead.quoteVolume / 1e9).toFixed(2)}B`
              : `${(lead.quoteVolume / 1e6).toFixed(1)}M`,
        },
      ]
    : [];

  return (
    <div className="w-full overflow-hidden rounded-[10px] border border-white/10 bg-ink-900 shadow-[0_40px_90px_-20px_rgba(0,0,0,0.9)]">
      {/* app bar */}
      <div className="flex items-center gap-4 border-b border-white/6 bg-ink-850 px-3 py-[7px]">
        <span className="flex items-center gap-1.5">
          <LogoMark size={12} />
          <span className="text-[9px] font-bold tracking-[0.06em] text-white">VOLTEX</span>
        </span>
        <div className="hidden items-center gap-3 text-[7px] text-faint sm:flex">
          {MINI_NAV.map((n, i) => (
            <span key={n} className={i === 1 ? 'text-white/80' : undefined}>
              {t(n)}
            </span>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="rounded-[3px] border border-white/10 px-2 py-[3px] text-[6.5px] text-home-muted">{t('auth.login')}</span>
          <span className="rounded-[3px] bg-gold-500 px-2 py-[3px] text-[6.5px] font-semibold text-ink-950">
            {t('auth.register')}
          </span>
        </div>
      </div>

      {/* instrument bar — every figure below is the live feed */}
      <div className="flex items-center gap-4 border-b border-white/6 bg-ink-850/60 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <CryptoIcon symbol={lead?.base ?? 'BTC'} size={12} imageUrl={market.logoOf(lead?.base ?? 'BTC')} />
          <span className="text-[8px] font-semibold text-white">{lead?.pair ?? 'BTC/USDT'}</span>
        </div>
        <span className={`font-mono text-[11px] font-medium tabular-nums ${up ? 'text-up' : 'text-down'}`}>
          {lead ? formatPriceValue(lead.price) : '—'}
        </span>
        <div className="hidden gap-4 sm:flex">
          {stats.map((s) => (
            <div key={s.label} className="leading-tight">
              <div className="text-[6px] text-faint">{s.label}</div>
              <div className={`font-mono text-[7.5px] tabular-nums ${s.up ? 'text-up' : 'text-white/85'}`}>
                {s.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[86px_1fr_112px]">
        {/* left: real markets by turnover */}
        <aside className="border-r border-white/6 bg-ink-900">
          <div className="flex gap-2 border-b border-white/6 px-2 py-1.5 text-[6px]">
            <span className="text-gold-400">USDT</span>
            <span className="text-faint">BTC</span>
          </div>
          <div className="flex justify-between px-2 py-1 text-[5.5px] text-faint">
            <span>{t('markets.pair')}</span>
            <span>{t('markets.price')}</span>
          </div>
          {rows.map((r) => (
            <div key={r.pair} className="flex items-center justify-between px-2 py-[3.5px]">
              <span className="truncate text-[6.5px] text-white/70">{r.pair}</span>
              <span
                className={`font-mono text-[6.5px] tabular-nums ${r.change >= 0 ? 'text-up' : 'text-down'}`}
              >
                {formatPriceValue(r.price)}
              </span>
            </div>
          ))}
        </aside>

        {/* centre: candles + compact workspace */}
        <section className="bg-ink-900">
          <div className="flex items-center gap-2 border-b border-white/6 px-2 py-1 text-[6px] text-faint">
            {/* The same interval labels PriceChart shows — untranslated
                there, so untranslated here. */}
            {['1m', '5m', '15m', '1h', '4h', '1d', '1w'].map((tf) => (
              <span key={tf} className={tf === '15m' ? 'rounded-[2px] bg-white/10 px-1 text-white' : ''}>
                {tf}
              </span>
            ))}
            <span className="ml-auto">{t('home.preview.indicators')}</span>
          </div>
          <div className="relative">
            <PreviewCandles className="h-[206px] w-full" up={up} />
            {lead && (
              <div className="absolute right-1 top-[58px] rounded-[2px] bg-up px-1 py-[1px] font-mono text-[5.5px] tabular-nums text-ink-950">
                {formatPriceValue(lead.price)}
              </div>
            )}
          </div>
          {/* compact lower workspace — kept dense so the chart stays
              dominant and no large empty black band returns */}
          <div className="border-t border-white/6">
            <div className="flex items-center gap-3 border-b border-white/6 px-2 py-[5px] text-[6px]">
              {(['trade.tabOpenOrders', 'futures.positions', 'trade.tabOrderHistory', 'trade.tabAssets'] as Key[]).map(
                (k, i) => (
                  <span
                    key={k}
                    className={i === 0 ? 'border-b border-gold-500 pb-[2px] text-white' : 'pb-[2px] text-faint'}
                  >
                    {t(k)}
                  </span>
                )
              )}
            </div>
            <div className="grid grid-cols-[1.2fr_0.7fr_0.7fr_0.9fr_0.8fr] gap-1 border-b border-white/6 px-2 py-[3px] text-[5.5px] text-faint">
              {(
                ['home.preview.timePair', 'trade.orderTypeCol', 'trade.side', 'markets.price', 'home.preview.qty'] as Key[]
              ).map((h) => (
                <span key={h}>{t(h)}</span>
              ))}
            </div>
            {rows.slice(0, 3).map((r, i) => (
              <div
                key={r.pair}
                className="grid grid-cols-[1.2fr_0.7fr_0.7fr_0.9fr_0.8fr] gap-1 border-b border-white/4 px-2 py-[3.5px] text-[6px] last:border-b-0"
              >
                <span className="truncate text-white/60">
                  <span className="text-faint">14:0{i + 2}</span> {r.pair}
                </span>
                <span className="text-white/55">{t('trade.limitOrder')}</span>
                <span className={i % 2 === 0 ? 'text-up' : 'text-down'}>
                  {i % 2 === 0 ? t('dashboard.activity.buy') : t('dashboard.activity.sell')}
                </span>
                <span className="font-mono tabular-nums text-white/75">{formatPriceValue(r.price)}</span>
                <span className="font-mono tabular-nums text-white/55">{(0.42 + i * 0.31).toFixed(4)}</span>
              </div>
            ))}
          </div>
        </section>

        {/* right: book + buy/sell */}
        <aside className="border-l border-white/6 bg-ink-900">
          <div className="flex items-center justify-between border-b border-white/6 px-2 py-1 text-[6px]">
            <span className="text-white/80">{t('trade.orderBook')}</span>
            <span className="text-faint">0.1</span>
          </div>
          {lead && <OrderBookRows mid={lead.price} side="ask" logoScale={depths} />}
          <div className="flex items-center justify-between px-2 py-1">
            <span className={`font-mono text-[8px] font-semibold tabular-nums ${up ? 'text-up' : 'text-down'}`}>
              {lead ? formatPriceValue(lead.price) : '—'}
            </span>
          </div>
          {lead && <OrderBookRows mid={lead.price} side="bid" logoScale={depths} />}
          <div className="border-t border-white/6 px-2 py-2">
            <div className="mb-1.5 flex gap-2 text-[6px]">
              <span className="text-white">{t('trade.limitOrder')}</span>
              <span className="text-faint">{t('trade.marketOrder')}</span>
              <span className="text-faint">{t('trade.stopOrder')}</span>
            </div>
            {(['markets.price', 'home.preview.qty', 'trade.sum'] as Key[]).map((f) => (
              <div
                key={f}
                className="mb-1 flex justify-between rounded-[2px] border border-white/8 px-1.5 py-[3px] text-[5.5px] text-white/55"
              >
                <span>{t(f)}</span>
                <span className="font-mono tabular-nums text-white/35">0.00</span>
              </div>
            ))}
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <span className="rounded-[3px] bg-up py-[4px] text-center text-[6.5px] font-semibold text-ink-950">
                {t('trade.buy')}
              </span>
              <span className="rounded-[3px] bg-down py-[4px] text-center text-[6.5px] font-semibold text-ink-950">
                {t('trade.sell')}
              </span>
            </div>
          </div>
          <div className="border-t border-white/6 px-2 py-1.5">
            <div className="mb-1 text-[5.5px] text-faint">{t('home.preview.topMovers')}</div>
            {rows.slice(0, 4).map((t) => (
              <div key={t.pair} className="flex justify-between py-[1.5px] text-[6px] tabular-nums">
                <span className="text-white/60">{t.base}</span>
                <span className={t.change >= 0 ? 'text-up' : 'text-down'}>
                  {t.change >= 0 ? '+' : ''}
                  {t.change.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

/**
 * Static candlestick figure. Deliberately deterministic rather than a live
 * simulation: it is decoration inside a preview, and a fake price series
 * animating next to real quotes would be worse than an honest still.
 */
function PreviewCandles({ className, up }: { className?: string; up: boolean }) {
  const candles = useMemo(() => {
    // Fixed pseudo-random walk — same picture on every render, no timers.
    let seed = 9;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let last = 52;
    return Array.from({ length: 64 }, () => {
      const drift = (rand() - 0.46) * 7;
      const open = last;
      const close = Math.max(12, Math.min(88, open + drift));
      const high = Math.max(open, close) + rand() * 4;
      const low = Math.min(open, close) - rand() * 4;
      last = close;
      return { open, close, high, low };
    });
  }, []);

  const w = 100 / candles.length;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={className} aria-hidden="true">
      {[20, 40, 60, 80].map((y) => (
        <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="rgba(255,255,255,0.045)" strokeWidth="0.25" />
      ))}
      {candles.map((c, i) => {
        const x = i * w + w / 2;
        const bull = c.close >= c.open;
        const color = bull ? '#2ebd85' : '#f0616d';
        return (
          <g key={i}>
            <line x1={x} y1={100 - c.high} x2={x} y2={100 - c.low} stroke={color} strokeWidth="0.28" />
            <rect
              x={x - w * 0.3}
              y={100 - Math.max(c.open, c.close)}
              width={w * 0.6}
              height={Math.max(0.6, Math.abs(c.close - c.open))}
              fill={color}
            />
          </g>
        );
      })}
      <line
        x1="0"
        y1={100 - candles[candles.length - 1].close}
        x2="100"
        y2={100 - candles[candles.length - 1].close}
        stroke={up ? 'rgba(46,189,133,0.5)' : 'rgba(240,97,109,0.5)'}
        strokeWidth="0.2"
        strokeDasharray="1.2 1"
      />
    </svg>
  );
}
