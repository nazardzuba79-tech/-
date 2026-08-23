import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useLanguage, localeOf } from '../lib/i18n';
import { CryptoIcon } from './CryptoIcon';
import { parseChangePercent } from '../lib/priceChange';
import { btcTurnover } from '../lib/turnover';
import { useCoinGeckoStats } from '../lib/useCoinGeckoStats';

/** Mark Price shown deliberately separate from Last Price (per the futures
 * spec) — mark price is what PnL/liquidation are computed off, last price
 * is just the most recent external trade print. Showing both side by side
 * makes that distinction visible instead of implicit. */
export function FuturesTickerBar({ symbol }: { symbol: string }) {
  const { t, lang } = useLanguage();
  const [baseAsset] = symbol.split('/');
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [changePercent, setChangePercent] = useState<number>(0);
  const [markPrice, setMarkPrice] = useState<number | null>(null);
  const [indexPrice, setIndexPrice] = useState<number | null>(null);
  const [fundingRate, setFundingRate] = useState<number | null>(null);
  const [volume24h, setVolume24h] = useState<number | null>(null);
  const [quoteVolume24h, setQuoteVolume24h] = useState<number | null>(null);
  const [btcUsdtPrice, setBtcUsdtPrice] = useState<number | null>(null);
  const [, quoteAsset] = symbol.split('/');
  const geckoStats = useCoinGeckoStats(baseAsset);
  const globalVolumeUsd = geckoStats?.volume24h ?? null;

  useEffect(() => {
    let cancelled = false;
    function load() {
      api
        .getExternalTicker(symbol)
        .then((res) => {
          if (cancelled) return;
          setLastPrice(parseFloat(res.ticker.lastPrice));
          setChangePercent(parseChangePercent(res.ticker.changePercent24h, symbol));
          setVolume24h(parseFloat(res.ticker.volume24h));
          setQuoteVolume24h(parseFloat(res.ticker.quoteVolume24h));
        })
        .catch(() => {});
      api
        .getFuturesMarkPrice(symbol)
        .then((res) => {
          if (cancelled) return;
          setMarkPrice(parseFloat(res.markPrice));
          setIndexPrice(parseFloat(res.indexPrice));
        })
        .catch(() => {});
      api
        .getFuturesFundingRate(symbol, 1)
        .then((res) => {
          if (cancelled) return;
          const latest = res.history[0];
          setFundingRate(latest ? parseFloat(latest.rate) : null);
        })
        .catch(() => {});
      // Same real-BTC-price-based conversion as the spot TickerBar — see
      // btcTurnover() and useCoinGeckoStats() — fetched unconditionally
      // since converting the global USD volume into BTC terms needs it too.
      api
        .getExternalTicker('BTC/USDT')
        .then((res) => {
          if (!cancelled) setBtcUsdtPrice(parseFloat(res.ticker.lastPrice));
        })
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [symbol, baseAsset, quoteAsset]);

  const positive = changePercent >= 0;
  const fmt = (n: number | null) => (n !== null ? n.toLocaleString(localeOf(lang), { maximumFractionDigits: 2 }) : '—');
  const fmtCompact = (n: number | null) =>
    n !== null ? n.toLocaleString(localeOf(lang), { notation: 'compact', maximumFractionDigits: 2 }) : '—';
  // Prefer CoinGecko's global 24h volume (real, aggregated across every
  // exchange it tracks) — this contract's own Kraken-mirrored turnover only
  // reflects Kraken's own liquidity for one pair, which reads unrealistically
  // small (millions, not billions) for a major coin. Falls back to the pair's
  // own Kraken turnover when the asset isn't in CoinGecko's top-200.
  const turnoverUsd = globalVolumeUsd ?? quoteVolume24h;
  const turnoverUsdLabel = globalVolumeUsd !== null ? 'USD' : quoteAsset;
  const turnoverBtc =
    globalVolumeUsd !== null && btcUsdtPrice
      ? globalVolumeUsd / btcUsdtPrice
      : volume24h !== null && quoteVolume24h !== null
        ? btcTurnover({ baseAsset, quoteAsset, volume24h, quoteVolume24h, btcUsdtPrice })
        : null;

  return (
    <div style={styles.bar}>
      <div style={styles.pairBlock}>
        <CryptoIcon symbol={baseAsset} size={28} />
        <span style={styles.pairName} className="mono">
          {symbol}
        </span>
        <span className={`mono ${positive ? 'text-buy' : 'text-sell'}`} style={styles.lastPrice}>
          {fmt(lastPrice)}
        </span>
        <span className={positive ? 'text-buy' : 'text-sell'} style={{ fontSize: 12, fontWeight: 700 }}>
          {lastPrice !== null ? `${positive ? '+' : ''}${changePercent.toFixed(2)}%` : ''}
        </span>
      </div>
      <div style={styles.divider} />
      <Stat label={t('trade.price')} value={`${fmt(lastPrice)}`} />
      <Stat label={t('futures.markPrice')} value={fmt(markPrice)} />
      <Stat label={t('futures.indexPrice')} value={fmt(indexPrice)} />
      <Stat
        label={`${t('trade.turnover24h')} (${turnoverUsdLabel})`}
        value={fmtCompact(turnoverUsd)}
      />
      <Stat label={`${t('trade.turnover24h')} (BTC)`} value={fmtCompact(turnoverBtc)} />
      <Stat
        label={t('futures.fundingRate')}
        value={fundingRate !== null ? `${(fundingRate * 100).toFixed(4)}%` : '—'}
        color={fundingRate !== null ? (fundingRate >= 0 ? 'var(--buy)' : 'var(--sell)') : undefined}
      />
      <Stat label={t('wallet.marketCap')} value={geckoStats?.marketCap != null ? fmtCompact(geckoStats.marketCap) : '—'} />
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

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 28,
    padding: '12px 20px',
    borderBottom: '1px solid var(--border)',
    background: 'linear-gradient(180deg, var(--panel) 0%, var(--panel-alt) 100%)',
    flexShrink: 0,
    overflowX: 'auto',
  },
  pairBlock: { display: 'flex', alignItems: 'center', gap: 12 },
  divider: { width: 1, height: 28, background: 'var(--border)', flexShrink: 0 },
  pairName: { fontSize: 16, fontWeight: 800, fontFamily: 'var(--font-display)' },
  lastPrice: { fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em' },
  stat: { display: 'flex', flexDirection: 'column', gap: 3, whiteSpace: 'nowrap' },
  statLabel: { fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 },
};
