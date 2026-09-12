import { memo, useEffect, useMemo, useRef } from 'react';
import { useLanguage } from '../lib/i18n';
import './TradingViewAdvancedChart.css';

type TerminalMarket = 'spot' | 'futures';

interface TradingViewAdvancedChartProps {
  pair: string;
  market?: TerminalMarket;
  // Kept for drop-in compatibility with the existing PriceChart call sites.
  chrome?: 'default' | 'terminal';
  drawingTools?: boolean;
}

const TV_LOCALE: Record<string, string> = {
  en: 'en',
  ru: 'ru',
  zh: 'zh_CN',
  es: 'es',
  ja: 'ja',
  ko: 'ko',
  hi: 'en',
};

/**
 * TradingView's Bybit symbols are BYBIT:BTCUSDT for spot and
 * BYBIT:BTCUSDT.P for USDT perpetuals. Keep the mapping deterministic and
 * provider-explicit; unknown punctuation is rejected rather than forwarded
 * into the third-party embed configuration.
 */
export function toTradingViewSymbol(pair: string, market: TerminalMarket = 'spot'): string {
  const compact = pair.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!compact) return 'BYBIT:BTCUSDT';
  return `BYBIT:${compact}${market === 'futures' ? '.P' : ''}`;
}

function TradingViewEmbed({ symbol, locale }: { symbol: string; locale: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // The official embed script is async. Reusing the same DOM host while
    // rapidly changing symbols can let an older script finish late and append
    // another iframe next to the current one. This child is keyed by
    // symbol+locale, so every change gets a fresh host; any late old script
    // can only render into a detached node and can never stack charts onscreen.
    host.replaceChildren();

    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget voltex-tradingview-chart__widget';

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.async = true;
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.dataset.voltexTradingview = 'advanced-chart';
    script.text = JSON.stringify({
      autosize: true,
      symbol,
      interval: '15',
      timezone: 'Etc/UTC',
      theme: 'dark',
      backgroundColor: '#0d141d',
      gridColor: 'rgba(132, 142, 156, 0.10)',
      style: '1',
      locale,
      hide_side_toolbar: false,
      hide_top_toolbar: false,
      // Hide TradingView's symbol/exchange/OHLC legend. VOLTEX renders only
      // the selected ticker above the plot so the chart stays clean and does
      // not expose the upstream venue in the visible header.
      hide_legend: true,
      hide_volume: false,
      allow_symbol_change: false,
      withdateranges: true,
      save_image: false,
      calendar: false,
      details: false,
      hotlist: false,
      watchlist: [],
      compareSymbols: [],
      studies: [],
      show_popup_button: false,
      support_host: 'https://www.tradingview.com',
    });

    host.append(widget, script);

    return () => {
      host.replaceChildren();
    };
  }, [symbol, locale]);

  return <div className="tradingview-widget-container voltex-tradingview-chart__embed" ref={hostRef} />;
}

function TradingViewAdvancedChartImpl({ pair, market = 'spot' }: TradingViewAdvancedChartProps) {
  const { lang } = useLanguage();
  const symbol = useMemo(() => toTradingViewSymbol(pair, market), [pair, market]);
  const locale = TV_LOCALE[lang] ?? 'en';
  const symbolPath = symbol.replace(/^BYBIT:/, '');
  const ticker = pair.toUpperCase();

  return (
    <div className="voltex-tradingview-chart" data-market={market} data-symbol={symbol}>
      <TradingViewEmbed key={`${symbol}:${locale}`} symbol={symbol} locale={locale} />
      <div className="voltex-tradingview-chart__ticker" aria-hidden="true">{ticker}</div>
      <div className="tradingview-widget-copyright voltex-tradingview-chart__copyright">
        <a
          href={`https://www.tradingview.com/symbols/${encodeURIComponent(symbolPath)}/?exchange=BYBIT`}
          rel="noopener nofollow"
          target="_blank"
        >
          <span className="blue-text">{pair} chart</span>
        </a>
        <span className="trademark"> by TradingView</span>
      </div>
    </div>
  );
}

export const TradingViewAdvancedChart = memo(TradingViewAdvancedChartImpl);
