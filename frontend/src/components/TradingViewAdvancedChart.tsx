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

function TradingViewAdvancedChartImpl({ pair, market = 'spot' }: TradingViewAdvancedChartProps) {
  const { lang } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<HTMLDivElement>(null);
  const symbol = useMemo(() => toTradingViewSymbol(pair, market), [pair, market]);
  const locale = TV_LOCALE[lang] ?? 'en';
  const symbolPath = symbol.replace(/^BYBIT:/, '');

  useEffect(() => {
    const container = containerRef.current;
    const widgetHost = widgetRef.current;
    if (!container || !widgetHost) return;

    widgetHost.replaceChildren();
    for (const old of container.querySelectorAll('script[data-voltex-tradingview]')) old.remove();

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
      backgroundColor: '#0b0e11',
      gridColor: 'rgba(42, 46, 57, 0.35)',
      style: '1',
      locale,
      hide_side_toolbar: false,
      hide_top_toolbar: false,
      hide_legend: false,
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
    container.appendChild(script);

    return () => {
      script.remove();
      widgetHost.replaceChildren();
    };
  }, [symbol, locale]);

  return (
    <div className="tradingview-widget-container voltex-tradingview-chart" ref={containerRef} data-market={market} data-symbol={symbol}>
      <div className="tradingview-widget-container__widget voltex-tradingview-chart__widget" ref={widgetRef} />
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
