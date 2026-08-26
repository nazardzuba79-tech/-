import { useEffect, useRef } from 'react';
import { useLanguage } from '../lib/i18n';
import { parseChangePercent } from '../lib/priceChange';
import type { CfdTickerRow } from './CfdInstrumentList';

// TradingView's own symbol for each instrument — real forex/commodity data
// providers (OANDA/FX), not something we proxy or pay for.
const TV_SYMBOL_BY_CFD: Record<string, string> = {
  XAUUSD: 'OANDA:XAUUSD',
  EURUSD: 'FX:EURUSD',
  GBPUSD: 'FX:GBPUSD',
  USDJPY: 'FX:USDJPY',
  AUDUSD: 'FX:AUDUSD',
  USDCAD: 'FX:USDCAD',
};

const TV_LOCALE: Record<string, string> = { ru: 'ru', en: 'en', zh: 'zh_CN' };

let tvScriptPromise: Promise<void> | null = null;
function loadTradingViewScript(): Promise<void> {
  if (typeof window !== 'undefined' && (window as any).TradingView) return Promise.resolve();
  if (!tvScriptPromise) {
    tvScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://s3.tradingview.com/tv.js';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load TradingView widget script'));
      document.head.appendChild(script);
    });
  }
  return tvScriptPromise;
}

/**
 * Real CFD chart via TradingView's free embedded widget instead of our own
 * candlestick pipeline — Twelve Data's free plan charges per-symbol credits
 * against an 8-credits/minute budget (see CfdMarketDataService's
 * CFD_INSTRUMENTS doc comment), and adding a whole separate /time_series
 * poll on top of the ticker poll kept eating into that same budget for a
 * feature TradingView already gives away for free, with far broader real
 * coverage (metals, forex, indices, oil) than our own quota could ever
 * support. This widget runs entirely in the visitor's browser straight
 * against TradingView's CDN — it never touches our backend or our Twelve
 * Data key at all, so it can't affect the ticker/order-form budget either.
 */
export function CfdChart({ symbol, ticker }: { symbol: string; ticker: CfdTickerRow | undefined }) {
  const { t, lang } = useLanguage();
  const containerId = useRef(`tv-cfd-${Math.random().toString(36).slice(2)}`).current;
  const widgetRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    const tvSymbol = TV_SYMBOL_BY_CFD[symbol];
    if (!tvSymbol) return;

    loadTradingViewScript().then(() => {
      if (cancelled) return;
      const container = document.getElementById(containerId);
      const TV = (window as any).TradingView;
      if (!container || !TV) return;
      container.innerHTML = '';
      widgetRef.current = new TV.widget({
        symbol: tvSymbol,
        interval: '60',
        container_id: containerId,
        autosize: true,
        theme: 'dark',
        style: '1',
        locale: TV_LOCALE[lang] ?? 'en',
        timezone: 'Etc/UTC',
        toolbar_bg: '#000000',
        hide_side_toolbar: true,
        allow_symbol_change: false,
        withdateranges: true,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [symbol, lang, containerId]);

  const change = ticker ? parseChangePercent(ticker.changePercent24h, ticker.symbol) : 0;
  const positive = change >= 0;

  return (
    <div style={styles.wrapper}>
      <div style={styles.topBar}>
        <span className="mono" style={styles.symbol}>
          {ticker?.symbol ?? symbol}
        </span>
        {ticker && (
          <>
            <span className="mono" style={styles.price}>
              {ticker.price}
            </span>
            <span className={`mono ${positive ? 'text-buy' : 'text-sell'}`} style={styles.change}>
              {positive ? '+' : ''}
              {change.toFixed(2)}%
            </span>
          </>
        )}
      </div>

      <div style={styles.chartArea} id={containerId} />

      <p style={styles.disclaimer}>{t('trade.cfdPriceDisclaimer')}</p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: { flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--panel)', overflow: 'hidden', minHeight: 300 },
  topBar: { display: 'flex', alignItems: 'baseline', gap: 10, padding: '10px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0, flexWrap: 'wrap' },
  symbol: { fontSize: 13, fontWeight: 800, letterSpacing: '0.03em' },
  price: { fontSize: 18, fontWeight: 800 },
  change: { fontSize: 13, fontWeight: 700 },
  chartArea: { flex: 1, position: 'relative', minWidth: 0, minHeight: 300 },
  disclaimer: { fontSize: 10, color: 'var(--text-tertiary)', textAlign: 'center', margin: 0, padding: '6px 12px', borderTop: '1px solid var(--border)' },
};
