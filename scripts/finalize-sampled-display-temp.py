from pathlib import Path
import re
changed=[]
def edit(path,fn):
 p=Path(path); old=p.read_text(); new=fn(old)
 if old!=new:p.write_text(new);changed.append(path)
def swap(s,a,b):
 if a not in s:
  if b in s:return s
  raise RuntimeError('Missing anchor '+a[:120])
 if s.count(a)!=1:raise RuntimeError('Ambiguous anchor '+a[:120])
 return s.replace(a,b,1)

def cache(s):
 s=swap(s,"  let work = pending.get(url);", "  let work = pending.get(url);\n  if (work?.controller.signal.aborted) { pending.delete(url); work = undefined; }")
 s=swap(s,"if (!shared.users && !shared.done) shared.controller.abort();", "if (!shared.users && !shared.done) { if (pending.get(url) === shared) pending.delete(url); shared.controller.abort(); }")
 s=swap(s,"if (this.closed || this.controller || (typeof document !== 'undefined' && document.hidden)) return;", "if (this.closed || this.controller || (typeof document !== 'undefined' && document.hidden)) return;")
 return s
edit('frontend/src/lib/displaySnapshotCache.ts',cache)

def chart(s):
 if "from '../lib/displaySnapshotCache'" not in s:s="import { readDisplayJson, SLOW_DISPLAY_REFRESH_MS } from '../lib/displaySnapshotCache';\nimport { SampledDataNote } from './SampledDataNote';\n"+s
 begin=s.index('async function loadCandles('); end=s.index('/** Real OHLC',begin)
 s=s[:begin]+'''async function loadCandles(symbol:string,interval:Interval,signal:AbortSignal):Promise<{rows:ChartBar[];asOf:number|null}>{
  const url=`${API_BASE}/cfd/display/candles/${encodeURIComponent(symbol)}?interval=${interval}&limit=320`;
  const body=await readDisplayJson<RawEnvelope>(url,SLOW_DISPLAY_REFRESH_MS,signal);
  return {rows:normalizeBars(body,symbol,interval),asOf:typeof body.fetchedAt==='number'?body.fetchedAt:null};
}

'''+s[end:]
 s=swap(s,"const[interval,setInterval]=useState<Interval>('1h'),[status,setStatus]=useState<'loading'|'ready'|'error'>('loading'),[retry,setRetry]=useState(0);", "const[interval,setInterval]=useState<Interval>('1h'),[status,setStatus]=useState<'loading'|'ready'|'error'>('loading'),[retry,setRetry]=useState(0);\n  const [asOf,setAsOf]=useState<number|null>(null);\n  const renderedKey=useRef('');")
 begin=s.index('  useEffect(()=>{\n    let cancelled=false;const controller=new AbortController();');end=s.index("  return <div className=\"cfd-chart",begin)
 s=s[:begin]+'''  useEffect(()=>{
    let cancelled=false,controller:AbortController|null=null,timer:ReturnType<typeof setTimeout>|null=null;
    const key=`${symbol}:${interval}`;
    if(renderedKey.current!==key){seriesRef.current?.setData([]);volumeRef.current?.setData([]);setAsOf(null);setStatus('loading');}
    const schedule=(delay:number)=>{if(timer)clearTimeout(timer);timer=null;if(!cancelled&&!document.hidden)timer=setTimeout(()=>void load(),delay);};
    async function load(){
      if(cancelled||controller||document.hidden)return;
      const request=new AbortController();controller=request;let delay=SLOW_DISPLAY_REFRESH_MS;
      try{
        const snapshot=await loadCandles(symbol,interval,request.signal);
        if(cancelled||request.signal.aborted)return;
        const rows=snapshot.rows;
        seriesRef.current?.setData(rows.map(bar=>({time:Math.floor(bar.openTime/1000) as Time,open:bar.open,high:bar.high,low:bar.low,close:bar.close})));
        volumeRef.current?.setData(rows.map(bar=>({time:Math.floor(bar.openTime/1000) as Time,value:bar.volume,color:bar.close>=bar.open?'rgba(18,201,141,.28)':'rgba(239,83,80,.28)'})));
        if(renderedKey.current!==key)chartRef.current?.timeScale().fitContent();
        renderedKey.current=key;setAsOf(snapshot.asOf);setStatus('ready');
      }catch{if(!cancelled&&!request.signal.aborted)setStatus('error');delay=60_000;}
      finally{if(controller===request)controller=null;schedule(delay);}
    }
    const visible=()=>{if(document.hidden){if(timer)clearTimeout(timer);timer=null;controller?.abort();}else schedule(0);};
    document.addEventListener('visibilitychange',visible);void load();
    return()=>{cancelled=true;controller?.abort();if(timer)clearTimeout(timer);document.removeEventListener('visibilitychange',visible);};
  },[symbol,interval,retry]);

'''+s[end:]
 s=swap(s,'    <div className="cfd-owned-chart-canvas" ref={hostRef}/>', '    <SampledDataNote asOf={asOf} cadenceMs={SLOW_DISPLAY_REFRESH_MS}/>\n    <div className="cfd-owned-chart-canvas" ref={hostRef}/>')
 # Old direct-racing helpers are no longer used. The data source remains backend -> collector -> original OHLC provider.
 b=s.index('async function fetchEnvelope(');e=s.index('async function loadCandles(',b)
 s=s[:b]+s[e:]
 return s
