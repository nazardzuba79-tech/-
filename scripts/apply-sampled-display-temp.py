from pathlib import Path
import re

changed = []
def edit(path, transform):
    p = Path(path)
    old = p.read_text()
    new = transform(old)
    if new != old:
        p.write_text(new)
        changed.append(path)

def swap(text, old, new):
    if old not in text:
        if new in text: return text
        raise RuntimeError('Missing exact patch anchor: ' + old[:160])
    if text.count(old) != 1: raise RuntimeError('Ambiguous patch anchor: ' + old[:160])
    return text.replace(old, new, 1)

edit('src/index.ts', lambda s: swap(swap(s,
    "import { marketDataRouter } from './api/routes/marketData';",
    "import { marketDataRouter } from './api/routes/marketData';\nimport { displaySnapshotsRouter } from './api/routes/displaySnapshots';"),
    "app.use('/api/v1', ordersRouter(prisma, engine, marketDataService));",
    "app.use('/api/v1', displaySnapshotsRouter(liveReferenceCollector?.feed ?? null, marketDataService, marketUniverse));\napp.use('/api/v1', ordersRouter(prisma, engine, marketDataService));"))

def collector(s):
    if 'const displayTrades = new FuturesDisplayTrades();' in s: return s
    s = "import { FuturesDisplayTrades } from '../../FuturesDisplayTrades';\n" + s
    anchor = '  const futuresCandles=new FuturesChartCandles();'
    code = '''  const displayTrades = new FuturesDisplayTrades();
  app.get('/internal/v1/futures/trades/:symbol', async (req,res) => {
    try { res.json(await displayTrades.get(req.params.symbol.toUpperCase())); }
    catch(error) { res.status(error instanceof RangeError ? 400 : 503).json({error:'display_trades_unavailable'}); }
  });
'''
    return swap(s, anchor, code + anchor)
edit('src/services/marketData/live/collectorServer.ts', collector)

cache_import = "import { publicDisplayCache, DISPLAY_REFRESH_MS, SLOW_DISPLAY_REFRESH_MS } from '../middleware/publicDisplayCache';\n"
def cfd_aliases(s):
    if "router.get('/cfd/display/tickers'" in s: return s
    s = cache_import + s
    return swap(s, "  router.get('/cfd/tickers',async(_req,res)=>{", '''  // Presentation aliases have their own bounded six-hour cache. Originals and
  // all financial routes below remain unchanged and never read these entries.
  router.get('/cfd/display/tickers', publicDisplayCache(SLOW_DISPLAY_REFRESH_MS,
    body => Array.isArray(body?.tickers) && body.tickers.some((row:any) => row.price !== null && Number(row.price) > 0)),
    (req,_res,next) => { req.url=req.url.replace('/cfd/display/tickers','/cfd/tickers'); next(); });
  router.get('/cfd/display/candles/:symbol', publicDisplayCache(SLOW_DISPLAY_REFRESH_MS,
    body => Array.isArray(body?.bars) && body.bars.length > 0),
    (req,_res,next) => { req.url=req.url.replace('/cfd/display/candles/','/cfd/candles/'); next(); });
  router.get('/cfd/tickers',async(_req,res)=>{''')
edit('src/api/routes/cfd.ts', cfd_aliases)

def snapshot_alias(s):
    if "router.get('/market/display/spot-snapshot'" in s: return s
    s = cache_import + s
    return swap(s, "  router.get('/market/snapshot', async (_req, res) => {", '''  router.get('/market/display/spot-snapshot', publicDisplayCache(DISPLAY_REFRESH_MS,
    body => body?.tickers?.available === true),
    (req,_res,next) => { req.url=req.url.replace('/market/display/spot-snapshot','/market/snapshot'); next(); });
  router.get('/market/snapshot', async (_req, res) => {''')
edit('src/api/routes/marketData.ts', snapshot_alias)

