import { ReactNode, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightIcon } from 'lucide-react';
import { CryptoIcon } from '../../components/CryptoIcon';
import { HomeMarket, formatCompactUsd, formatPriceValue } from './useHomeMarket';
import { useLanguage } from '../../lib/i18n';

/**
 * Five market panels. Each reads its own source and shows its own state,
 * so one upstream being down never blanks the row.
 *
 * Nothing here is a hardcoded figure. Where the prototype shipped demo
 * values (72 / $2.46T / $89.45B / sector performance / CFD quotes) this
 * reads the exchange's real endpoints, and where a source genuinely has
 * nothing to give it says so rather than showing a plausible number.
 */
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex h-full flex-col rounded-[8px] border border-white/6 bg-ink-850 p-4">
      <h3 className="mb-3 text-[13px] font-semibold text-white">{title}</h3>
      <div className="flex flex-1 flex-col">{children}</div>
    </section>
  );
}

function Unavailable({ label }: { label: string }) {
  return <div className="flex flex-1 items-center justify-center py-6 text-center text-[11.5px] text-faint">{label}</div>;
}

function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex-1 space-y-2.5 py-1">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-[13px] animate-pulse rounded bg-white/5" />
      ))}
    </div>
  );
}

/** Half-circle gauge, coloured in the conventional fear→greed ramp. */
function Gauge({ value }: { value: number }) {
  const r = 52;
  const cx = 68;
  const cy = 62;
  const clamped = Math.max(0, Math.min(100, value));
  const angle = Math.PI * (1 - clamped / 100);
  const px = cx + r * Math.cos(angle);
  const py = cy - r * Math.sin(angle);
  const segments = [
    ['#f0616d', 0, 0.2],
    ['#e0863f', 0.2, 0.4],
    ['#e0c23f', 0.4, 0.6],
    ['#9ccb4a', 0.6, 0.8],
    ['#2ebd85', 0.8, 1],
  ] as const;
  const arc = (from: number, to: number) => {
    const a0 = Math.PI * (1 - from);
    const a1 = Math.PI * (1 - to);
    return `M ${cx + r * Math.cos(a0)} ${cy - r * Math.sin(a0)} A ${r} ${r} 0 0 1 ${cx + r * Math.cos(a1)} ${cy - r * Math.sin(a1)}`;
  };
  return (
    <svg viewBox="0 0 136 78" className="w-[136px]" aria-hidden="true">
      {segments.map(([color, from, to]) => (
        <path key={color} d={arc(from, to)} stroke={color} strokeWidth="9" fill="none" strokeLinecap="butt" />
      ))}
      <circle cx={px} cy={py} r="4.5" fill="#ffffff" stroke="#05070a" strokeWidth="2" />
    </svg>
  );
}

const SECTOR_LABELS: { key: string; label: string; color: string; glyph: string }[] = [
  { key: 'LAYER1', label: 'Layer 1', color: '#f0c45a', glyph: 'L' },
  { key: 'DEFI', label: 'DeFi', color: '#7fb0ff', glyph: 'D' },
  { key: 'AI', label: 'AI', color: '#8fc9dd', glyph: 'A' },
  { key: 'MEME', label: 'Meme', color: '#e0863f', glyph: 'M' },
  { key: 'GAMING', label: 'Gaming', color: '#9ccb4a', glyph: 'G' },
];

