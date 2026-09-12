import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '../lib/i18n';

// TradingView's own symbol for each instrument — real forex/commodity data
// providers (OANDA/FX), not something we proxy or pay for.
const TV_SYMBOL_BY_CFD: Record<string, string> = {
  XAUUSD: 'OANDA:XAUUSD',
  XAGUSD: 'OANDA:XAGUSD',
  XPTUSD: 'OANDA:XPTUSD',
  XPDUSD: 'OANDA:XPDUSD',
  WTIUSD: 'OANDA:WTICOUSD',
  XBRUSD: 'OANDA:BCOUSD',
  USDCHF: 'FX:USDCHF',
  NZDUSD: 'FX:NZDUSD',
  EURUSD: 'FX:EURUSD',
  GBPUSD: 'FX:GBPUSD',
  USDJPY: 'FX:USDJPY',
  AUDUSD: 'FX:AUDUSD',
  USDCAD: 'FX:USDCAD',
};

const TV_LOCALE: Record<string, string> = { ru: 'ru', en: 'en', zh: 'zh_CN' };

const TV_SCRIPT_SRC = 'https://s3.tradingview.com/tv.js';

/**
 * The in-flight (or already resolved) script load, shared by every caller.
 *
 * It is deliberately NOT kept once the load fails. A rejected promise cached
 * here is a permanently poisoned module: every later attempt — a retry, a
 * symbol change, a remount — re-reads the same old failure and never issues
 * a request, so the chart could not come back without a full page reload.
 * It is cleared in `onerror`, BEFORE the rejection is delivered, so the next
 * caller starts one new request.
 */
let tvScriptPromise: Promise<void> | null = null;

function loadTradingViewScript(): Promise<void> {
  // Already on the page (a previous load in this document, or another
  // widget): reuse it, and never insert a second tag for it.
  if (typeof window !== 'undefined' && (window as any).TradingView) return Promise.resolve();
  // A load already under way — including one a concurrent retry just
  // started. Callers join it rather than racing a second <script> against it.
  if (tvScriptPromise) return tvScriptPromise;

  tvScriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TV_SCRIPT_SRC;
    script.async = true;

    /** Both ways this can go wrong, so the two cannot drift apart: forget
     *  the promise FIRST, drop the dead tag, then reject. The caller is
     *  told the same thing either way — the chart is not available — and
     *  nothing about which of the two happened reaches the UI. */
    const fail = () => {
      tvScriptPromise = null;
      script.parentNode?.removeChild(script);
      reject(new Error('Failed to load TradingView widget script'));
    };

    script.onload = () => {
      // A `load` event only says the bytes arrived. If the script's own
      // execution threw, or it simply did not publish the global, then
      // resolving here would cache a promise that is permanently useless:
      // every later Retry would be handed that resolved promise, find no
      // `window.TradingView`, and fall straight back to the error state
      // without ever issuing a request. So the global is what decides.
      if (typeof window !== 'undefined' && (window as any).TradingView) resolve();
      else fail();
    };
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return tvScriptPromise;
}

/** What the chart area is currently showing. Derived from what actually
 *  happened, never from a placeholder value standing in for real data. */
type ChartStatus = 'loading' | 'ready' | 'error';

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
 *
 * Which is exactly why it can fail on its own: if that CDN is unreachable
 * the widget never arrives, and before this the `.then()` had no `.catch()`,
 * so the rejection surfaced as an uncaught page error and the chart area sat
 * empty with nothing to explain it. It now says so and offers to try again.
 * There is no second data path: when TradingView is unavailable this
 * component renders a message, never a chart drawn from substituted candles.
 */
export function CfdChart({ symbol }: { symbol: string }) {
  const { t, lang } = useLanguage();
  const containerId = useRef(`tv-cfd-${Math.random().toString(36).slice(2)}`).current;
  const widgetRef = useRef<any>(null);
  const [status, setStatus] = useState<ChartStatus>('loading');
  /** Bumped by Retry. It is an effect dependency, so a retry re-runs the
   *  same load path rather than needing a second one of its own. */
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setStatus('loading');
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tvSymbol = TV_SYMBOL_BY_CFD[symbol];
    if (!tvSymbol) { setStatus('error'); return; }
    setStatus('loading');

    loadTradingViewScript()
      .then(() => {
        // The effect was cleaned up while the script was in the air. Nothing
        // is constructed and no state is set after unmount.
        if (cancelled) return;
        const container = document.getElementById(containerId);
        const TV = (window as any).TradingView;
        if (!container || !TV) {
          setStatus('error');
          return;
        }
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
        setStatus('ready');
      })
      // Covers both the script failing to load and the widget constructor
      // throwing. Either way the answer is the same: say the chart is not
      // available. Nothing here inspects or surfaces the error itself.
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
      try { widgetRef.current?.remove?.(); } catch { /* Already detached by provider. */ }
      widgetRef.current = null;
      const container = document.getElementById(containerId);
      if (container) container.innerHTML = '';
    };
  }, [symbol, lang, containerId, attempt]);

  return (
    <div className="cfd-chart">
      {/* No loading state is painted: on the normal path TradingView draws
          into this container itself, and covering it first would change what
          a working chart looks like. Only the failure has something to say. */}
      {(status === 'error' || !TV_SYMBOL_BY_CFD[symbol]) ? (
        <div className="cfd-chart-fallback" role="status">
          <strong className="cfd-chart-fallback-title">{t('trade.cfdChartUnavailable')}</strong>
          <p className="cfd-chart-fallback-text">{t('trade.cfdChartUnavailableHint')}</p>
          <button type="button" className="cfd-chart-retry" onClick={retry}>
            {t('trade.cfdChartRetry')}
          </button>
        </div>
      ) : null}
      <div className="cfd-chart-canvas" id={containerId} hidden={status === 'error' || !TV_SYMBOL_BY_CFD[symbol]} />

      <p className="cfd-disclaimer">{t('trade.cfdPriceDisclaimer')}</p>
    </div>
  );
}
