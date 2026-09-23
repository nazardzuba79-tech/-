from pathlib import Path
import subprocess
changed=[]
def edit(path,fn):
 p=Path(path);old=p.read_text();new=fn(old)
 if old!=new:p.write_text(new);changed.append(path)
def swap(s,a,b):
 if a not in s:
  if b in s:return s
  raise RuntimeError('Missing reviewed anchor: '+a[:160])
 if s.count(a)!=1:raise RuntimeError('Ambiguous reviewed anchor: '+a[:160])
 return s.replace(a,b,1)

# resetModules clears global mock call histories. Verify the first network read
# BEFORE reset and use a new spy to prove the restored snapshot does no IO.
def budget(s):
 s=swap(s,"await browserModule().readDisplayJson(url,ttl);jest.resetModules();await browserModule().readDisplayJson(url,ttl);expect(fetch).toHaveBeenCalledTimes(1);", "await browserModule().readDisplayJson(url,ttl);expect(fetch).toHaveBeenCalledTimes(1);\n  jest.resetModules();global.fetch=jest.fn(async()=>response(snap({tickers:[]},ttl),21600));\n  await browserModule().readDisplayJson(url,ttl);expect(fetch).not.toHaveBeenCalled();")
 anchor=" test('one subscriber cancellation does not abort another subscriber',async()=>{"
 add=""" test('remaining cache lifetime survives remount rather than resetting a six-hour timer',async()=>{
  const ttl=21_600_000,url='/api/v1/cfd/display/candles/XAUUSD?interval=1h';
  global.fetch=jest.fn(async()=>response(snap({bars:[]},ttl),1800));const {readDisplayJson,displayRefreshDelay}=browserModule();
  await readDisplayJson(url,ttl);expect(displayRefreshDelay(url,ttl)).toBe(1_800_000);
  await jest.advanceTimersByTimeAsync(1_200_000);await readDisplayJson(url,ttl);
  expect(fetch).toHaveBeenCalledTimes(1);expect(displayRefreshDelay(url,ttl)).toBe(600_000);
 });
"""
 if add not in s:s=swap(s,anchor,add+anchor)
 return s
edit('src/api/routes/__tests__/sampledDisplayBudget.test.ts',budget)

def cache(s):
 anchor='/** EventSource-shaped adapter, but performs one bounded GET/minute and opens NO stream. */'
 code='''/** Remaining local lifetime, so a remount cannot postpone the next observation by a full interval. */
export function displayRefreshDelay(url: string, ttl: number): number {
  hydrate();
  const item = cache.get(url);
  return item && item.ttl === ttl ? Math.max(1000, Math.min(ttl, item.expiresAt - Date.now())) : ttl;
}

'''
 if code not in s:s=swap(s,anchor,code+anchor)
 s=swap(s,'this.schedule(Math.max(0, DISPLAY_REFRESH_MS - (Date.now() - this.lastAttempt)));','this.schedule(0); // The shared snapshot cache enforces remaining TTL on visibility resume.')
 s=swap(s,'const controller = new AbortController(); this.controller = controller; this.lastAttempt = Date.now();','const controller = new AbortController(); this.controller = controller; this.lastAttempt = Date.now();\n    let delay = DISPLAY_REFRESH_MS;')
 s=swap(s,'const body = await readDisplayJson(this.url, DISPLAY_REFRESH_MS, controller.signal);','const body = await readDisplayJson(this.url, DISPLAY_REFRESH_MS, controller.signal);\n      delay = displayRefreshDelay(this.url, DISPLAY_REFRESH_MS);')
 return swap(s,'this.controller = null; this.schedule(DISPLAY_REFRESH_MS);','this.controller = null; this.schedule(delay);')
edit('frontend/src/lib/displaySnapshotCache.ts',cache)
edit('src/api/middleware/publicDisplayCache.ts',lambda s:swap(s,"res.setHeader('X-VOLTEX-Display', 'snapshot');","res.setHeader('Access-Control-Expose-Headers', 'Age, X-VOLTEX-Display, X-VOLTEX-Refresh-Seconds');\n    res.setHeader('X-VOLTEX-Display', 'snapshot');"))

