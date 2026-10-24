// Candidates are not listings. LiveMarketHub admits each exact spot identity only
// after the venue's current public instrument metadata confirms it. Never route
// one issuer's price under another issuer's token, or USD under USDT.
const frames = ['1m','5m','15m','30m','1h','4h','1D'];
const names = {AAPL:'Apple',NVDA:'NVIDIA',TSLA:'Tesla',SPY:'SPDR S&P 500 ETF',QQQ:'Invesco QQQ ETF'};
const rows = (provider, issuer, symbols, currency='USDT') => symbols.map(([ticker, sourceSymbol, asset]) => ({id:`${provider.toUpperCase()}:${sourceSymbol}`,ticker,name:names[ticker],asset,sourceSymbol,provider,issuer,region:'US',kind:'token',currency,delaySeconds:0,timeframes:frames,productType:'spot'}));
export const LIVE_CATALOG = [
  ...rows('okx','okx-tokenized',['AAPL','NVDA','TSLA','SPY','QQQ'].map(t=>[t,`X${t}-USDT`,`X${t}`])),
  ...rows('kucoin','xstocks',[['AAPL','AAPLX-USDT','AAPLX'],['TSLA','TSLAX-USDT','TSLAX']]),
  ...rows('kraken','xstocks',['AAPL','NVDA','TSLA','SPY','QQQ'].map(t=>[t,`${t}xUSD`,`${t}x`]),'USD'),
  ...rows('bingx','xstocks',['AAPL','NVDA','TSLA','SPY'].map(t=>[t,`${t}X-USDT`,`${t}X`])),
  ...rows('mexc','ondo',['AAPL','NVDA','TSLA','SPY','QQQ'].map(t=>[t,`${t}ONUSDT`,`${t}ON`])),
  ...rows('bitget','bitget-rtoken',['AAPL','NVDA','TSLA','SPY','QQQ'].map(t=>[t,`R${t}USDT`,`r${t}`])).map(i=>({...i,productType:'unified-share-equivalent',timeframes:['1m','5m','15m','1h','4h','1D']})),
];
export const LIVE_PROVIDERS = ['binance','bybit','gate','mexc','okx','kucoin','kraken','bingx','bitget'];
// Neither a stock-labelled perpetual nor an RFQ/reference stream is a spot book.
export const UNSUPPORTED_LIVE_PRODUCTS = Object.freeze({
  backpack:'STOCK_PERPETUAL_AND_SECURITIES_REFERENCE_NOT_SPOT',
});