export function HomeMarketOverview({ market }: { market: HomeMarket }) {
  const { t } = useLanguage();
  const fg = market.fearGreed;
  const g = market.global;

  // Sector performance is derived, not invented: each coin's real 24h
  // change averaged within the category the ranking feed already assigns
  // it. A category with nothing behind it is simply not listed.
  const sectors = useMemo(() => {
    if (market.rankings.length === 0) return [];
    return SECTOR_LABELS.map((s) => {
      const members = market.rankings.filter(
        (r) => r.categories?.includes(s.key) && typeof r.changePercent24h === 'number'
      );
      if (members.length === 0) return null;
      const avg = members.reduce((sum, r) => sum + (r.changePercent24h ?? 0), 0) / members.length;
      return { ...s, change: avg, count: members.length };
    }).filter(Boolean) as (typeof SECTOR_LABELS[number] & { change: number; count: number })[];
  }, [market.rankings]);

  // "Trending" = biggest real 24h movers among liquid USDT markets, so the
  // list reflects the session rather than a fixed set.
  const trending = useMemo(
    () =>
      market.tickers
        .filter((t) => t.quote === 'USDT' && t.quoteVolume > 1_000_000)
        .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
        .slice(0, 5),
    [market.tickers]
  );

  return (
    <div className="mx-auto grid w-full max-w-[1460px] grid-cols-1 items-stretch gap-3 px-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {/* 1 — Fear & Greed (real) */}
      <Panel title={t('home.overview.fearGreed')}>
        {market.globalStatus === 'loading' ? (
          <Skeleton rows={3} />
        ) : fg ? (
          <>
            <div className="flex flex-1 flex-col items-center justify-center">
              <div className="relative">
                <Gauge value={fg.value} />
                <div className="absolute inset-x-0 bottom-0 text-center">
                  <div className="text-[28px] font-bold leading-none tabular-nums text-white">{fg.value}</div>
                  <div className="text-[11px] text-home-muted">{fg.classification}</div>
                </div>
              </div>
            </div>
            <div className="mt-auto border-t border-white/6 pt-3 text-[11px] text-faint">
              {t('home.overview.updated')}: {new Date(fg.updatedAt * 1000).toLocaleDateString()}
            </div>
          </>
        ) : (
          <Unavailable label={t('home.dataUnavailable')} />
        )}
      </Panel>

      {/* 2 — Global market (real) */}
      <Panel title={t('home.overview.global')}>
        {market.globalStatus === 'loading' ? (
          <Skeleton />
        ) : g ? (
          <div className="space-y-3">
            <div className="border-b border-white/6 pb-3">
              <div className="text-[11px] text-faint">{t('home.overview.marketCap')}</div>
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[17px] font-semibold tabular-nums text-white">
                  {formatCompactUsd(g.totalMarketCapUsd)}
                </span>
                {g.marketCapChangePercent24h !== null && (
                  <span
                    className={`font-mono text-[11.5px] tabular-nums ${g.marketCapChangePercent24h >= 0 ? 'text-up' : 'text-down'}`}
                  >
                    {g.marketCapChangePercent24h >= 0 ? '+' : ''}
                    {g.marketCapChangePercent24h.toFixed(2)}%
                  </span>
                )}
              </div>
            </div>
            <div className="border-b border-white/6 pb-3">
              <div className="text-[11px] text-faint">{t('markets.volume24h')}</div>
              <div className="font-mono text-[17px] font-semibold tabular-nums text-white">
                {formatCompactUsd(g.totalVolume24hUsd)}
              </div>
            </div>
            <div className="flex items-center justify-between text-[11.5px]">
              <span className="text-home-muted">BTC Dominance</span>
              <span className="font-mono tabular-nums text-white/85">
                {g.btcDominancePercent !== null ? `${g.btcDominancePercent.toFixed(1)}%` : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11.5px]">
              <span className="text-home-muted">ETH Dominance</span>
              <span className="font-mono tabular-nums text-white/85">
                {g.ethDominancePercent !== null ? `${g.ethDominancePercent.toFixed(1)}%` : '—'}
              </span>
            </div>
          </div>
        ) : (
          <Unavailable label={t('home.dataUnavailable')} />
        )}
      </Panel>

      {/* 3 — Sectors (derived from real per-coin 24h changes) */}
      <Panel title={t('home.overview.sectors')}>
        {market.rankingsStatus === 'loading' ? (
          <Skeleton />
        ) : sectors.length === 0 ? (
          <Unavailable label={t('home.dataUnavailable')} />
        ) : (
          <ul className="space-y-[9px]">
            {sectors.map((s) => (
              <li key={s.key} className="flex items-center gap-2">
                <span
                  className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-ink-950"
                  style={{ backgroundColor: s.color }}
                >
                  {s.glyph}
                </span>
                <span className="text-[12px] text-white/85">{s.label}</span>
                <span className={`ml-auto font-mono text-[11.5px] tabular-nums ${s.change >= 0 ? 'text-up' : 'text-down'}`}>
                  {s.change >= 0 ? '+' : ''}
                  {s.change.toFixed(2)}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* 4 — Trending pairs (real movers) */}
      <Panel title={t('home.overview.trending')}>
        {market.tickersStatus === 'loading' ? (
          <Skeleton />
        ) : trending.length === 0 ? (
          <Unavailable label={t('home.dataUnavailable')} />
        ) : (
          <ul className="space-y-[9px]">
            {trending.map((p) => (
              <li key={p.pair} className="flex items-center gap-2">
                <CryptoIcon symbol={p.base} size={20} imageUrl={market.logoOf(p.base)} />
                <span className="text-[12px] text-white/85">{p.base}</span>
                <span className="ml-auto font-mono text-[11.5px] tabular-nums text-white/85">
                  {formatPriceValue(p.price)}
                </span>
                <span
                  className={`w-14 text-right font-mono text-[11.5px] tabular-nums ${p.change >= 0 ? 'text-up' : 'text-down'}`}
                >
                  {p.change >= 0 ? '+' : ''}
                  {p.change.toFixed(2)}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* 5 — CFD. Only actionable when the product is actually configured
              on this deployment; otherwise it states that plainly instead
              of showing quotes that do not exist. */}
      <Panel title={t('home.overview.cfd')}>
        {market.cfdStatus === 'loading' ? (
          <Skeleton />
        ) : market.cfd && market.cfd.configured && market.cfd.tickers.length > 0 ? (
          <>
            <ul className="space-y-[10px]">
              {market.cfd.tickers.slice(0, 5).map((a) => {
                const chg = parseFloat(a.changePercent24h);
                return (
                  <li key={a.symbol} className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#2f6fd0]/30 text-[9px] font-bold text-[#9fc4ff]">
                      {a.name.slice(0, 1)}
                    </span>
                    <div className="min-w-0 leading-tight">
                      <div className="truncate text-[11.5px] text-white/85">{a.name}</div>
                      <div className="font-mono text-[11px] tabular-nums text-faint">{a.price}</div>
                    </div>
                    <span
                      className={`ml-auto font-mono text-[11.5px] tabular-nums ${Number.isFinite(chg) && chg >= 0 ? 'text-up' : 'text-down'}`}
                    >
                      {Number.isFinite(chg) ? `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%` : '—'}
                    </span>
                  </li>
                );
              })}
            </ul>
            <Link
              to="/trade?market=cfd"
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md border border-[#2f6fd0]/60 bg-[#2f6fd0]/10 py-[9px] text-[12px] font-medium text-[#7fb0ff] transition-colors duration-150 hover:bg-[#2f6fd0]/20"
            >
              {t('home.overview.tradeCfd')}
              <ArrowRightIcon size={13} />
            </Link>
          </>
        ) : (
          <Unavailable label={t('home.cfdSoon')} />
        )}
      </Panel>
    </div>
  );
}
