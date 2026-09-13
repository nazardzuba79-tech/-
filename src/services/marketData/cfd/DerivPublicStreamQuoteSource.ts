import WebSocket, { type RawData } from 'ws';
import { CFD_REFERENCE_CATALOG } from './catalog';
import { assertCfdFreshQuote, DEFAULT_MAX_QUOTE_AGE_MS, quoteAgeLimit, type CfdQuote, type CfdQuoteSource } from './CfdQuote';

/**
 * Deriv public WebSocket adapter.
 *
 * Technical market-data access is public/no-auth, but financial use inside
 * VOLTEX remains FAIL-CLOSED until an operator records a non-secret rights
 * evidence identifier and explicitly lists entitled/executable symbols.
 * `shadow` can be enabled for internal coverage testing without granting any
 * execution permission. No quote is stored beyond the in-memory process cache.
 */
export const DERIV_PUBLIC_WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';

const ALL = CFD_REFERENCE_CATALOG.map(i => i.symbol);
const EXACT_IDS: Record<string, string[]> = {
  EURUSD:['frxEURUSD'], GBPUSD:['frxGBPUSD'], USDJPY:['frxUSDJPY'], AUDUSD:['frxAUDUSD'], USDCAD:['frxUSDCAD'], USDCHF:['frxUSDCHF'], NZDUSD:['frxNZDUSD'],
  XAUUSD:['frxXAUUSD'], XAGUSD:['frxXAGUSD'], XPTUSD:['frxXPTUSD'], XPDUSD:['frxXPDUSD'],
};
const NAME_ALIASES: Record<string, string[]> = {
  XAUUSD:['XAUUSD','XAU/USD','Gold/USD'], XAGUSD:['XAGUSD','XAG/USD','Silver/USD'], XPTUSD:['XPTUSD','XPT/USD','Platinum/USD'], XPDUSD:['XPDUSD','XPD/USD','Palladium/USD'],
  WTIUSD:['US Oil','US Oil (WTI)','WTI/USD','West Texas Intermediate'],
  XBRUSD:['UK Brent Oil','Brent/USD','Brent Europe','Brent'],
  EURUSD:['EUR/USD','EURUSD'], GBPUSD:['GBP/USD','GBPUSD'], USDJPY:['USD/JPY','USDJPY'], AUDUSD:['AUD/USD','AUDUSD'], USDCAD:['USD/CAD','USDCAD'], USDCHF:['USD/CHF','USDCHF'], NZDUSD:['NZD/USD','NZDUSD'],
};
const normalize = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g,'');

export interface DerivDiscoveredSymbol {
  voltexSymbol: string;
  providerSymbol: string;
  providerName: string;
  market: string | null;
  exchangeOpen: boolean | null;
}
export interface DerivDiscovery {
  mapped: DerivDiscoveredSymbol[];
  missing: string[];
  ambiguous: { symbol:string; candidates:string[] }[];
}

/** Maps only exact ids or specific unambiguous names. Generic "Oil/USD" is
 * deliberately NOT accepted as WTI or Brent. */
export function discoverDerivSymbols(payload: unknown): DerivDiscovery {
  const rows = Array.isArray(payload) ? payload : [];
  const sanitized = rows.flatMap((raw:any) => {
    if (!raw || typeof raw !== 'object') return [];
    const providerSymbol = typeof raw.underlying_symbol === 'string' ? raw.underlying_symbol : typeof raw.symbol === 'string' ? raw.symbol : '';
    const providerName = typeof raw.underlying_symbol_name === 'string' ? raw.underlying_symbol_name : typeof raw.display_name === 'string' ? raw.display_name : '';
    if (!providerSymbol || !providerName) return [];
    return [{ providerSymbol, providerName, market: typeof raw.market === 'string' ? raw.market : null,
      exchangeOpen: raw.exchange_is_open === 1 ? true : raw.exchange_is_open === 0 ? false : null }];
  });
  const mapped: DerivDiscoveredSymbol[] = [], missing:string[] = [], ambiguous:{symbol:string;candidates:string[]}[]=[];
  for (const symbol of ALL) {
    const exact = sanitized.filter(r => (EXACT_IDS[symbol] ?? []).includes(r.providerSymbol));
    const aliases = new Set((NAME_ALIASES[symbol] ?? []).map(normalize));
    const named = sanitized.filter(r => aliases.has(normalize(r.providerName)) || (symbol !== 'WTIUSD' && symbol !== 'XBRUSD' && normalize(r.providerName) === symbol));
    const pool = exact.length ? exact : named;
    const unique = [...new Map(pool.map(r => [r.providerSymbol,r])).values()];
    if (unique.length === 1) mapped.push({voltexSymbol:symbol,...unique[0]});
    else if (unique.length === 0) missing.push(symbol);
    else ambiguous.push({symbol,candidates:unique.map(r=>r.providerSymbol).sort()});
  }
  return {mapped,missing,ambiguous};
}

function positiveNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}
export function derivEpochMs(value: unknown): number | null {
  const n = positiveNumber(value); if (n === null) return null;
  return n < 10_000_000_000 ? Math.trunc(n*1000) : Math.trunc(n);
}

export interface DerivPublicStreamOptions {
  now?: () => number;
  maxQuoteAgeMs?: number;
  entitledSymbols?: string[];
  executionSymbols?: string[];
  /** Written permission / provider ticket / agreement reference. Not secret. */
  financialUseEvidence?: string;
  /** Allows internal technical coverage probing while isConfigured() remains false. */
  shadow?: boolean;
  url?: string;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  firstQuoteWaitMs?: number;
  socketFactory?: (url:string) => WebSocket;
}

export class DerivPublicStreamQuoteSource implements CfdQuoteSource {
  readonly maxQuoteAgeMs: number;
  private readonly now: () => number;
  private readonly entitled: Set<string>;
  private readonly executable: Set<string>;
  private readonly evidence: string;
  private readonly shadow: boolean;
  private readonly url: string;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly firstQuoteWaitMs: number;
  private readonly socketFactory: (url:string)=>WebSocket;
  private socket: WebSocket | null = null;
  private stopped = true;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private discovered = new Map<string,DerivDiscoveredSymbol>();
  private providerToVoltex = new Map<string,string>();
  private quotes = new Map<string,CfdQuote>();
  private waiters = new Map<string,Set<()=>void>>();
  private lastConnectedAt:number|null=null;
  private lastDisconnectedAt:number|null=null;
  private lastDiscoveryAt:number|null=null;
  private lastMessageAt:number|null=null;
  private missing:string[]=[...ALL];
  private ambiguous:{symbol:string;candidates:string[]}[]=[];
  private lastError:string|null=null;

