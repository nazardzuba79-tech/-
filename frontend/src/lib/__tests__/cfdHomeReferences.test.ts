import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
const frontend=resolve(__dirname,'../../..'),req=createRequire(resolve(frontend,'package.json'));
const React=req('react'),{renderToStaticMarkup}=req('react-dom/server'),{JSDOM}=req('jsdom');
const modules=new Map<string,any>();
function load(file:string):any {
  for(const suffix of ['', '.tsx', '.ts'])if(existsSync(file+suffix)){file+=suffix;break;}
  if(modules.has(file))return modules.get(file);const output:any={};modules.set(file,output);
  const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('exports','require',code)(output,(name:string)=>{
    if(name.endsWith('.css'))return {};
    if(name.endsWith('/i18n'))return {useLanguage:()=>({lang:'en',t:(key:string)=>key})};
    return name.startsWith('.')?load(resolve(dirname(file),name)):req(name);
  });return output;
}
function card(tickers:any[],name='oil') {
  const {HomeHeroAssets}=load(resolve(frontend,'src/pages/home/HomeHeroAssets'));
  const market={hero:{pair:'BTC/USDT',livePrice:null},tickers:[],tickersStale:false,priceHistory:{},cfdPriceHistory:{XAUUSD:[1,2,3]},cfd:{configured:true,tickers}};
  const html=renderToStaticMarkup(React.createElement(HomeHeroAssets,{market,englishLabels:true}));
  const dom=new JSDOM(html);const el=dom.window.document.querySelector(`.vx-asset-${name}`)!;
  const result={text:el.textContent??'',spark:el.querySelector('.vx-asset-spark')!==null};dom.window.close();return result;
}
test('OIL consumes exact WTI and visibly credits the dated daily reference',()=>{
  const result=card([{symbol:'WTIUSD',price:'52.25',displayOnly:true,referenceLabel:'Daily reference · U.S. EIA · 2026-09-11',changePercent24h:'99'}]);
  expect(result.text).toContain('OIL');expect(result.text).toContain('52.25');expect(result.text).toContain('U.S. EIA');expect(result.text).toContain('2026-09-11');expect(result.text).not.toContain('99.00%');expect(result.spark).toBe(false);
});
test('Brent is not silently substituted for missing WTI on the homepage',()=>{
  const result=card([{symbol:'XBRUSD',price:'999.25'}]);expect(result.text).not.toContain('999.25');expect(result.text).toContain('—');
});
test('home reference preserves actual zero and negative prices while null stays unknown',()=>{
  expect(card([{symbol:'WTIUSD',price:'0',displayOnly:true}]).text).toContain('0.00');
  expect(card([{symbol:'WTIUSD',price:'-1.25',displayOnly:true}]).text).toContain('-1.25');
  const result=card([{symbol:'WTIUSD',price:null,displayOnly:true}]);expect(result.text).toContain('—');expect(result.text).not.toContain('0.00');
});
test('indicative metal reference is sourced without turning repeated samples into a sparkline',()=>{
  const result=card([{symbol:'XAUUSD',price:'2010.25',displayOnly:true,referenceLabel:'Indicative · Gold API · 2026-09-11',changePercent24h:'12'}],'gold');
  expect(result.text).toContain('GOLD');expect(result.text).toContain('Gold API');expect(result.text).not.toContain('12.00%');expect(result.spark).toBe(false);
});
