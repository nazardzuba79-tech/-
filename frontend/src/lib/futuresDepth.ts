/** Public linear-perpetual depth, for presentation only. No account or order API.
 * Protocol: https://bybit-exchange.github.io/docs/v5/websocket/public/orderbook
 */
export interface FuturesDepthSnapshot { bids: {price:string;quantity:string}[]; asks: {price:string;quantity:string}[] }
const empty = (): FuturesDepthSnapshot => ({ bids: [], asks: [] });
const DEPTH = 200;
const MAX_AGE_MS = 30_000;

export class FuturesDepthBook {
  private bids = new Map<string,string>();
  private asks = new Map<string,string>();
  private update = 0;
  private sequence = 0;
  private initialized = false;
  constructor(readonly symbol: string) {}

  apply(frame: any, now: number): boolean {
    if (frame?.topic !== `orderbook.${DEPTH}.${this.symbol}`) return false;
    const d = frame.data;
    if (!d || d.s !== this.symbol || !['snapshot','delta'].includes(frame.type) ||
        !Number.isFinite(frame.ts) || frame.ts > now + 1000 || now - frame.ts > MAX_AGE_MS ||
        !Number.isSafeInteger(d.u) || d.u < 1 || !Number.isSafeInteger(d.seq) || d.seq < 0) throw new Error('Invalid depth frame');
    const reset = frame.type === 'snapshot' || d.u === 1;
    if (!reset && !this.initialized) throw new Error('Snapshot required');
    // Update IDs are monotonic, not necessarily contiguous across messages.
    if (!reset && d.u <= this.update) return false;
    if (!reset && d.seq < this.sequence) throw new Error('Depth sequence rollback');
    const bids = reset ? new Map<string,string>() : new Map(this.bids);
    const asks = reset ? new Map<string,string>() : new Map(this.asks);
    for (const [levels, target] of [[d.b,bids],[d.a,asks]] as [unknown,Map<string,string>][]) {
      if (!Array.isArray(levels) || levels.length > 1000) throw new Error('Invalid depth levels');
      for (const level of levels) {
        if (!Array.isArray(level) || level.length !== 2 ||
            level.some(v => typeof v !== 'string' || !/^\d+(?:\.\d+)?$/.test(v)) ||
            !Number.isFinite(Number(level[0])) || Number(level[0]) <= 0 || !Number.isFinite(Number(level[1]))) throw new Error('Invalid depth level');
        const price = String(Number(level[0]));
        if (Number(level[1]) === 0) target.delete(price); else target.set(price,level[1]);
      }
      if (target.size > 1000) throw new Error('Depth bound exceeded');
    }
    if (bids.size && asks.size && Math.max(...[...bids.keys()].map(Number)) >= Math.min(...[...asks.keys()].map(Number))) throw new Error('Crossed depth');
    this.bids=bids; this.asks=asks; this.update=d.u; this.sequence=d.seq; this.initialized=true;
    return true;
  }

  snapshot(): FuturesDepthSnapshot {
    const sorted = (levels: Map<string,string>, direction: number) => [...levels].sort((a,b)=>(Number(a[0])-Number(b[0]))*direction)
      .slice(0,DEPTH).map(([price,quantity])=>({price,quantity}));
    return { bids:sorted(this.bids,-1), asks:sorted(this.asks,1) };
  }
}

export function subscribeFuturesDepth(pair: string, listener: (book:FuturesDepthSnapshot)=>void): () => void {
  listener(empty());
  if (!/^[A-Z0-9]{1,32}\/USDT$/.test(pair)) return () => {};
  const symbol=pair.replace('/','');
  let socket:WebSocket|null=null, stopped=false, retry:ReturnType<typeof setTimeout>|null=null;
  let flush:ReturnType<typeof setTimeout>|null=null, heartbeat:ReturnType<typeof setInterval>|null=null;
  let backoff=1000;
  const clearConnection=()=>{
    const old=socket;socket=null;
    if(old){old.onopen=null;old.onmessage=null;old.onerror=null;old.onclose=null;old.close();}
    if(flush!==null)clearTimeout(flush);flush=null;
    if(heartbeat!==null)clearInterval(heartbeat);heartbeat=null;
  };
  const reconnect=()=>{
    clearConnection();listener(empty());
    if(stopped||document.hidden||retry!==null)return;
    retry=setTimeout(()=>{retry=null;connect();},backoff);
    backoff=Math.min(backoff*2,15000);
  };
  const connect=()=>{
    if(stopped||document.hidden||socket)return;
    const book=new FuturesDepthBook(symbol);
    let lastFrame=Date.now(),lastPing=Date.now();
    try {
      const ws=new WebSocket('wss://stream.bybit.com/v5/public/linear');socket=ws;
      ws.onopen=()=>{if(socket===ws)ws.send(JSON.stringify({op:'subscribe',args:[`orderbook.${DEPTH}.${symbol}`]}));};
      ws.onmessage=event=>{
        if(stopped||socket!==ws)return;
        try{
          const frame=JSON.parse(event.data);
          if(frame.success===false)throw new Error('Subscription rejected');
          if(!book.apply(frame,Date.now()))return;
          lastFrame=Date.now();backoff=1000;
          if(flush===null)flush=setTimeout(()=>{flush=null;if(!stopped&&socket===ws)listener(book.snapshot());},300);
        }catch{reconnect();}
      };
      ws.onerror=ws.onclose=()=>{if(socket===ws)reconnect();};
      heartbeat=setInterval(()=>{
        if(Date.now()-lastFrame>MAX_AGE_MS){reconnect();return;}
        if(ws.readyState===1&&Date.now()-lastPing>=20000){ws.send(JSON.stringify({op:'ping'}));lastPing=Date.now();}
      },1000);
    }catch{reconnect();}
  };
  const visibility=()=>{
    if(retry!==null)clearTimeout(retry);retry=null;
    clearConnection();listener(empty());if(!document.hidden)connect();
  };
  document.addEventListener('visibilitychange',visibility);connect();
  return ()=>{stopped=true;if(retry!==null)clearTimeout(retry);clearConnection();document.removeEventListener('visibilitychange',visibility);};
}