  constructor(options: DerivPublicStreamOptions = {}) {
    this.now = options.now ?? (()=>Date.now());
    this.maxQuoteAgeMs = quoteAgeLimit(options.maxQuoteAgeMs ?? DEFAULT_MAX_QUOTE_AGE_MS);
    this.entitled = new Set(options.entitledSymbols ?? []);
    this.executable = new Set(options.executionSymbols ?? []);
    for (const symbol of [...this.entitled,...this.executable]) if (!ALL.includes(symbol)) throw new Error('Unverified Deriv CFD symbol');
    this.evidence = options.financialUseEvidence?.trim() ?? '';
    this.shadow = options.shadow === true;
    this.url = options.url ?? DERIV_PUBLIC_WS_URL;
    this.reconnectBaseMs = Math.max(250,Math.min(30_000,options.reconnectBaseMs ?? 1_000));
    this.reconnectMaxMs = Math.max(this.reconnectBaseMs,Math.min(120_000,options.reconnectMaxMs ?? 30_000));
    this.firstQuoteWaitMs = Math.max(100,Math.min(5_000,options.firstQuoteWaitMs ?? 1_200));
    this.socketFactory = options.socketFactory ?? (url=>new WebSocket(url));
  }
  isConfigured(): boolean { return Boolean(this.evidence && this.entitled.size); }
  start(): void {
    if ((!this.shadow && !this.isConfigured()) || !this.stopped) return;
    this.stopped=false; this.reconnectAttempt=0; this.connect();
  }
  stop(): void {
    this.stopped=true; if(this.reconnectTimer) clearTimeout(this.reconnectTimer); this.reconnectTimer=null;
    const socket=this.socket; this.socket=null; if(socket){try{socket.removeAllListeners();socket.close();}catch{}}
  }
  private connect(): void {
    if(this.stopped||this.socket)return;
    let socket:WebSocket; try{socket=this.socketFactory(this.url);}catch{this.lastError='connect_init';this.scheduleReconnect();return;}
    this.socket=socket;
    socket.on('open',()=>{if(this.socket!==socket||this.stopped)return;this.lastConnectedAt=this.now();this.reconnectAttempt=0;this.lastError=null;
      // New Deriv Options public API removed product_type from active_symbols.
      socket.send(JSON.stringify({active_symbols:'brief',req_id:1}));});
    socket.on('message',(data:RawData)=>{if(this.socket===socket&&!this.stopped)this.handleMessage(data.toString());});
    socket.on('error',()=>{if(this.socket!==socket||this.stopped)return;this.lastError='socket_error';try{socket.terminate();}catch{}});
    socket.on('close',()=>{if(this.socket!==socket)return;this.socket=null;this.lastDisconnectedAt=this.now();this.scheduleReconnect();});
  }
  private scheduleReconnect():void{
    if(this.stopped||this.reconnectTimer)return;
    const delay=Math.min(this.reconnectMaxMs,this.reconnectBaseMs*2**Math.min(10,this.reconnectAttempt++));
    this.reconnectTimer=setTimeout(()=>{this.reconnectTimer=null;this.connect();},delay);this.reconnectTimer.unref?.();
  }
  /** Public for deterministic parser tests; never accepts credentials. */
  handleMessage(text:string):void{
    if(text.length>512_000)return;
    let raw:any;try{raw=JSON.parse(text);}catch{return;}
    this.lastMessageAt=this.now();
    if(raw?.error){this.lastError=typeof raw.error.code==='string'?raw.error.code:'provider_error';return;}
    if(raw?.msg_type==='active_symbols'&&Array.isArray(raw.active_symbols)){
      const d=discoverDerivSymbols(raw.active_symbols);this.discovered.clear();this.providerToVoltex.clear();
      for(const row of d.mapped){this.discovered.set(row.voltexSymbol,row);this.providerToVoltex.set(row.providerSymbol,row.voltexSymbol);}
      this.missing=d.missing;this.ambiguous=d.ambiguous;this.lastDiscoveryAt=this.now();
      for(const row of d.mapped){try{this.socket?.send(JSON.stringify({ticks:row.providerSymbol,subscribe:1,req_id:`tick:${row.voltexSymbol}`}));}catch{this.lastError='subscribe_send';}}
      return;
    }
    if(raw?.msg_type!=='tick'||!raw.tick||typeof raw.tick!=='object')return;
    const providerSymbol=typeof raw.tick.symbol==='string'?raw.tick.symbol:'';
    const symbol=this.providerToVoltex.get(providerSymbol);if(!symbol)return;
    const at=derivEpochMs(raw.tick.epoch),last=positiveNumber(raw.tick.quote),receivedAt=this.now();if(at===null||last===null||at>receivedAt+1_000)return;
    const bid=positiveNumber(raw.tick.bid),ask=positiveNumber(raw.tick.ask);
    const saneSpread=bid!==null&&ask!==null&&bid<=ask&&last>=bid&&last<=ask;
    const discovery=this.discovered.get(symbol)!;
    const entitled=Boolean(this.evidence)&&this.entitled.has(symbol);
    const stale=receivedAt-at>this.maxQuoteAgeMs;
    const closed=discovery.exchangeOpen===false;
    const q:CfdQuote={provider:'deriv',symbol,providerSymbol,bid:saneSpread?bid:null,ask:saneSpread?ask:null,mid:null,last,
      providerTimestamp:at,fetchedAt:receivedAt,stale,status:entitled?(closed?'market_closed':stale?'stale':'live'):'entitlement_required',
      referenceStatus:closed?'market_closed':stale?'stale':'available',entitlementVerified:entitled,executionAllowed:entitled&&!closed&&this.executable.has(symbol)};
    this.quotes.set(symbol,q);for(const notify of this.waiters.get(symbol)??[])notify();
  }
  private current(symbol:string):CfdQuote{
    const mapped=this.discovered.get(symbol),saved=this.quotes.get(symbol);const entitled=Boolean(this.evidence)&&this.entitled.has(symbol)&&Boolean(mapped);
    if(!mapped||!saved)return{provider:'deriv',symbol,providerSymbol:mapped?.providerSymbol??'',bid:null,ask:null,mid:null,last:null,providerTimestamp:null,fetchedAt:null,stale:false,
      status:entitled?'unavailable':'entitlement_required',referenceStatus:'unavailable',entitlementVerified:false,executionAllowed:false};
    const now=this.now(),at=saved.providerTimestamp,got=saved.fetchedAt;const stale=at===null||got===null||at>now+1000||got>now+1000||now-at>this.maxQuoteAgeMs||now-got>this.maxQuoteAgeMs;
    const closed=mapped.exchangeOpen===false;
    return{...saved,stale,status:entitled?(closed?'market_closed':stale?'stale':'live'):'entitlement_required',referenceStatus:closed?'market_closed':stale?'stale':'available',
      entitlementVerified:entitled,executionAllowed:entitled&&!closed&&!stale&&this.executable.has(symbol)};
  }
  async getQuotes():Promise<CfdQuote[]>{return CFD_REFERENCE_CATALOG.map(i=>this.current(i.symbol));}
  async getFreshQuote(symbol:string):Promise<CfdQuote>{
    if(!ALL.includes(symbol)||!this.isConfigured())assertCfdFreshQuote(undefined,symbol,this.maxQuoteAgeMs,this.now());
    let q=this.current(symbol);try{assertCfdFreshQuote(q,symbol,this.maxQuoteAgeMs,this.now());return q;}catch{}
    if(this.stopped)this.start();
    await new Promise<void>(resolve=>{const set=this.waiters.get(symbol)??new Set<()=>void>();let timer:NodeJS.Timeout;
      const done=()=>{clearTimeout(timer);set.delete(done);if(!set.size)this.waiters.delete(symbol);resolve();};set.add(done);this.waiters.set(symbol,set);timer=setTimeout(done,this.firstQuoteWaitMs);});
    q=this.current(symbol);assertCfdFreshQuote(q,symbol,this.maxQuoteAgeMs,this.now());return q;
  }
  catalog(){return CFD_REFERENCE_CATALOG.map(i=>{const q=this.current(i.symbol),mapped=this.discovered.get(i.symbol);return{...i,provider:'deriv',providerSymbol:mapped?.providerSymbol??null,
    entitlement:q.entitlementVerified?'verified':'entitlement_required',executionAllowed:q.executionAllowed};});}
  diagnostics(){return{provider:'deriv',publicNoAuth:true,shadow:this.shadow,financialUseEvidenceConfigured:Boolean(this.evidence),configured:this.isConfigured(),started:!this.stopped,
    connected:this.socket?.readyState===WebSocket.OPEN,lastConnectedAt:this.lastConnectedAt,lastDisconnectedAt:this.lastDisconnectedAt,lastDiscoveryAt:this.lastDiscoveryAt,lastMessageAt:this.lastMessageAt,lastError:this.lastError,
    coverage:{mapped:this.discovered.size,required:ALL.length,missing:[...this.missing],ambiguous:this.ambiguous.map(x=>({...x,candidates:[...x.candidates]})),symbols:[...this.discovered.values()].map(x=>({...x})).sort((a,b)=>a.voltexSymbol.localeCompare(b.voltexSymbol))}};}
}
