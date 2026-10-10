import type { StockCatalogue, StockRead } from '../../lib/stocks';
declare const __VOLTEX_STOCKS_WIDGET_PREVIEW__: boolean;
// Build-only opt-in; this never turns on the production Stocks route.
export const widgetPreview = typeof __VOLTEX_STOCKS_WIDGET_PREVIEW__ !== 'undefined' && __VOLTEX_STOCKS_WIDGET_PREVIEW__;
const US = [
  ['AAPL', 'Apple Inc.'], ['NVDA', 'NVIDIA Corporation'], ['MSFT', 'Microsoft Corporation'],
  ['AMZN', 'Amazon.com, Inc.'], ['GOOGL', 'Alphabet Inc.'], ['META', 'Meta Platforms, Inc.'],
  ['TSLA', 'Tesla, Inc.'], ['AVGO', 'Broadcom Inc.'], ['COST', 'Costco Wholesale Corporation'], ['NFLX', 'Netflix, Inc.'],
] as const;
// Static reference metadata ONLY. No quotes, generated candles or TV data cache.
export const widgetCatalogue: StockRead<StockCatalogue> = {
  data: { instruments: US.map(([symbol,name]) => ({
    instrumentId: 'XNGS:' + symbol, symbol, name, type: 'stock', region: 'USA', country: 'United States',
    exchange: 'XNGS', currency: 'USD', exchangeTimeZone: 'America/New_York',
    logoPath: null, latest: null, sessionChange: null,
  })) }, error: false, loading: false, retry: () => {},
};
export const widgetSymbol = (id: string): string | null =>
  widgetCatalogue.data!.instruments.some(item => item.instrumentId === id) ? 'NASDAQ:' + id.split(':')[1] : null;
export const widgetLocale = (lang: string) => lang === 'zh' ? 'zh_CN' : lang === 'hi' ? 'en' : lang;
