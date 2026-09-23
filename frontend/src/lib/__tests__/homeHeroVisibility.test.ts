import { readFileSync } from 'fs';
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