def cfdhook(s):
 line="import { displayRefreshDelay, SLOW_DISPLAY_REFRESH_MS } from './displaySnapshotCache';\n"
 if line not in s:s=line+s
 s=swap(s,"import { api } from './api';","import { api, API_BASE } from './api';")
 s=swap(s,"if(rows===null)throw new Error('Invalid CFD snapshot');","if(rows===null)throw new Error('Invalid CFD snapshot');\n        delay=displayRefreshDelay(`${API_BASE}/cfd/display/tickers`,SLOW_DISPLAY_REFRESH_MS);")
 return swap(s,'else if(Date.now()-lastAttempt>=POLL_MS)void load();else schedule(POLL_MS-(Date.now()-lastAttempt));','else void load();')
edit('frontend/src/lib/useCfdTickers.ts',cfdhook)
edit('frontend/src/components/CfdChart.tsx',lambda s:swap(swap(s,'import { readDisplayJson, SLOW_DISPLAY_REFRESH_MS }','import { readDisplayJson, displayRefreshDelay, SLOW_DISPLAY_REFRESH_MS }'),'const rows=snapshot.rows;','delay=displayRefreshDelay(`${API_BASE}/cfd/display/candles/${encodeURIComponent(symbol)}?interval=${interval}&limit=320`,SLOW_DISPLAY_REFRESH_MS);\n        const rows=snapshot.rows;'))

def cfdtest(s):
 s=swap(s,"new Function('require','exports','window',compiled)","new Function('require','exports','window','document',compiled)")
 s=swap(s,"if(name.endsWith('/api'))return{api,ApiError:Error};","if(name.endsWith('/api'))return{api,ApiError:Error,API_BASE:'/api/v1'};")
 s=swap(s,"    return req(name);","    if(name.endsWith('/sampledDepth'))return{readSpotDisplayBook:()=>Promise.resolve({bids:[],asks:[],asOf:null})};\n    return req(name);")
 line="    if(name.endsWith('/displaySnapshotCache'))return{displayRefreshDelay:()=>6*60*60*1000,SLOW_DISPLAY_REFRESH_MS:6*60*60*1000};\n"
 if line not in s:s=swap(s,"    if(name==='react')",line+"    if(name==='react')")
 s=swap(s,"},output,{setInterval,clearInterval});","},output,{setInterval,clearInterval,setTimeout,clearTimeout},{hidden:false,addEventListener:jest.fn(),removeEventListener:jest.fn()});")
 s=swap(s,"expect(source).toContain('/cfd/candles/');","expect(source).toContain('/cfd/display/candles/');")
 s=swap(s,'ticker hook polls every 15 seconds and keeps last good rows after a failed refresh','ticker hook samples every six hours and keeps last good rows after a failed refresh')
 s=swap(s,'jest.advanceTimersByTime(15000);await tick();','jest.advanceTimersByTime(6*60*60*1000-1);await tick();expect(getCfdTickers).toHaveBeenCalledTimes(1);jest.advanceTimersByTime(1);await tick();')
 return s.replace('hook.render()','hook.render(true)')
edit('frontend/src/lib/__tests__/cfdTerminal.test.ts',cfdtest)

def cfdonly(s):
 s=s.replace('CFD chart has two real OHLC paths and no explanatory customer copy','CFD chart samples real OHLC through the cached backend with no duplicate direct request')
 s=s.replace("expect(chart).toContain('/cfd/candles/');","expect(chart).toContain('/cfd/display/candles/');")
 s=s.replace("expect(chart).toContain('https://biquote.io/api/');","expect(chart).not.toContain('https://biquote.io/api/');")
 return s.replace("expect(chart).toContain('firstSuccess');","expect(chart).toContain('readDisplayJson');expect(chart).toContain('SLOW_DISPLAY_REFRESH_MS');expect(chart).toContain('SampledDataNote');\n  const route=readFileSync(resolve(process.cwd(),'src/api/routes/cfd.ts'),'utf8');\n  expect(route).toContain('collectorDisplay.getOhlc');expect(route).toContain('biquoteOhlc.getOhlc');")
edit('frontend/src/lib/__tests__/cfdDisplayOnly.test.ts',cfdonly)

