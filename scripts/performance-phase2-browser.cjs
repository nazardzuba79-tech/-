/** Measurement-only build; loopback fixtures, no production access. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),Module=require('node:module');
const {pathToFileURL}=require('node:url'),{gzipSync}=require('node:zlib'),{execFileSync}=require('node:child_process');
const ts=require('typescript'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),front=path.join(root,'frontend');
const label=process.argv[2]||'baseline',out=path.join(root,'output/performance-phase2',label);
fs.mkdirSync(out,{recursive:true});
const qaRequire=Module.createRequire(path.join(root,'node_modules/.cache/deposit-qa/package.json'));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const counters=`window.__perf??={};window.__count=(name,n=1)=>{const p=window.__perf;p[name]=(p[name]||0)+n;};`;
const measured=new Set(['FuturesPage','PriceChart','TerminalChart','FuturesTickerBar','FuturesOrderForm','FuturesReferenceBook','FuturesPositionsPanel','FuturesOrdersPanel','FuturesCalculator']);
const shim=path.join(os.tmpdir(),`voltex-phase2-${process.pid}.mjs`);
const chartModule=path.join(front,'node_modules/lightweight-charts/dist/lightweight-charts.production.mjs');
fs.writeFileSync(shim,`export * from ${JSON.stringify(chartModule)};
import {createChart as original,createSeriesMarkers as markers,CandlestickSeries} from ${JSON.stringify(chartModule)};
import * as renderer from ${JSON.stringify(path.join(front,'src/lib/privateResultCard.ts'))};window.__nativeQaCardRenderer=renderer;
${counters}
function wrap(o,k,p){const f=o[k].bind(o);o[k]=(...a)=>{window.__count(p+'.'+k);if(k==='setData')window.__count(p+'.points',a[0].length);const at=performance.now();try{return f(...a)}finally{window.__count(p+'.ms',performance.now()-at)}}}
export function createChart(...args){const c=original(...args);window.__nativeQaChart=c;wrap(c,'resize','chart');const add=c.addSeries.bind(c);c.addSeries=(type,...a)=>{const s=add(type,...a),p=type===CandlestickSeries?'candles':'indicator';if(type===CandlestickSeries)window.__nativeQaSeries=s;for(const k of ['setData','update','createPriceLine','removePriceLine'])wrap(s,k,p);return s};return c}
export function createSeriesMarkers(...a){const m=markers(...a);wrap(m,'setMarkers','markers');return m}`);
function instrument(){return{name:'phase2-observation-only',enforce:'pre',transform(code,id){if(!id.replaceAll('\\','/').includes('/frontend/src/')||!id.endsWith('.tsx'))return;
 const source=ts.createSourceFile(id,code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),edits=[];
 function visit(n){if(ts.isFunctionDeclaration(n)&&n.name&&measured.has(n.name.text)&&n.body)edits.push([n.body.getStart(source)+1,`window.__count?.('render.${n.name.text}');`]);ts.forEachChild(n,visit)}visit(source);
 for(const [pos,text]of edits.sort((a,b)=>b[0]-a[0]))code=code.slice(0,pos)+text+code.slice(pos);return{code,map:null};}}}
// Reuse the unchanged acceptance scenario functions, keeping their assertions.
function loadQA(){const file=path.join(__dirname,'qa-native-demo-browser.cjs');let code=fs.readFileSync(file,'utf8');code=code.slice(0,code.lastIndexOf('main().catch'));
 code=code.replace("path.join(root, 'docs/qa/native-demo', largeOnly ? 'large-numbers' : '')",JSON.stringify(out));
 code+=`;module.exports={session,ready,workspace,open,api,normalFlow,chartFlow,limitCloseContract,mobileTicketLayout,largeValues,report,startServer,stopServer,setBrowser:b=>browser=b};`;
 const mod=new Module(file,module);mod.filename=file;mod.paths=module.paths;mod._compile(code,file);return mod.exports;}
let qa,browser;
const report={label,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),scope:'Synthetic local native repository + real frontend/service. Not production latency or account data.',stages:[],routes:[],checks:[]};
let observer;
const socketTraffic={frames:0,bytes:0};
async function observe(s){const cdp=await s.context.newCDPSession(s.page);await cdp.send('Performance.enable');await cdp.send('Network.enable');
 const requests=new Map(),completed=[],frames=[];
 cdp.on('Network.requestWillBeSent',e=>requests.set(e.requestId,{url:new URL(e.request.url).pathname,method:e.request.method,at:e.timestamp}));
 cdp.on('Network.responseReceived',e=>{const r=requests.get(e.requestId);if(r){r.status=e.response.status;r.ttfb=(e.timestamp-r.at)*1000;}});
 cdp.on('Network.loadingFinished',e=>{const r=requests.get(e.requestId);if(r)completed.push({...r,ms:(e.timestamp-r.at)*1000,bytes:e.encodedDataLength});});
 cdp.on('Network.webSocketFrameReceived',e=>frames.push({at:Date.now(),bytes:Buffer.byteLength(e.response.payloadData)}));
 cdp.on('Network.eventSourceMessageReceived',e=>frames.push({at:Date.now(),bytes:Buffer.byteLength(e.data),sse:true}));
 const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
 return{cdp,completed,frames,metrics};}
async function stage(s,name,fn){const o=observer,at=Date.now(),n=o.completed.length,w=o.frames.length,m=await o.metrics(),socketStart={...socketTraffic};await s.page.evaluate(()=>window.__perf={});await fn();
 const end=await o.metrics(),stats=await s.page.evaluate(()=>window.__perf),network={};
 for(const r of o.completed.slice(n)){if(!r.url.startsWith('/api/'))continue;const key=r.method+' '+r.url;const g=network[key]??={calls:0,bytes:0,times:[],statuses:{}};g.calls++;g.bytes+=r.bytes;g.times.push(r.ms);g.statuses[r.status]=(g.statuses[r.status]||0)+1;}
 for(const g of Object.values(network)){g.times.sort((a,b)=>a-b);g.p50Ms=g.times[Math.floor(g.times.length*.5)];g.p95Ms=g.times[Math.min(g.times.length-1,Math.floor(g.times.length*.95))];g.maxMs=g.times.at(-1);delete g.times;}
 report.stages.push({name,elapsedMs:Date.now()-at,counters:stats,network,frames:o.frames.length-w,streamBytes:o.frames.slice(w).reduce((a,x)=>a+x.bytes,0),fixtureWsFrames:socketTraffic.frames-socketStart.frames,fixtureWsBytes:socketTraffic.bytes-socketStart.bytes,taskMs:(end.TaskDuration-m.TaskDuration)*1000,heapStart:m.JSHeapUsedSize,heapEnd:end.JSHeapUsedSize});
 console.log(name,JSON.stringify({counters:stats,taskMs:report.stages.at(-1).taskMs}));fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(report,null,2));}
async function fixtureSocket(context){await context.routeWebSocket('**/*',ws=>{
 if(!ws.url().includes('stream.bybit.com')){ws.close();return}let seq=1,topics=new Set();
 const send=()=>{for(const topic of topics){const symbol=topic.split('.').at(-1);if(!topic.startsWith('orderbook.'))continue;const frame=JSON.stringify({topic,type:seq===1?'snapshot':'delta',ts:Date.now(),data:{s:symbol,u:seq,seq,b:Array.from({length:25},(_,i)=>[String(49000-i*5),String(1+seq%7)]),a:Array.from({length:25},(_,i)=>[String(51000+i*5),String(1+seq%9)])}});socketTraffic.frames++;socketTraffic.bytes+=Buffer.byteLength(frame);ws.send(frame);}seq++;};
 ws.onMessage(raw=>{const m=JSON.parse(String(raw));if(m.op==='subscribe'){for(const t of m.args)topics.add(t);seq=1;send()}if(m.op==='unsubscribe')for(const t of m.args)topics.delete(t);if(m.op==='ping')ws.send(JSON.stringify({op:'pong'}));});const timer=setInterval(send,200);ws.onClose(()=>clearInterval(timer));});}
