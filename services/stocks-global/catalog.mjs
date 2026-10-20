// Instrument identity includes venue and asset. Never merge AAPLB, AAPLX, or MOEX equities.
// Canonical identity = issuer + token (asset) + venue (provider) + quote currency. The issuer
// names the tokenised product: 'xstocks' (Backed xStocks: AAPLX on Bybit/Gate/MEXC, AAPLx on
// Kraken), 'bstocks' (Binance bStocks: AAPLB), 'moex' (a listed MOEX equity, not a token).
// The venue is the source of prices, not part of the token identity, and a row is never served
// under another row's id: a failed source is SOURCE_UNAVAILABLE, not a substitute.
const us = [
  ['AAPL','Apple Inc.','apple.com'],['NVDA','NVIDIA Corporation','nvidia.com'],['TSLA','Tesla, Inc.','tesla.com'],
  ['MSFT','Microsoft Corporation','microsoft.com'],['AMZN','Amazon.com, Inc.','amazon.com'],['GOOGL','Alphabet Inc.','google.com'],
  ['META','Meta Platforms, Inc.','about.meta.com'],['NFLX','Netflix, Inc.','netflix.com'],['AVGO','Broadcom Inc.','broadcom.com'],
  ['COIN','Coinbase Global, Inc.','coinbase.com'],['MSTR','Strategy Inc.','strategy.com'],['AMD','Advanced Micro Devices','amd.com'],['INTC','Intel Corporation','intel.com'],
];
const ru = [['SBER','Сбербанк'],['GAZP','Газпром'],['LKOH','ЛУКОЙЛ'],['ROSN','Роснефть'],['NVTK','НОВАТЭК'],['TATN','Татнефть'],['GMKN','Норникель'],['PLZL','Полюс'],['YDEX','Яндекс'],['OZON','Ozon'],['MOEX','Московская биржа'],['SNGS','Сургутнефтегаз'],['SNGSP','Сургутнефтегаз, прив.'],['VTBR','ВТБ'],['AFLT','Аэрофлот'],['MTSS','МТС'],['MGNT','Магнит'],['CHMF','Северсталь'],['NLMK','НЛМК'],['PHOR','ФосАгро']];
const bybit = new Set(['AAPL','NVDA','TSLA','AMZN','GOOGL','META','COIN']);
export const TIMEFRAMES = ['1m','5m','15m','30m','1h','4h','1D'];
export const CATALOG = [
  ...us.flatMap(([ticker,name,domain]) => [
    ...(bybit.has(ticker) ? [{ id:`BYBIT:${ticker}XUSDT`, ticker, asset:ticker+'X', issuer:'xstocks', name, domain, provider:'bybit', sourceSymbol:ticker+'XUSDT', region:'US', kind:'token', currency:'USDT', delaySeconds:0, timeframes:TIMEFRAMES }] : []),
    { id:`BINANCE:${ticker}BUSDT`, ticker, asset:ticker+'B', issuer:'bstocks', name, domain, provider:'binance', sourceSymbol:ticker+'BUSDT', region:'US', kind:'token', currency:'USDT', delaySeconds:0, timeframes:TIMEFRAMES },
  ]),
  ...ru.map(([ticker,name]) => ({ id:`MOEX:TQBR:${ticker}`, ticker, asset:ticker, issuer:'moex', name, provider:'moex', sourceSymbol:ticker, region:'RU', kind:'equity', currency:'RUB', delaySeconds:900, timeframes:['1m','1h','1D'] })),
];
// Venue adapters verified read-only on 2026-10-20 (docs/STOCKS_MARKET_DATA_DISCOVERY_20261020.md).
// MarketHub lists these rows only for venues enabled explicitly; nothing is enabled by default and
// production stays off under DATA_RIGHTS_UNVERIFIED. MSFT has no xStocks/USDT pair on these venues.
const etf = { SPY:['SPDR S&P 500 ETF Trust','ssga.com'], QQQ:['Invesco QQQ Trust','invesco.com'] };
const named = ticker => us.find(([t]) => t === ticker)?.slice(1) ?? etf[ticker];
const venueRows = (provider, issuer, tickers, symbol, asset) => tickers.map(ticker => { const [name,domain] = named(ticker); return { id:`${provider.toUpperCase()}:${symbol(ticker)}`, ticker, asset:asset(ticker), issuer, name, domain, provider, sourceSymbol:symbol(ticker), region:'US', kind:'token', currency:'USDT', delaySeconds:0, timeframes:TIMEFRAMES }; });
export const VENUE_CATALOG = [
  ...venueRows('gate', 'xstocks', ['AAPL','NVDA','TSLA','SPY','QQQ'], t => `${t}X_USDT`, t => t+'X'),
  ...venueRows('mexc', 'xstocks', ['AAPL','NVDA','TSLA','SPY'], t => `${t}XUSDT`, t => t+'X'),
];
// Source order per underlying for display and selection, from the 2026-10-20 evidence (24h quote
// volume, book freshness, API completeness). Priority never substitutes: each id keeps its own
// verification, quotes and errors; the caller shows the ranked list and the selected id's state.
export const SOURCE_PRIORITY = {
  AAPL:['BINANCE:AAPLBUSDT','GATE:AAPLX_USDT','MEXC:AAPLXUSDT','BYBIT:AAPLXUSDT'],
  NVDA:['BINANCE:NVDABUSDT','GATE:NVDAX_USDT','MEXC:NVDAXUSDT','BYBIT:NVDAXUSDT'],
  TSLA:['BINANCE:TSLABUSDT','GATE:TSLAX_USDT','MEXC:TSLAXUSDT','BYBIT:TSLAXUSDT'],
  MSFT:['BINANCE:MSFTBUSDT'],
  SPY:['GATE:SPYX_USDT','MEXC:SPYXUSDT'],
  QQQ:['GATE:QQQX_USDT'],
};
export const instrument = id => CATALOG.find(i => i.id === id) ?? VENUE_CATALOG.find(i => i.id === id);
// Ranked rows for one underlying with each source's own verified state. `rows` is a catalogue()
// result; ids absent from it (venue not enabled, not configured) are reported, never replaced.
export function rankedSources(ticker, rows) {
  const byId = new Map(rows.map(r => [r.id, r]));
  return (SOURCE_PRIORITY[ticker] ?? []).map((id, rank) => { const row = byId.get(id); return { rank, id, issuer: instrument(id)?.issuer ?? null, asset: instrument(id)?.asset ?? null, provider: instrument(id)?.provider ?? null, listed: !!row, online: row?.online === true, sourceError: row ? row.sourceError ?? null : 'DATA_RIGHTS_UNVERIFIED' }; });
}