home_test='''import { readFileSync } from 'fs';
import { resolve } from 'path';
import ts from 'typescript';
const compile=(path:string)=>ts.transpileModule(readFileSync(resolve(__dirname,'../..',path),'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022},
}).outputText;
test.each(['kraken','other-provider',''])('homepage preserves its received %s snapshot and never attaches a live overlay',source=>{
 const useSampledMotion=jest.fn(),output:any={};
 new Function('require','exports',compile('pages/home/useHeroStream.ts'))((name:string)=>{
  if(name.endsWith('/SampledDataNote'))return{useSampledMotion};throw new Error(`Unexpected homepage stream dependency: ${name}`);
 },output);
 const market={tickerSource:source,hero:{pair:'BTC/USDT',updatedAt:1700000000000,
  candles:[{time:1700000000,open:100,high:110,low:90,close:105}],book:{bids:[{price:'104',quantity:'2'}],asks:[{price:'106',quantity:'3'}]},trades:[]}};
 const frozen=JSON.stringify(market);expect(output.useHeroStream(market)).toBe(market);
 expect(JSON.stringify(market)).toBe(frozen);expect(useSampledMotion).toHaveBeenCalledTimes(1);
});
test('shared local animation pauses when hidden, resumes idempotently and cleans up the last subscriber',()=>{
 const disposers:(()=>void)[]=[],listeners=new Set<()=>void>();
 const document={hidden:false,documentElement:{dataset:{} as Record<string,string>},
  addEventListener:jest.fn((_type:string,fn:()=>void)=>listeners.add(fn)),removeEventListener:jest.fn((_type:string,fn:()=>void)=>listeners.delete(fn))};
 const output:any={};
 new Function('require','exports','document',compile('components/SampledDataNote.tsx'))((name:string)=>{
  if(name==='react')return{useEffect:(fn:()=>()=>void)=>disposers.push(fn())};if(name.endsWith('/i18n'))return{};
  if(name.endsWith('/sampledDisplayCopy'))return{sampledDisplayText:()=>({label:'Snapshot',title:'Sampled'})};
  if(name.endsWith('.css')||name==='react/jsx-runtime')return{};throw new Error(name);
 },output,document);
 output.useSampledMotion();output.useSampledMotion();expect(document.addEventListener).toHaveBeenCalledTimes(1);
 expect(document.documentElement.dataset.sampledMotion).toBe('running');document.hidden=true;listeners.forEach(fn=>fn());
 expect(document.documentElement.dataset.sampledMotion).toBe('paused');document.hidden=false;listeners.forEach(fn=>fn());
 expect(document.documentElement.dataset.sampledMotion).toBe('running');disposers[0]();expect(listeners.size).toBe(1);
 disposers[1]();expect(listeners.size).toBe(0);expect(document.removeEventListener).toHaveBeenCalledTimes(1);
 expect(document.documentElement.dataset.sampledMotion).toBeUndefined();
});
'''
edit('frontend/src/lib/__tests__/homeHeroVisibility.test.ts',lambda _:home_test)

# The actual shipped homepage uses SapphireTerminal; both renderers receive motion only.
edit('frontend/src/pages/home/SapphireTerminal.tsx',lambda s:swap(s,'<div id="home-live-terminal" className=','<div id="home-live-terminal" data-sampled-preview="true" className='))
edit('frontend/src/pages/trade-terminal/SampledDisplay.css',lambda s:s.replace('[data-sampled-preview="true"] .vx-book-row','[data-sampled-preview="true"] :is(.vx-book-row,.book-row)').replace('[data-sampled-preview="true"] .vx-terminal-chart','[data-sampled-preview="true"] :is(.vx-terminal-chart,.hs-chart)'))
edit('frontend/src/lib/sampledDisplayCopy.ts',lambda s:swap(s,"    hi: ['स्नैपशॉट'","    ja: ['スナップショット', '取得済みデータのローカルアニメーション。新しい約定やリアルタイムの板情報ではありません'],\n    ko: ['스냅샷', '수신된 데이터의 로컬 애니메이션이며 신규 체결이나 실시간 호가가 아닙니다'],\n    hi: ['स्नैपशॉट'"))

def fixture(s):
 s=swap(s,' const p=req.path;'," const sampled=req.path==='/cfd/display/tickers';\n if(sampled){const original=res.json.bind(res);res.json=body=>original({...body,_display:{mode:'snapshot',capturedAt:Date.now(),refreshMs:21600000}});res.set('Cache-Control','public,max-age=21600');}\n const p=sampled?'/cfd/tickers':req.path;")
 return s.replace('cfd\\/tickers','cfd\\/(?:display\\/)?tickers')
for p in ['scripts/qa-home-laptop-first-load.cjs','scripts/qa-home-snapshot-reload.cjs']:edit(p,fixture)

