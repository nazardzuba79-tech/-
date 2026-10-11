import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
const frontend=resolve(__dirname,'../../..'),req=createRequire(resolve(frontend,'package.json'));
const React=req('react'),{createRoot}=req('react-dom/client'),{JSDOM}=req('jsdom');

test('account/fill updates do not rebuild unchanged chart or indicators; entry and corrected candles update independently',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{pretendToBeVisual:true});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  dom.window.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
  const setData=jest.fn(),createPriceLine=jest.fn(()=>({})),removePriceLine=jest.fn(),sma=jest.fn(()=>[]);
  const chart={addSeries:()=>({setData,applyOptions(){},priceScale:()=>({applyOptions(){}}),createPriceLine,removePriceLine}),
    applyOptions(){},timeScale:()=>({fitContent(){}}),priceScale:()=>({applyOptions(){}}),subscribeCrosshairMove(){},remove(){}};
  const imports:Record<string,unknown>={react:React,'react/jsx-runtime':req('react/jsx-runtime'),
    'lightweight-charts':{createChart:()=>chart,CandlestickSeries:{},HistogramSeries:{},LineSeries:{},ColorType:{Solid:'solid'},CrosshairMode:{Normal:0}},
    '../../../lib/indicators':{computeSMA:sma},'./TradeMarkerRail':{default:()=>null}};
  const module:any={};
  new Function('exports','require',ts.transpileModule(readFileSync(resolve(frontend,'src/pages/stocks/global/GlobalChart.tsx'),'utf8'),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(module,(name:string)=>{
      if(!(name in imports))throw Error(`Unexpected chart dependency: ${name}`);return imports[name];
    });
  const root=createRoot(document.getElementById('root'));
  const candles=[{time:100,open:10,high:12,low:9,close:11,volume:4}];
  const props={id:'BYBIT:AAPLXUSDT',interval:'15m',currency:'USDT',candles,entry:null as string|null,fills:[],error:'',loading:false,older(){}};
  const render=async(value:unknown)=>React.act(async()=>root.render(React.createElement(module.default,value)));
  try{
    await render(props);const writes=setData.mock.calls.length;expect(sma).toHaveBeenCalledTimes(1);
    await render({...props,fills:[{id:'new-fill'}]});expect(setData).toHaveBeenCalledTimes(writes);expect(sma).toHaveBeenCalledTimes(1);
    await render({...props,entry:'10.5',fills:[{id:'new-fill'}]});expect(createPriceLine).toHaveBeenCalledTimes(1);expect(setData).toHaveBeenCalledTimes(writes);expect(sma).toHaveBeenCalledTimes(1);
    await render({...props,entry:'10.5',candles:[{...candles[0],close:11.5}]});expect(setData.mock.calls.length).toBeGreaterThan(writes);expect(sma).toHaveBeenCalledTimes(2);
    expect(createPriceLine).toHaveBeenCalledTimes(1);expect(candles[0].close).toBe(11);
  }finally{await React.act(async()=>root.unmount());dom.window.close();for(const key of ['window','document','IS_REACT_ACT_ENVIRONMENT'])delete (globalThis as any)[key];}
});
