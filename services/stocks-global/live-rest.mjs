import { check } from './engine.mjs';
// Public contracts captured from MEXC exchangeInfo, 2026-10-24. A symbol
// retaining its name while changing backing token must fail re-admission.
const mexcContracts={AAPLXUSDT:'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp',NVDAXUSDT:'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',TSLAXUSDT:'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB',SPYXUSDT:'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W',AAPLONUSDT:'0x14c3abF95Cb9C93a8b82C1CdCB76D72Cb87b2d4c',NVDAONUSDT:'0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE',TSLAONUSDT:'0xf6b1117ec07684D3958caD8BEb1b302bfD21103f',SPYONUSDT:'0xFeDC5f4a6c38211c1338aa411018DFAf26612c08',QQQONUSDT:'0x0e397938C1Aa0680954093495B70A9F5e2249aBa'};
export const LIVE_METADATA = {
  binance: 'https://data-api.binance.vision/api/v3/exchangeInfo',
  bybit: 'https://api.bybit.com/v5/market/instruments-info?category=spot&limit=1000',
  gate: 'https://api.gateio.ws/api/v4/spot/currency_pairs',
  mexc: 'https://api.mexc.com/api/v3/exchangeInfo',
  okx: 'https://www.okx.com/api/v5/public/instruments?instType=SPOT',
  kucoin: 'https://api.kucoin.com/api/v2/symbols',
  kraken: 'https://api.kraken.com/0/public/AssetPairs?aclass_base=tokenized_asset',
  bingx: 'https://open-api.bingx.com/openApi/spot/v1/common/symbols',
  bitget: 'https://api.bitget.com/api/v3/market/instruments?category=SPOT',
};
export function confirmLiveInstrument(j, i, now) {
  let r, online=false, base, quote;
  switch(i.provider) {
    case 'binance': check(Array.isArray(j.symbols),'INVALID_DATA'); r=j.symbols.find(r=>r.symbol===i.sourceSymbol); online=r?.status==='TRADING'&&r?.isSpotTradingAllowed===true; base=r?.baseAsset;quote=r?.quoteAsset;break;
    case 'bybit': check(j.retCode===0&&Array.isArray(j.result?.list)&&!j.result.nextPageCursor,'INVALID_DATA');r=j.result.list.find(r=>r.symbol===i.sourceSymbol);online=r?.status==='Trading'&&r?.symbolType==='xstocks';base=r?.baseCoin;quote=r?.quoteCoin;break;
    case 'gate': check(Array.isArray(j),'INVALID_DATA');r=j.find(r=>r.id===i.sourceSymbol);online=r?.trade_status==='tradable';base=r?.base;quote=r?.quote;break;
    case 'mexc': check(Array.isArray(j.symbols),'INVALID_DATA');r=j.symbols.find(r=>r.symbol===i.sourceSymbol);online=r?.status==='1'&&r?.isSpotTradingAllowed===true; base=r?.baseAsset;quote=r?.quoteAsset;break;
    case 'okx': check(j.code==='0'&&Array.isArray(j.data),'INVALID_DATA');r=j.data.find(r=>r.instId===i.sourceSymbol);online=r?.state==='live'&&r?.instType==='SPOT'&&r?.instCategory==='3';base=r?.baseCcy;quote=r?.quoteCcy;break;
    case 'kucoin': check(j.code==='200000'&&Array.isArray(j.data),'INVALID_DATA');r=j.data.find(r=>r.symbol===i.sourceSymbol);online=r?.enableTrading===true&&r?.market==='Stocks';base=r?.baseCurrency;quote=r?.quoteCurrency;break;
    case 'kraken': check(Array.isArray(j.error)&&!j.error.length&&j.result,'INVALID_DATA');r=j.result[i.sourceSymbol];online=r?.status==='online'&&r?.aclass_base==='tokenized_asset';base=r?.base;quote=r?.quote==='ZUSD'?'USD':r?.quote;break;
    case 'bingx': check(j.code===0&&Array.isArray(j.data?.symbols),'INVALID_DATA');r=j.data.symbols.find(r=>r.symbol===i.sourceSymbol);online=r?.status===1;[base,quote]=(r?.symbol??'').split('-');break;
    case 'bitget': check(j.code==='00000'&&Array.isArray(j.data),'INVALID_DATA');r=j.data.find(r=>r.symbol===i.sourceSymbol);online=r?.status==='online'&&r?.category==='SPOT'&&r?.isReality==='yes'&&r?.instrumentType===(['SPY','QQQ'].includes(i.ticker)?'etf':'stock');base=r?.baseCoin;quote=r?.quoteCoin;break;
  }
  const exists=!!r&&base===i.asset&&quote===i.currency&&(i.provider!=='mexc'||mexcContracts[i.sourceSymbol]===r.contractAddress);
  return {exists,online:exists&&online,checkedAt:now,multiplier:i.provider==='bybit'?(r?.xstockMultiplier??null):null,venueStatus:r?String(r.status??r.state??r.trade_status):null,productType:i.productType??'spot'};
}
const minutes={'1m':1,'5m':5,'15m':15,'30m':30,'1h':60,'4h':240,'1D':1440};
const ku={'1m':'1min','5m':'5min','15m':'15min','30m':'30min','1h':'1hour','4h':'4hour','1D':'1day'};
const asc=rows=>rows.sort((a,b)=>Number(a[0])-Number(b[0]));
export const LIVE_REST_ADAPTERS={
  bitget:{hosts:['api.bitget.com'],maxRows:300,historyUrl:(i,t,l,end)=>`https://api.bitget.com/api/v3/market/candles?category=SPOT&symbol=${i.sourceSymbol}&interval=${t==='1h'?'1H':t==='4h'?'4H':t}&limit=${l}${end?'&endTime='+end:''}`,parseHistory:j=>{check(j.code==='00000'&&Array.isArray(j.data),'INVALID_CANDLES');return asc(j.data.map(r=>r.slice(0,6)));}},
  okx:{hosts:['www.okx.com'],maxRows:300,historyUrl:(i,t,l,end)=>`https://www.okx.com/api/v5/market/candles?instId=${i.sourceSymbol}&bar=${t==='1h'?'1H':t==='4h'?'4H':t==='1D'?'1Dutc':t}&limit=${l}${end?'&after='+end:''}`,parseHistory:j=>{check(j.code==='0'&&Array.isArray(j.data),'INVALID_CANDLES');return asc(j.data.map(r=>r.slice(0,6)));}},
  kucoin:{hosts:['api.kucoin.com'],maxRows:600,historyUrl:(i,t,l,end)=>`https://api.kucoin.com/api/v1/market/candles?symbol=${i.sourceSymbol}&type=${ku[t]}&startAt=${Math.floor((end||Date.now())/1000)-minutes[t]*60*1500}&endAt=${Math.floor((end||Date.now())/1000)}`,parseHistory:(j,i,limit=600)=>{check(j.code==='200000'&&Array.isArray(j.data),'INVALID_CANDLES');return asc(j.data.slice(0,limit).map(r=>[Number(r[0])*1000,r[1],r[3],r[4],r[2],r[5]]));}},
  kraken:{hosts:['api.kraken.com'],maxRows:600,historyUrl:(i,t)=>`https://api.kraken.com/0/public/OHLC?pair=${i.sourceSymbol}&interval=${minutes[t]}&asset_class=tokenized_asset`,parseHistory:(j,i,limit=600)=>{check(Array.isArray(j.error)&&!j.error.length&&Array.isArray(j.result?.[i.sourceSymbol]),'INVALID_CANDLES');return j.result[i.sourceSymbol].slice(-limit).map(r=>[Number(r[0])*1000,r[1],r[2],r[3],r[4],r[6]]);}},
  bingx:{hosts:['open-api.bingx.com'],maxRows:600,historyUrl:(i,t,l,end)=>`https://open-api.bingx.com/openApi/spot/v2/market/kline?symbol=${i.sourceSymbol}&interval=${t==='1D'?'1d':t}&limit=${l}${end?'&endTime='+end:''}`,parseHistory:j=>{check(j.code===0&&Array.isArray(j.data),'INVALID_CANDLES');return asc(j.data.map(r=>r.slice(0,6)));}},
};