# Extract pure copy from the presentational component so data helpers do not load React/CSS.
def copy_extract(s):
    start = s.find('export function sampledDisplayText(')
    end = s.find('let motionUsers = 0;')
    if start < 0: return s
    pure = s[start:end]
    Path('frontend/src/lib/sampledDisplayCopy.ts').write_text(pure)
    changed.append('frontend/src/lib/sampledDisplayCopy.ts')
    return s[:start] + "import { sampledDisplayText } from '../lib/sampledDisplayCopy';\nexport { sampledDisplayText } from '../lib/sampledDisplayCopy';\n\n" + s[end:]
edit('frontend/src/components/SampledDataNote.tsx', copy_extract)

# Never extend a server-cached six-hour observation by another full six hours on receipt.
def expiry(s):
    s = swap(s, 'type Entry = { at: number; ttl: number; value: any };', 'type Entry = { at: number; expiresAt: number; ttl: number; value: any };')
    s = swap(s, 'Date.now() - value.at >= value.ttl', '!Number.isFinite(value.expiresAt) || Date.now() >= value.expiresAt || value.expiresAt - value.at > value.ttl')
    s = swap(s, 'Date.now() - hit.at < ttl', 'Date.now() < hit.expiresAt')
    s = swap(s, "cache.delete(url); cache.set(url, { at, ttl, value });", "const maxAge = /(?:^|,)\\s*max-age=(\\d+)/i.exec(response.headers.get('cache-control') ?? '');\n        const age = Number(response.headers.get('age') ?? 0);\n        const remaining = maxAge ? Math.max(0, Number(maxAge[1]) - (Number.isFinite(age) ? age : 0)) * 1000 : ttl;\n        cache.delete(url); cache.set(url, { at, expiresAt: at + Math.min(ttl, remaining), ttl, value });")
    return s
edit('frontend/src/lib/displaySnapshotCache.ts', expiry)

# Preserve public method types and all authenticated methods; only two explicitly public GETs move.
def api(s):
    if "from './displaySnapshotCache'" not in s:
        s = "import { readDisplayJson, DISPLAY_REFRESH_MS, SLOW_DISPLAY_REFRESH_MS } from './displaySnapshotCache';\n" + s
    s = swap(s, "getMarketSnapshot: () => request<MarketSnapshotResponse>('/market/snapshot'),",
      "getMarketSnapshot: () => readDisplayJson<MarketSnapshotResponse>(`${API_BASE}/market/display/spot-snapshot`, DISPLAY_REFRESH_MS),")
    begin = s.index('  getCfdTickers: () =>')
    end = s.index("('/cfd/tickers')", begin) if "('/cfd/tickers')" in s[begin:] else -1
    if end >= 0:
        section = s[begin:end + len("('/cfd/tickers')")]
        section = section.replace('request<{', 'readDisplayJson<{', 1).replace("('/cfd/tickers')", '(`${API_BASE}/cfd/display/tickers`, SLOW_DISPLAY_REFRESH_MS)')
        s = s[:begin] + section + s[end + len("('/cfd/tickers')"):]
    elif '`${API_BASE}/cfd/display/tickers`' not in s: raise RuntimeError('CFD API anchor missing')
    return s
edit('frontend/src/lib/api.ts', api)

# Whole-market display is one cached snapshot/minute, not a stream per visitor.
edit('frontend/src/lib/useLiveMarket.ts', lambda s: swap(swap(s,
  "import { LiveMarketStore } from './liveMarketStore';",
  "import { LiveMarketStore } from './liveMarketStore';\nimport { SampledMarketSource } from './displaySnapshotCache';"),
  "new LiveMarketStore(() => new EventSource(`${base}/market/live`), true)",
  "new LiveMarketStore(() => new SampledMarketSource(`${base}/market/display`), true, { watchdogMs: 90_000, retryFloorMs: 60_000 })"))