async function main(){
 const {build}=await import(pathToFileURL(path.join(front,'node_modules/vite/dist/node/index.js')).href);
 // Standard uninstrumented build for bundle sizes. Profiling counters are excluded.
 await build({root:front,define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api/v1')}});
 report.bundles=fs.readdirSync(path.join(front,'dist/assets')).filter(f=>f.endsWith('.js')).map(file=>{const b=fs.readFileSync(path.join(front,'dist/assets',file));return{file,raw:b.length,gzip:gzipSync(b).length}}).sort((a,b)=>b.raw-a.raw);
 await build({root:front,plugins:[instrument()],resolve:{alias:{'lightweight-charts':shim}},define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api/v1')}});
 qa=loadQA();await qa.startServer();browser=await qaRequire('playwright').chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});qa.setBrowser(browser);
 const s=await qa.session(1440);observer=await observe(s);await fixtureSocket(s.context);
 await stage(s,'fresh-authenticated-open',async()=>{await s.page.reload();await qa.ready(s)});
 await stage(s,'visible-empty-60s',()=>delay(60000));
 await stage(s,'open-long',()=>qa.open(s,'LONG','0.01'));
 await stage(s,'visible-active-60s',()=>delay(60000));
 await stage(s,'hidden-active-60s',async()=>{
  // Visibility contract test, not an OS background-throttling claim.
  await s.page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});await delay(60000);
 });
 await s.page.evaluate(()=>{delete document.hidden;delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});
 await stage(s,'history-scroll',async()=>{await s.page.evaluate(()=>window.__nativeQaChart.timeScale().setVisibleLogicalRange({from:-100,to:100}));await delay(1500)});
 await s.context.close();
 if(!process.argv.includes('--measure-only'))for(const width of [1440,390]){for(const name of ['normalFlow','chartFlow','limitCloseContract','largeValues']){try{const at=Date.now();await qa[name](width);report.checks.push({name:name+'-'+width,pass:true,ms:Date.now()-at})}catch(e){report.checks.push({name:name+'-'+width,pass:false,error:String(e.stack)})}}}
 const mobile=await qa.session(390);observer=await observe(mobile);await stage(mobile,'mobile-first-usable',async()=>{await mobile.page.reload();await qa.ready(mobile)});
 await stage(mobile,'mobile-workspaces-calculator',async()=>{for(const tab of ['chart','trade','positions','chart','trade'])await qa.workspace(mobile.page,tab);await mobile.page.locator('.fo-panel > .archive-calculator-slot button').click();await mobile.page.locator('.fc-panel').waitFor();});await mobile.context.close();
 // Survey request cost / failures for other routes; unimplemented fixture APIs remain errors.
 for(const route of ['/wallet','/copy-trading','/banking','/markets','/admin/deposits']){const s=await qa.session(1440);observer=await observe(s);await stage(s,route,async()=>{await s.page.goto('http://127.0.0.1:4178'+route);await delay(8000)});await s.page.screenshot({path:path.join(out,route.replaceAll('/','_')+'.png'),fullPage:true});await s.context.close();}
 report.acceptance=qa.report;assert(report.checks.every(x=>x.pass),'Acceptance scenario failed');
}
main().catch(e=>{report.failure=String(e.stack);console.error(e);process.exitCode=1}).finally(async()=>{fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(report,null,2));await browser?.close();await qa?.stopServer();fs.rmSync(shim,{force:true});});
