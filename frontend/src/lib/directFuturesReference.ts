import type { LiveQuote } from './liveMarketTypes';
import { subscribeFuturesTicker, type FuturesTickerUpdate } from './futuresDepth';

const DIRECT_TICKER_URLS = [
  'https://api.bybit.com/v5/market/tickers?category=linear',
  'https://api.bytick.com/v5/market/tickers?category=linear',
] as const;
const EDGE_TICKER_URL = 'https://market.voltextech.net/market/display/futures-tickers';
const REFRESH_MS = 300_000;
const RETRY_MS = 60_000;

type Listener = (rows: ReadonlyMap<string, LiveQuote>) => void;

function numberOrNull(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseDirectFuturesTickers(payload: any, now = Date.now()): Map<string, LiveQuote> {
  if (payload?.retCode !== 0 || payload?.result?.category !== 'linear' || !Array.isArray(payload?.result?.list)) {
    throw new Error('Invalid futures ticker response');
  }
  const providerTime = numberOrNull(payload.time);
  const rows = new Map<string, LiveQuote>();
  for (const raw of payload.result.list) {
    if (!raw || typeof raw.symbol !== 'string' || !/^[A-Z0-9]{1,28}USDT$/.test(raw.symbol)) continue;
    const lastPrice = numberOrNull(raw.lastPrice);
    if (lastPrice === null || lastPrice <= 0) continue;
    const baseAsset = raw.symbol.slice(0, -4);
    const pair = `${baseAsset}/USDT`;
    const changeFraction = numberOrNull(raw.price24hPcnt);
    rows.set(pair, {
      id: `linear_perpetual:${raw.symbol}`,
      pair,
      symbol: pair,
      providerSymbol: raw.symbol,
      provider: payload?.source === 'okx' ? 'okx' : 'bybit',
      marketType: 'linear_perpetual',
      volumeAsset: baseAsset,
      turnoverAsset: 'USDT',
      baseAsset,
      quoteAsset: 'USDT',
      settleAsset: 'USDT',
      lastPrice,
      bidPrice: numberOrNull(raw.bid1Price),
      askPrice: numberOrNull(raw.ask1Price),
      high24h: numberOrNull(raw.highPrice24h),
      low24h: numberOrNull(raw.lowPrice24h),
      volume24h: numberOrNull(raw.volume24h),
      quoteVolume24h: numberOrNull(raw.turnover24h),
      changePercent24h: changeFraction === null ? null : changeFraction * 100,
      indexPrice: numberOrNull(raw.indexPrice),
      markPrice: numberOrNull(raw.markPrice),
      fundingRate: numberOrNull(raw.fundingRate),
      fundingIntervalMinutes: null,
      openInterest: numberOrNull(raw.openInterest),
      openInterestValue: numberOrNull(raw.openInterestValue),
      providerEventAt: providerTime,
      sequence: null,
      receivedAt: now,
      fetchedAt: now,
      stale: false,
    });
  }
  if (!rows.size) throw new Error('Empty futures ticker response');
  return rows;
}


export function parseNormalizedFuturesSnapshot(payload: any): Map<string, LiveQuote> {
  if (payload?.type !== 'snapshot' || !Array.isArray(payload?.rows)) throw new Error('Invalid normalized futures snapshot');
  const rows = new Map<string, LiveQuote>();
  for (const raw of payload.rows) {
    if (!raw || raw.marketType !== 'linear_perpetual' || raw.quoteAsset !== 'USDT' || raw.settleAsset !== 'USDT' ||
        raw.provider !== 'bybit' || typeof raw.providerSymbol !== 'string' || !/^[A-Z0-9]{1,28}USDT$/.test(raw.providerSymbol) ||
        raw.id !== `linear_perpetual:${raw.providerSymbol}` || raw.pair !== `${raw.baseAsset}/USDT` ||
        typeof raw.lastPrice !== 'number' || !Number.isFinite(raw.lastPrice) || raw.lastPrice <= 0) continue;
    rows.set(raw.pair, raw as LiveQuote);
  }
  if (!rows.size) throw new Error('Empty normalized futures snapshot');
  return rows;
}

export function applyFuturesTickerUpdate(rows:ReadonlyMap<string,LiveQuote>, pair:string, update:FuturesTickerUpdate, now=Date.now()):Map<string,LiveQuote>{
  const next=new Map(rows);
  const previous=next.get(pair);
  const symbol=pair.replace('/','');
  if(update.symbol!==symbol)return next;
  const number=(value:string|undefined,fallback:number|null)=>value===undefined?fallback:(Number.isFinite(Number(value))?Number(value):fallback);
  const lastPrice=number(update.lastPrice,previous?.lastPrice??null);
  if(lastPrice===null||lastPrice<=0)return next;
  const baseAsset=pair.slice(0,-5);
  next.set(pair,{
    id:`linear_perpetual:${symbol}`,pair,symbol:pair,providerSymbol:symbol,provider:'bybit',marketType:'linear_perpetual',
    volumeAsset:baseAsset,turnoverAsset:'USDT',baseAsset,quoteAsset:'USDT',settleAsset:'USDT',
    lastPrice,
    bidPrice:number(update.bid1Price,previous?.bidPrice??null),
    askPrice:number(update.ask1Price,previous?.askPrice??null),
    high24h:number(update.highPrice24h,previous?.high24h??null),
    low24h:number(update.lowPrice24h,previous?.low24h??null),
    volume24h:number(update.volume24h,previous?.volume24h??null),
    quoteVolume24h:number(update.turnover24h,previous?.quoteVolume24h??null),
    changePercent24h:update.price24hPcnt===undefined?(previous?.changePercent24h??null):Number(update.price24hPcnt)*100,
    indexPrice:number(update.indexPrice,previous?.indexPrice??null),
    markPrice:number(update.markPrice,previous?.markPrice??null),
    fundingRate:number(update.fundingRate,previous?.fundingRate??null),
    fundingIntervalMinutes:update.fundingIntervalHour===undefined?(previous?.fundingIntervalMinutes??null):Number(update.fundingIntervalHour)*60,
    openInterest:number(update.openInterest,previous?.openInterest??null),
    openInterestValue:number(update.openInterestValue,previous?.openInterestValue??null),
    providerEventAt:update.ts,sequence:previous?.sequence??null,receivedAt:now,fetchedAt:previous?.fetchedAt??now,stale:false,
  });
  return next;
}

function productionSite(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'voltextech.net' || host.endsWith('.voltextech.net');
}

async function fetchJson(url: string, signal: AbortSignal): Promise<any> {
  const response = await fetch(url, { signal, credentials: 'omit', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`ticker_http_${response.status}`);
  return response.json();
}

class DirectFuturesReferenceStore {
  private rows = new Map<string, LiveQuote>();
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private visibilityAttached = false;
  private focusedPair: string | null = null;
  private tickerStop: (()=>void) | null = null;

  getState = (): ReadonlyMap<string, LiveQuote> => this.rows;

  focus = (pair:string|null):void => {
    if(this.focusedPair===pair)return;
    this.tickerStop?.();this.tickerStop=null;this.focusedPair=pair;
    if(pair&&this.listeners.size&&productionSite())this.attachTicker();
  };

  private attachTicker():void{
    if(!this.focusedPair||this.tickerStop||!productionSite())return;
    const pair=this.focusedPair;
    this.tickerStop=subscribeFuturesTicker(pair,(update)=>{
      if(this.focusedPair!==pair)return;
      this.rows=applyFuturesTickerUpdate(this.rows,pair,update);
      this.emit();
    });
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    listener(this.rows);
    if (this.listeners.size === 1) {
      this.attachVisibility();
      this.attachTicker();
      void this.load();
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) this.stop();
    };
  };

  private emit(): void {
    for (const listener of this.listeners) listener(this.rows);
  }

  private schedule(delay: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.listeners.size || (typeof document !== 'undefined' && document.hidden)) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.load();
    }, delay);
  }

  private async load(): Promise<void> {
    if (!this.listeners.size || this.controller || (typeof document !== 'undefined' && document.hidden)) return;
    const controller = new AbortController();
    this.controller = controller;
    try {
      let payload: any = null;
      if (!productionSite()) {
        // CI/local/preview stays deterministic and uses the existing fixture-backed app API.
        payload = await fetchJson('/api/v1/market/display', controller.signal);
        this.rows = parseNormalizedFuturesSnapshot(payload);
      } else {
        let loaded = false;
        for (const url of DIRECT_TICKER_URLS) {
          try {
            payload = await fetchJson(url, controller.signal);
            this.rows = parseDirectFuturesTickers(payload);
            loaded = true;
            break;
          } catch (error) {
            if (controller.signal.aborted) throw error;
          }
        }
        if (!loaded) {
          payload = await fetchJson(EDGE_TICKER_URL, controller.signal);
          this.rows = parseDirectFuturesTickers(payload);
        }
      }
      if (!controller.signal.aborted) this.emit();
      this.schedule(REFRESH_MS);
    } catch {
      if (!controller.signal.aborted) this.schedule(RETRY_MS);
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }

  private onVisibility = (): void => {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const active = this.controller;
    if (active) {
      active.abort();
      if (this.controller === active) this.controller = null;
    }
    if (!document.hidden) this.schedule(0);
  };

  private attachVisibility(): void {
    if (this.visibilityAttached || typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', this.onVisibility);
    this.visibilityAttached = true;
  }

  private stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.controller?.abort();
    this.controller = null;
    this.tickerStop?.();
    this.tickerStop = null;
    if (this.visibilityAttached && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility);
      this.visibilityAttached = false;
    }
  }
}

export const directFuturesReferenceStore = new DirectFuturesReferenceStore();