def live_store(s):
    s = swap(s, 'constructor(private createSource: () => Source, private useWarmCache = false)',
      'constructor(private createSource: () => Source, private useWarmCache = false, private policy: { watchdogMs?: number; retryFloorMs?: number } = {})')
    s = swap(s, "this.state = { rows, status: frame.status, revision: this.state.revision + 1 }; this.emit();",
      "this.state = { rows, status: frame.status, revision: this.state.revision + 1, ...(frame._display?.mode === 'snapshot' ? { sampled: true } : {}) }; this.emit();")
    s = swap(s, "if (Date.now() - this.lastMessage > 40_000) this.failed();",
      "if (!(typeof document !== 'undefined' && document.hidden) && Date.now() - this.lastMessage > (this.policy.watchdogMs ?? 40_000)) this.failed();")
    s = swap(s, "this.schedule(Math.min(30_000, 1000 * 2 ** Math.min(this.attempts++, 5)) * (0.75 + Math.random() * 0.25));",
      "this.schedule(Math.max(this.policy.retryFloorMs ?? 0, Math.min(30_000, 1000 * 2 ** Math.min(this.attempts++, 5)) * (0.75 + Math.random() * 0.25)));")
    return s
edit('frontend/src/lib/liveMarketStore.ts', live_store)
edit('frontend/src/lib/liveMarketTypes.ts', lambda s: swap(s, 'export interface LiveState { status:', 'export interface LiveState { sampled?: boolean; status:'))
edit('frontend/src/lib/terminalPresentation.ts', lambda s: swap(s, 'now - time <= 30000', 'now - time <= (state.sampled ? 90_000 : 30_000)'))

def public_store(s):
    s = swap(s, 'const MIN_INTERVAL_MS = 3_000;', 'const MIN_INTERVAL_MS = 60_000; // Owner-approved display snapshot cadence, not execution cadence.')
    s = swap(s, 'const DEFAULT_INTERVAL_MS = 5_000;', 'const DEFAULT_INTERVAL_MS = 60_000;')
    s = swap(s, '    if (this.inFlight) return this.inFlight;', "    if (typeof document !== 'undefined' && document.hidden) return Promise.resolve();\n    if (this.inFlight) return this.inFlight;")
    return s
edit('frontend/src/lib/marketDataStore.ts', public_store)

# An explicit display-mode switch preserves the legacy transport for old integrations/rollback.
def depth_facade(s):
    if 'subscribeSampledDepth' not in s:
        s = "import { subscribeFuturesDepth as subscribeSampledDepth, setFuturesDepthFallbackBase as setSampledBase, closeSampledDepth } from './sampledDepth';\n" + s
    s = swap(s, "export type FuturesDepthStatus = 'connecting' | 'live' | 'reconnecting' | 'stale' | 'unavailable';", "export type FuturesDepthStatus = 'connecting' | 'live' | 'sampled' | 'reconnecting' | 'stale' | 'unavailable';")
    s = swap(s, "export function setFuturesDepthFallbackBase(base: string) { fallbackBase = base; }",
      "let sampledDisplay = false;\nexport function setFuturesDepthFallbackBase(base: string, sampled = false) {\n  fallbackBase = base; sampledDisplay = sampled; setSampledBase(base);\n  if (sampled) transport.close(); else closeSampledDepth();\n}")
    s = swap(s, 'export function closeFuturesDepth() { transport.close(); }', 'export function closeFuturesDepth() { transport.close(); closeSampledDepth(); }')
    s = swap(s, '  return transport.subscribe(pair, listener, onTrades);', '  return sampledDisplay ? subscribeSampledDepth(pair, listener, onTrades) : transport.subscribe(pair, listener, onTrades);')
    return s
edit('frontend/src/lib/futuresDepth.ts', depth_facade)
def close_sample(s):
    if 'export function closeSampledDepth()' in s: return s
    return s + '''
export function closeSampledDepth(): void {
  for (const state of subscriptions.values()) {
    if (state.timer) clearTimeout(state.timer);
    state.controller?.abort();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', state.visibility);
  }
  subscriptions.clear();
}
'''
edit('frontend/src/lib/sampledDepth.ts', close_sample)
edit('frontend/src/pages/FuturesPage.tsx', lambda s: swap(s,
  'setFuturesDepthFallbackBase(API_BASE);', 'setFuturesDepthFallbackBase(API_BASE, true);'))

# This book component is the production sampled ladder. Its numbers, quantitative
# bars, grouping, click payload and trades are untouched. Only decorative CSS moves.
edit('frontend/src/components/FuturesReferenceBook.tsx', lambda s: swap(s,
  'return <div className="reference-book"', 'return <div data-sampled-book={status === \'sampled\' || status === \'stale\' || undefined} className="reference-book"'))

