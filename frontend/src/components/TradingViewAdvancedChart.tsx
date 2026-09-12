import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '../lib/i18n';
import './TradingViewAdvancedChart.css';

type TerminalMarket = 'spot' | 'futures' | 'cfd';
interface TradingViewAdvancedChartProps {
  pair: string;
  market?: TerminalMarket;
  chrome?: 'default' | 'terminal';
  drawingTools?: boolean;
}
const TV_LOCALE: Record<string, string> = { en: 'en', ru: 'ru', zh: 'zh_CN', es: 'es', ja: 'ja', ko: 'ko', hi: 'en' };
// Verified CFD mappings. Unmapped instruments have no substitute chart.
const CFD_SYMBOLS: Record<string, string> = {
  XAUUSD: 'OANDA:XAUUSD',
  XAGUSD: 'OANDA:XAGUSD',
  XPTUSD: 'OANDA:XPTUSD',
  XPDUSD: 'OANDA:XPDUSD',
  WTIUSD: 'OANDA:WTICOUSD',
  XBRUSD: 'OANDA:BCOUSD',
  EURUSD: 'FX:EURUSD',
  GBPUSD: 'FX:GBPUSD',
  USDJPY: 'FX:USDJPY',
  AUDUSD: 'FX:AUDUSD',
  USDCAD: 'FX:USDCAD',
  USDCHF: 'FX:USDCHF',
  NZDUSD: 'FX:NZDUSD',
};
export function toTradingViewSymbol(pair: string, market: TerminalMarket = 'spot'): string | null {
  const compact = pair.toUpperCase().replace(/\//g, '');
  if (!/^[A-Z0-9]+$/.test(compact)) return null;
  if (market === 'cfd') return CFD_SYMBOLS[compact] ?? null;
  return `BYBIT:${compact}${market === 'futures' ? '.P' : ''}`;
}
function ChartUnavailable({ retry }: { retry?: () => void }) {
  const { t } = useLanguage();
  return <div className="terminal-chart-unavailable" role="status">
    <strong>{t('trade.cfdChartUnavailable')}</strong>
    <p>{t('trade.cfdChartUnavailableHint')}</p>
    {retry && <button type="button" onClick={retry}>{t('trade.cfdChartRetry')}</button>}
  </div>;
}
function TradingViewEmbed({ symbol, locale }: {
  symbol: string; locale: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let active = true;
    setFailed(false);
    // Fresh ownership even during StrictMode effect replay. A late async script
    // can only append to its detached subtree, never to the next chart's host.
    const owned = document.createElement('div');
    owned.className = 'tradingview-widget-container voltex-tradingview-chart__owned';
    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget voltex-tradingview-chart__widget';
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.dataset.voltexTradingview = 'advanced-chart';
    script.text = JSON.stringify({
      autosize: true, symbol, interval: '15', timezone: 'Etc/UTC', theme: 'dark',
      backgroundColor: '#0d141d', gridColor: '#0e151e', style: '1', locale,
      hide_side_toolbar: false, hide_top_toolbar: false, hide_legend: true,
      hide_volume: false, allow_symbol_change: false, withdateranges: true,
      save_image: false, calendar: false, details: false, hotlist: false,
      watchlist: [], compareSymbols: [], studies: [],
      show_popup_button: false, support_host: 'https://www.tradingview.com',
    });
    script.onerror = () => { if (active) setFailed(true); };
    owned.append(widget, script);
    host.replaceChildren(owned);
    const timeout = window.setTimeout(() => {
      if (active && !owned.querySelector('iframe')) setFailed(true);
    }, 15000);
    return () => {
      active = false;
      window.clearTimeout(timeout);
      script.onerror = null;
      owned.querySelectorAll('iframe').forEach(frame => { frame.src = 'about:blank'; frame.remove(); });
      owned.replaceChildren();
      owned.remove();
    };
  }, [symbol, locale, attempt]);
  return <div className="voltex-tradingview-chart__plot">
    <div className="voltex-tradingview-chart__embed" ref={hostRef} />
    {failed && <ChartUnavailable retry={() => setAttempt(n => n + 1)} />}
  </div>;
}
function TradingViewAdvancedChartImpl({ pair, market = 'spot' }: TradingViewAdvancedChartProps) {
  const { lang } = useLanguage();
  const symbol = useMemo(() => toTradingViewSymbol(pair, market), [pair, market]);
  const locale = TV_LOCALE[lang] ?? 'en';
  const ticker = market === 'cfd' ? pair.toUpperCase().replace(/^([A-Z]{3})([A-Z]{3})$/, '$1/$2') : pair.toUpperCase();
  return <div className="voltex-tradingview-chart" data-market={market} data-symbol={symbol}>
    {/* Timeframe, indicators and drawings belong to the native widget.
        Its cross-origin state cannot be mirrored honestly in a parent label. */}
    {symbol ? <TradingViewEmbed key={`${symbol}:${locale}`} symbol={symbol} locale={locale} />
      : <div className="voltex-tradingview-chart__plot"><ChartUnavailable /></div>}
    <div className="tradingview-widget-copyright voltex-tradingview-chart__copyright">
      <a href={symbol ? `https://www.tradingview.com/symbols/${encodeURIComponent(symbol.replace(':', '-'))}/` : 'https://www.tradingview.com/'} rel="noopener nofollow" target="_blank">{ticker} chart</a>
      <span> by TradingView</span>
    </div>
  </div>;
}
export const TradingViewAdvancedChart = memo(TradingViewAdvancedChartImpl);