def native_fixture(s):
 if 'const sampledDisplay = value =>' in s:return s
 anchor="app.get('/api/v1/market/live'";i=s.index(anchor)
 block='''// Public sampled display contract, backed by the SAME local fixture source used below.
const sampledDisplay = value => ({...value,_display:{mode:'snapshot',capturedAt:now(),refreshMs:60000}});
app.get('/api/v1/market/display',asyncRoute(async(_req,res)=>{
 const rows=await tickers();res.set('Cache-Control','public,max-age=60').json(sampledDisplay({version:1,type:'snapshot',status:rows.some(r=>r.stale)?'stale':'live',rows,revision:1,epoch:String(started)}));
}));
app.get('/api/v1/market/display/futures-book/:symbol',asyncRoute(async(req,res)=>{
 const symbol=req.params.symbol,q=await market.freshQuote(symbol);
 res.set('Cache-Control','public,max-age=60').json(sampledDisplay({available:true,symbol,providerTime:q.providerTimestamp,fetchedAt:q.fetchedAt,stale:false,updateId:1,bids:q.bids,asks:q.asks}));
}));
app.get('/api/v1/market/display/futures-trades/:symbol',(_req,res)=>res.set('Cache-Control','public,max-age=60').json(sampledDisplay({symbol:_req.params.symbol,trades:[]})));
'''
 return s[:i]+block+s[i:]
edit('scripts/serve-native-demo-review.cjs',native_fixture)

def cfd_browser(s):
 s=s.replace('The browser is loopback-only except for\n * the read-only BiQuote OHLC fallback,','The browser is loopback-only; the backend retains its real\n * public-provider fallback,')
 s=s.replace("    if(width===1280&&u.origin===origin&&u.pathname.startsWith('/api/v1/cfd/candles/'))return route.fulfill({status:503,contentType:'application/json',body:'{\"error\":\"forced_api_candle_failure\"}'});\n",'')
 s=s.replace("    if(u.hostname==='biquote.io'&&u.pathname.includes('/ohlc'))return route.continue();\n",'')
 s=swap(s,'  const page=await context.newPage();',"  const displayRequests=[];context.on('request',req=>{if(new URL(req.url()).pathname.startsWith('/api/v1/cfd/display/'))displayRequests.push(req.url());});\n  const page=await context.newPage();")
 s=s.replace('forcedDirectOhlc:width===1280','sampledDisplay:true')
 a='await page.screenshot({path:path.join(OUT,`cfd-working-${width}.png`),fullPage:true});await context.close();activePage=null;'
 b='''await page.screenshot({path:path.join(OUT,`cfd-working-${width}.png`),fullPage:true});
  const before=displayRequests.length;await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('.cfd-owned-chart')?.getAttribute('data-chart-status')==='ready',{timeout:15000});
  await page.waitForTimeout(1000);
  if(displayRequests.length!==before)report.findings.push(`CFD snapshot was re-downloaded on reload at ${width}px`);
  if(!await page.locator('[data-sampled-note][data-refresh-ms="21600000"]').count())report.findings.push(`Missing six-hour snapshot marker at ${width}px`);
  await context.close();activePage=null;'''
 return swap(s,a,b)
edit('scripts/qa-cfd-display-browser.cjs',cfd_browser)

def coverage(s):
 extra="      - 'frontend/src/lib/api.ts'\n      - 'frontend/src/lib/displaySnapshotCache.ts'\n      - 'frontend/src/lib/sampledDisplayCopy.ts'"
 if extra not in s:s=s.replace("      - 'frontend/src/lib/api.ts'",extra)
 return s
edit('.github/workflows/copy-trading-card-regression.yml',coverage)

# This is ONE reviewed behavioural fingerprint, not a blanket baseline reset.
# The page change is only the approved boolean opting into sampled depth.
edit('frontend/src/lib/__tests__/futuresUiPolish.test.ts',lambda s:swap(s,'"9bc4a84e1302b2d9931e96e94a1816c193047db89459cf4dc7e765b3f8eedfac"','// Owner-approved sampled-display switch: only setFuturesDepthFallbackBase(API_BASE, true).\n    // Order payload, engine, overlays, symbols and account polling remain unchanged.\n    "581c7db42f7d2b3d6ec6b6ad5d452fa2926043f95ddaca6c339f9d20afcb4c2c"'))
Path('/tmp/sampled-display-changed.txt').write_text('\n'.join(changed))
print('\n'.join(changed))
