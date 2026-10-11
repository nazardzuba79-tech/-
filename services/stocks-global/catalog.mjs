// Instrument identity includes venue and asset. Never merge AAPLB, AAPLX, or MOEX equities.
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
    ...(bybit.has(ticker) ? [{ id:`BYBIT:${ticker}XUSDT`, ticker, asset:ticker+'X', name, domain, provider:'bybit', sourceSymbol:ticker+'XUSDT', region:'US', kind:'token', currency:'USDT', delaySeconds:0, timeframes:TIMEFRAMES }] : []),
    { id:`BINANCE:${ticker}BUSDT`, ticker, asset:ticker+'B', name, domain, provider:'binance', sourceSymbol:ticker+'BUSDT', region:'US', kind:'token', currency:'USDT', delaySeconds:0, timeframes:TIMEFRAMES },
  ]),
  ...ru.map(([ticker,name]) => ({ id:`MOEX:TQBR:${ticker}`, ticker, asset:ticker, name, provider:'moex', sourceSymbol:ticker, region:'RU', kind:'equity', currency:'RUB', delaySeconds:900, timeframes:['1m','1h','1D'] })),
];
export const instrument = id => CATALOG.find(i => i.id === id);
