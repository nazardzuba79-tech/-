import { useEffect, useRef } from 'react';

/**
 * Real TradingView chart, embedded via TradingView's own public widget
 * script — not something we build from our own trade data. The widget
 * loads its data directly from TradingView's CDN in the visitor's browser,
 * so it's unaffected by any restriction on our own backend's server
 * (unlike a REST mirror such as Kraken, which our order book/trades still
 * use).
 */
export function TradingViewChart({ pair, locale }: { pair: string; locale: 'ru' | 'en' }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = '';

    const widgetDiv = document.createElement('div');
    widgetDiv.className = 'tradingview-widget-container__widget';
    widgetDiv.style.height = '100%';
    widgetDiv.style.width = '100%';

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.text = JSON.stringify({
      autosize: true,
      symbol: pairToTradingViewSymbol(pair),
      interval: '15',
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale,
      backgroundColor: 'rgba(15, 17, 22, 1)',
      gridColor: 'rgba(28, 31, 38, 1)',
      hide_top_toolbar: false,
      allow_symbol_change: false,
      support_host: 'https://www.tradingview.com',
    });

    container.appendChild(widgetDiv);
    container.appendChild(script);
  }, [pair, locale]);

  return <div ref={containerRef} className="tradingview-widget-container" style={{ height: '100%', width: '100%' }} />;
}

function pairToTradingViewSymbol(pair: string): string {
  return `BINANCE:${pair.replace('/', '').toUpperCase()}`;
}
