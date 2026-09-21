/** Repeated uninstrumented cold browser contexts, same current-main fixture. */
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),{pathToFileURL}=require('node:url'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),front=path.join(root,'frontend'),out=path.join(root,'output/performance-phase2/first-load');fs.mkdirSync(out,{recursive:true});
const req=Module.createRequire(path.join(root,'node_modules/.cache/deposit-qa/package.json'));
const file=path.join(__dirname,'qa-native-demo-browser.cjs');let code=fs.readFileSync(file,'utf8');code=code.slice(0,code.lastIndexOf('main().catch')).replace("path.join(root, 'docs/qa/native-demo', largeOnly ? 'large-numbers' : '')",JSON.stringify(out));
code+=';module.exports={session,ready,startServer,stopServer,setBrowser:b=>browser=b};';const mod=new Module(file,module);mod.filename=file;mod.paths=module.paths;mod._compile(code,file);const qa=mod.exports;
const base=process.argv[2];if(!/^[a-f0-9]{40}$/.test(base||''))throw Error('Pass the exact baseline SHA');
const sources=['frontend/src/components/PriceChart.tsx','frontend/src/pages/private-trading/useNativeDemo.tsx','frontend/src/pages/private-trading/useNativeHistory.ts'];
const original=new Map(sources.map(p=>[path.join(root,p).replaceAll('\\','/'),execFileSync('git',['show',`${base}:${p}`],{encoding:'utf8'})]));
let browser,serverStarted=false;const result={base,scope:'Ten fresh browser contexts per phase; real built frontend and isolated native fixture. No performance counters in build. Only the three optimized source modules substituted from the exact baseline.',runs:[]};
async function main(){const{build}=await import(pathToFileURL(path.join(front,'node_modules/vite/dist/node/index.js')).href);
 browser=await req('playwright').chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});qa.setBrowser(browser);
 for(const phase of['before','after']){
  await build({root:front,plugins:phase==='before'?[{name:'exact-baseline-input',enforce:'pre',transform(code,id){return original.has(id.replaceAll('\\','/'))?{code:original.get(id.replaceAll('\\','/')),map:null}:null}}]:[],define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api/v1')}});
  await qa.startServer();serverStarted=true;const times=[];
  for(let i=0;i<10;i++){
   const s=await qa.session(390);await qa.ready(s);
   // navigation.startTime through authoritative balance + seeded price ready,
   // including mobile Trade switch; each context has an empty browser cache.
   times.push(await s.page.evaluate(()=>performance.now()));await s.context.close();
  }
  await qa.stopServer();serverStarted=false;const sorted=[...times].sort((a,b)=>a-b);result.runs.push({phase,times,p50:sorted[4],p95:sorted[9],max:sorted[9]});
 }
 console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{result.error=String(e.stack);process.exitCode=1;console.error(e)}).finally(async()=>{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(result,null,2));await browser?.close();if(serverStarted)await qa.stopServer()});
