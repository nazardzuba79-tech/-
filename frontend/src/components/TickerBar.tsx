import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useLanguage, localeOf, Lang } from '../lib/i18n';
import { CryptoIcon } from './CryptoIcon';
import { Badge } from './Badge';
import { parseChangePercent } from '../lib/priceChange';
import { btcTurnover } from '../lib/turnover';
import { useCoinGeckoStats } from '../lib/useCoinGeckoStats';

interface Stats {
  lastPrice: number;
  changePercent: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  quoteVolume24h: number;
}

/** Bybit/Binance-style stats strip: live Kraken ticker data (real 24h high/low/volume/turnover, not something we approximate from our own thin trade history). */
export function TickerBar({ pair }: { pair: string }) {
  const { t, lang } = useLanguage();
  const [stats, setStats] = useState<Stats | null>(null);
  const [btcUsdtPrice, setBtcUsdtPrice] = useState<number | null>(null);
  const [fundingRate, setFundingRate] = useState<number | null>(null);
  const [baseAsset, quoteAsset] = pair.split('/');
  const geckoStats = useCoinGeckoStats(baseAsset);
  const globalVolumeUsd = geckoStats?.volume24h ?? null;

  useEffect(() => {
    let cancelled = false;
    function load() {
      api
        .getExternalTicker(pair)
        .then((res) => {
          if (cancelled) return;
          const tk = res.ticker;
          setStats({
            lastPrice: parseFloat(tk.lastPrice),
            changePercent: parseChangePercent(tk.changePercent24h, pair),
            high24h: parseFloat(tk.high24h),
            low24h: parseFloat(tk.low24h),
            volume24h: parseFloat(tk.volume24h),
            quoteVolume24h: parseFloat(tk.quoteVolume24h),
          });
        })
        .catch(() => {});
      // Needed both to express turnover in BTC for a non-BTC pair (see
      // btcTurnover()) and to convert the global USD volume below into BTC
      // terms — fetched unconditionally since either use needs it.
      api
        .getExternalTicker('BTC/USDT')
        .then((res) => {
          if (!cancelled) setBtcUsdtPrice(parseFloat(res.ticker.lastPrice));
        })
        .catch(() => {});
      // Real funding-rate history exists only for pairs with an actual
      // futures market (FUTURES_SYMBOLS on the backend) — for every other
      // spot pair this just comes back with an empty history, which we
      // show as '—' rather than fabricating a rate for a market that
      // doesn't exist.
      api
        .getFuturesFundingRate(pair, 1)
        .then((res) => {
          if (cancelled) return;
          const latest = res.history[0];
          setFundingRate(latest ? parseFloat(latest.rate) : null);
        })
        .catch(() => {
          if (!cancelled) setFundingRate(null);
        });
    }
    load();
    const interval = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pair, baseAsset, quoteAsset]);

  const positive = (stats?.changePercent ?? 0) >= 0;

  return (
    <div style={styles.bar}>
      <div style={styles.pairBlock}>
        <CryptoIcon symbol={baseAsset} size={28} />
        <span style={styles.pairName} className="mono">
          {pair}
        </span>
        <span className={`mono ${positive ? 'text-buy' : 'text-sell'}`} style={styles.lastPrice}>
          {stats ? stats.lastPrice.toLocaleString(localeOf(lang), { maximumFractionDigits: 2 }) : '—'}
        </span>
        {stats && (
          <Badge
            text={`${positive ? '+' : ''}${stats.changePercent.toFixed(2)}%`}
            color={positive ? 'var(--buy)' : 'var(--sell)'}
            bg={positive ? 'var(--buy-dim)' : 'var(--sell-dim)'}
          />
        )}
      </div>

      <div style={styles.divider} />

      <Stat label={t('trade.high24h')} value={stats ? stats.high24h.toLocaleString(localeOf(lang), { maximumFractionDigits: 2 }) : '—'} />
      <Stat label={t('trade.low24h')} value={stats ? stats.low24h.toLocaleString(localeOf(lang), { maximumFractionDigits: 2 }) : '—'} />
      <Stat label={`${t('trade.volume24h')} (${baseAsset})`} value={stats ? stats.volume24h.toLocaleString(localeOf(lang), { maximumFractionDigits: 2 }) : '—'} />
      <Stat
        label={`${t('trade.turnover24h')} (${globalVolumeUsd !== null ? 'USD' : quoteAsset})`}
        value={(() => {
          // Prefer CoinGecko's global 24h volume (real, aggregated across
          // every exchange it tracks) — our own Kraken mirror only reflects
          // Kraken's own liquidity for this one pair, which reads
          // unrealistically small (millions, not billions) for a major coin.
          // Falls back to the pair's own Kraken turnover when the asset
          // isn't in CoinGecko's top-200 or the rankings fetch failed.
          if (globalVolumeUsd !== null) return formatCompact(globalVolumeUsd, lang);
          return stats ? formatCompact(stats.quoteVolume24h, lang) : '—';
        })()}
      />
      <Stat
        label={`${t('trade.turnover24h')} (BTC)`}
        value={(() => {
          if (globalVolumeUsd !== null && btcUsdtPrice) return formatCompact(globalVolumeUsd / btcUsdtPrice, lang);
          if (!stats) return '—';
          const btc = btcTurnover({ baseAsset, quoteAsset, volume24h: stats.volume24h, quoteVolume24h: stats.quoteVolume24h, btcUsdtPrice });
          return btc !== null ? formatCompact(btc, lang) : '—';
        })()}
      />
      <Stat
        label={t('futures.fundingRate')}
        value={fundingRate !== null ? `${(fundingRate * 100).toFixed(4)}%` : '—'}
        color={fundingRate !== null ? (fundingRate >= 0 ? 'var(--buy)' : 'var(--sell)') : undefined}
      />
      <Stat
        label={t('wallet.marketCap')}
        value={geckoStats?.marketCap != null ? formatCompact(geckoStats.marketCap, lang) : '—'}
      />
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={styles.stat}>
      <span style={styles.statLabel}>{label}</span>
      <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: color ?? 'var(--text-primary)' }}>
        {value}
      </span>
    </div>
  );
}

function formatCompact(n: number, lang: Lang): string {
  return n.toLocaleString(localeOf(lang), { notation: 'compact', maximumFractionDigits: 2 });
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 28,
    padding: '12px 20px',
    background: 'var(--panel)',
    flexShrink: 0,
    overflowX: 'auto',
  },
  pairBlock: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  divider: {
    width: 1,
    height: 28,
    background: 'var(--border)',
    flexShrink: 0,
  },
  pairName: { fontSize: 16, fontWeight: 800, fontFamily: 'var(--font-display)' },
  lastPrice: { fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em' },
  stat: { display: 'flex', flexDirection: 'column', gap: 3, whiteSpace: 'nowrap' },
  statLabel: { fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 },
};