def terminal_status(s):
    if 'sampledDisplayText' not in s:
        s = "import { sampledDisplayText } from '../lib/sampledDisplayCopy';\nimport { useSampledMotion } from './SampledDataNote';\n" + s
    s = swap(s, '  const { t } = useLanguage();', '  const { t, lang } = useLanguage();\n  useSampledMotion();')
    old = "{t(live ? 'futures.statusLive' : status === 'stale' ? 'catalogue.stale' : status === 'unavailable' ? 'trade.bookUnavailable' : 'trade.marketDelayed')}"
    new = "{status === 'sampled' ? sampledDisplayText(lang, asOf).label : t(live ? 'futures.statusLive' : status === 'stale' ? 'catalogue.stale' : status === 'unavailable' ? 'trade.bookUnavailable' : 'trade.marketDelayed')}"
    return swap(s, old, new)
edit('frontend/src/components/FuturesTerminalStatus.tsx', terminal_status)

# Homepage already persists six-hour snapshots; remove the live overlay, not the data.
edit('frontend/src/pages/home/useHeroStream.ts', lambda s: '''import type { HomeMarket } from './useHomeMarket';
import { useSampledMotion } from '../../components/SampledDataNote';

/** Owner-approved decorative preview: retain the real six-hour homepage snapshot.
 * No socket, invented candle, price tick or new trade is generated here.
 */
export function useHeroStream(market: HomeMarket): HomeMarket {
  useSampledMotion();
  return market;
}
''')
edit('frontend/src/pages/home/TerminalPreview.tsx', lambda s: swap(s,
  '<div id="home-live-terminal" className="vx-live-terminal"',
  '<div id="home-live-terminal" data-sampled-preview="true" className="vx-live-terminal"'))

# Keep the validated CFD parser and public API test seam. The API now owns the
# persistent six-hour snapshot cache so remounts/tab switching do not add reads.
def cfd_hook(s):
    before = s[:s.index('export function useCfdTickers(')]
    before = before.replace('const POLL_MS=15_000;', 'const POLL_MS=6 * 60 * 60 * 1000;')
    return before + '''export function useCfdTickers(enabled = true){
  const[tickers,setTickers]=useState<CfdTickerRow[]>([]),[configured,setConfigured]=useState(true),[loadError,setLoadError]=useState(false);
  const reloadRef=useRef<()=>void>(()=>{});
  useEffect(()=>{
    if(!enabled){reloadRef.current=()=>{};return;}
    let cancelled=false,inFlight=false;let lastAttempt=-Infinity;
    let timer:ReturnType<typeof setTimeout>|null=null;
    const schedule=(ms:number)=>{if(timer)clearTimeout(timer);timer=null;if(!cancelled&&!document.hidden)timer=setTimeout(()=>void load(),ms);};
    async function load(){
      if(cancelled||document.hidden||inFlight)return;
      inFlight=true;lastAttempt=Date.now();let delay=POLL_MS;
      try{
        const res=await api.getCfdTickers();
        if(cancelled)return;
        const rows=res&&typeof res==='object'?parseTickerPayload(res.tickers):null;
        if(rows===null)throw new Error('Invalid CFD snapshot');
        setLoadError(false);if(typeof res.configured==='boolean')setConfigured(res.configured);
        setTickers(rows.map(row=>({...row,status:row.price===null?'unavailable':row.marketClosed?'market_closed':'sampled',displayOnly:true,executionAllowed:false})));
      }catch{if(!cancelled){setLoadError(true);setTickers(old=>old.map(row=>({...row,status:'stale',stale:true})));}delay=60_000;}
      finally{inFlight=false;schedule(delay);}
    }
    const visible=()=>{if(document.hidden){if(timer)clearTimeout(timer);timer=null;}else if(Date.now()-lastAttempt>=POLL_MS)void load();else schedule(POLL_MS-(Date.now()-lastAttempt));};
    reloadRef.current=()=>void load();
    document.addEventListener('visibilitychange',visible);void load();
    return()=>{cancelled=true;if(timer)clearTimeout(timer);document.removeEventListener('visibilitychange',visible);reloadRef.current=()=>{};};
  },[enabled]);
  return{tickers,configured,loadError,reload:()=>reloadRef.current()};
}
'''
edit('frontend/src/lib/useCfdTickers.ts', cfd_hook)
def cfd_labels(s):
    if "from './sampledDisplayCopy'" not in s: s = "import { sampledDisplayText } from './sampledDisplayCopy';\n"+s
    return swap(s, "  if(q.status==='market_closed')return", "  if(q.status==='sampled')return{label:sampledDisplayText(lang,q.asOf,6*60*60*1000).label,tone:'closed'};\n  if(q.status==='market_closed')return")