edit('frontend/src/components/CfdChart.tsx',chart)

# Store policy metadata survives a disconnect; no fake freshness is minted.
edit('frontend/src/lib/liveMarketStore.ts',lambda s:swap(s,"this.state = { status: 'stale', revision: this.state.revision + 1,", "this.state = { ...this.state, status: 'stale', revision: this.state.revision + 1,"))

# Quantitative row animation must not run when data was declared stale.
edit('frontend/src/components/FuturesReferenceBook.tsx',lambda s:swap(s,"data-sampled-book={status === 'sampled' || status === 'stale' || undefined}","data-sampled-book={status === 'sampled' || undefined}"))

# Allow the existing local fixture browser runner to serve the new public contract.
# These are test-only prices. No production endpoint is contacted by this fixture.
def visual_fixture(s):
 if "'/api/v1/market/display'" in s:return s
 s=swap(s,"const { chromium } = require('/opt/node22/lib/node_modules/playwright');", "const { chromium } = (()=>{try{return require('playwright');}catch{return require('/opt/node22/lib/node_modules/playwright');}})();")
 anchor="  app.get('/api/v1/me',"
 at=s.index(anchor)
 block='''  const display=(value)=>({...value,_display:{mode:'snapshot',capturedAt:Date.now(),refreshMs:60_000}});
  const quoteRows=()=>SYMBOLS.map(pair=>{const symbol=pair.replace('/',''),price=MID[symbol];return{
    id:'linear_perpetual:'+symbol,pair,symbol:pair,provider:'bybit',providerSymbol:symbol,marketType:'linear_perpetual',
    baseAsset:pair.split('/')[0],quoteAsset:'USDT',settleAsset:'USDT',lastPrice:price,bidPrice:price-.1,askPrice:price+.1,
    high24h:price*1.05,low24h:price*.95,volume24h:100,quoteVolume24h:price*100,changePercent24h:1,indexPrice:price,markPrice:price,
    fundingRate:.0001,openInterest:100,openInterestValue:price*100,fundingIntervalMinutes:480,sequence:null,
    providerEventAt:Date.now(),fetchedAt:Date.now(),receivedAt:Date.now(),stale:false};});
  app.get('/api/v1/market/display',(_q,r)=>r.set('Cache-Control','public,max-age=60').json(display({version:1,type:'snapshot',epoch:'sampled-local',revision:1,status:'live',rows:quoteRows()})));
  app.get('/api/v1/market/display/futures-book/:symbol',(q,r)=>r.set('Cache-Control','public,max-age=60').json(display({...book(q.params.symbol),symbol:q.params.symbol,providerTime:Date.now(),fetchedAt:Date.now(),stale:false})));
  app.get('/api/v1/market/display/futures-trades/:symbol',(q,r)=>r.set('Cache-Control','public,max-age=60').json(display({symbol:q.params.symbol,trades:[{id:'sampled-tape-'+q.params.symbol,price:String(MID[q.params.symbol]),quantity:'0.01',time:Date.now(),side:'BUY'}]})));
'''
 return s[:at]+block+s[at:]
edit('scripts/qa-futures-visual-polish.cjs',visual_fixture)

Path('/tmp/sampled-display-changed.txt').write_text('\n'.join(changed))
print('\n'.join(changed))