edit('frontend/src/lib/cfdPresentation.ts', cfd_labels)

# Spot book: fixed snapshots, never subscribe the browser's order-book socket.
def spot_page(s):
    if "from '../lib/sampledDepth'" not in s:
        s = "import { readSpotDisplayBook } from '../lib/sampledDepth';\nimport { SampledDataNote } from '../components/SampledDataNote';\n"+s
    s = swap(s, "import { api } from '../lib/api';", "import { api, API_BASE } from '../lib/api';")
    s = s.replace("import { krakenSocket } from '../lib/krakenSocket';\n", '')
    s = swap(s, "useState<{ pair: string; bids: any[]; asks: any[] }>", "useState<{ pair: string; bids: any[]; asks: any[]; asOf?: number | null }>")
    s = swap(s, ' = useCfdTickers();', " = useCfdTickers(marketType === 'cfd');")
    s = swap(s, '    if (bookPairRef.current !== pair) return;', "    if (bookPairRef.current !== pair || marketType !== 'spot' || document.hidden) return;")
    s = swap(s, '    api\n      .getExternalOrderBook(pair)', '    readSpotDisplayBook(API_BASE, pair)')
    s = swap(s, 'setBook({ pair, bids: res.bids, asks: res.asks });', 'setBook({ pair, bids: res.bids, asks: res.asks, asOf: res.asOf });')
    begin = s.index('  const refreshBook = useCallback(')
    end = s.index('  // Primary source is Kraken', begin) if '  // Primary source is Kraken' in s[begin:] else -1
    if end >= 0:
        block = s[begin:end].replace('}, [pair]);', '}, [pair, marketType]);')
        s = s[:begin] + block + s[end:]
        start = s.index('  // Primary source is Kraken')
        finish = s.index('  function handleOrderPlaced()', start)
        s = s[:start] + '''  // DISPLAY ONLY. A snapshot/minute; local CSS animates without changing levels.
  useEffect(() => {
    bookGenerationRef.current += 1;
    if (bookShownPairRef.current !== pair) {
      setBook({ pair, bids: [], asks: [], asOf: null });setPickedPrice(null);bookShownPairRef.current=pair;
    }
    if (marketType !== 'spot') return;
    refreshBook();
    const timer=window.setInterval(()=>{if(!document.hidden)refreshBook();},60_000);
    const visible=()=>{if(!document.hidden)refreshBook();};
    document.addEventListener('visibilitychange',visible);
    return()=>{bookGenerationRef.current+=1;clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
  }, [pair,marketType,refreshBook]);

''' + s[finish:]
    # Put the marker on the existing parent, not a new layout wrapper.
    s,n = re.subn(r'(<(?:aside|div)\s+className="orderbook-area"[^>]*)(>)',r'\1 data-sampled-book="true"\2',s,count=1)
    if n != 1 and 'data-sampled-book="true"' not in s: raise RuntimeError('Spot book parent not found')
    s = swap(s, '<OrderBookPanel', '<SampledDataNote asOf={book.pair === pair ? book.asOf : null} />\n                <OrderBookPanel')
    return s
edit('frontend/src/pages/TradePage.tsx', spot_page)

# Build-time record of exactly what this assembly may commit; never glob a repo.
Path('/tmp/sampled-display-changed.txt').write_text('\n'.join(dict.fromkeys(changed)))
print('\n'.join(changed))
