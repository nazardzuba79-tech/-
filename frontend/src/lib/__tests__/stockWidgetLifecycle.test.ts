import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { widgetCatalogue, widgetSymbol, widgetLocale } from '../../pages/stocks/stockWidgetCatalogue';
const frontend = resolve(__dirname, '../../..'), req = createRequire(resolve(frontend, 'package.json'));
const React = req('react'), { createRoot } = req('react-dom/client'), { JSDOM } = req('jsdom');
const source = ts.transpileModule(readFileSync(resolve(frontend,'src/pages/stocks/StockWidget.tsx'),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
}).outputText;
describe('official stock embed lifecycle without provider data access',()=>{
  let dom:any,root:any,Widget:any;
  beforeEach(()=>{
    dom=new JSDOM('<div id="root"></div>',{url:'http://localhost',pretendToBeVisual:true});
    Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
    const imports:Record<string,unknown>={react:React,'react/jsx-runtime':req('react/jsx-runtime'),
      '../../lib/i18n':{useLanguage:()=>({lang:'ru',t:(k:string)=>k})},'./StockParts':{},'./StockFacts':{},'./StockOrderPanel':{},
      './stockWidgetCatalogue':{widgetSymbol,widgetLocale},'./stockWidget.css':{},'./StockSimulator':{simulatorEnabled:false}};
    const out:any={};new Function('exports','require',source)(out,(id:string)=>{if(!(id in imports))throw Error(id);return imports[id];});
    Widget=out.StockWidget;root=createRoot(document.getElementById('root'));
  });
  afterEach(async()=>{await React.act(async()=>root.unmount());dom.window.close();for(const k of ['window','document','IS_REACT_ACT_ENVIRONMENT'])delete(globalThis as any)[k];});
  const draw=async(id:string)=>React.act(async()=>root.render(React.createElement(Widget,{instrumentId:id})));
  test('ten exact symbols; no prices, history or fabricated session changes',()=>{
    expect(widgetCatalogue.data?.instruments).toHaveLength(10);
    for(const i of widgetCatalogue.data!.instruments){expect(i.latest).toBeNull();expect(i.sessionChange).toBeNull();expect(widgetSymbol(i.instrumentId)).toBe('NASDAQ:'+i.symbol);}
    expect(widgetSymbol('NASDAQ:EVIL')).toBeNull();expect(widgetSymbol('XNGS:AAPL<script>')).toBeNull();expect(widgetLocale('zh')).toBe('zh_CN');expect(widgetLocale('hi')).toBe('en');
  });
  test('switch removes old browsing context; unmount releases frame',async()=>{
    await draw('XNGS:AAPL');const old=document.querySelector('iframe')!;
    expect(old.getAttribute('srcdoc')).toContain('"symbol":"NASDAQ:AAPL"');
    expect(old.getAttribute('srcdoc')).toContain('Track all markets on TradingView');
    await draw('XNGS:NVDA');expect(document.contains(old)).toBe(false);expect(document.querySelectorAll('iframe')).toHaveLength(1);
    expect(document.querySelector('iframe')!.getAttribute('srcdoc')).toContain('"symbol":"NASDAQ:NVDA"');
    await React.act(async()=>root.unmount());expect(document.querySelector('iframe')).toBeNull();root=createRoot(document.getElementById('root'));
  });
  test('hidden tab removes widget and remounts on visibility; unknown symbol unavailable',async()=>{
    await draw('XNGS:AAPL');Object.defineProperty(document,'hidden',{value:true,configurable:true});
    await React.act(async()=>document.dispatchEvent(new window.Event('visibilitychange')));expect(document.querySelector('iframe')).toBeNull();
    Object.defineProperty(document,'hidden',{value:false,configurable:true});await React.act(async()=>document.dispatchEvent(new window.Event('visibilitychange')));expect(document.querySelectorAll('iframe')).toHaveLength(1);
    await draw('UNKNOWN');expect(document.querySelector('iframe')).toBeNull();expect(document.body.textContent).toContain('stocks.widgetUnavailable');
  });
  test('script failure is source fenced; retry creates a new isolated context',async()=>{
    await draw('XNGS:AAPL');const old=document.querySelector('iframe')!;
    const notify=async(source:any)=>React.act(async()=>window.dispatchEvent(new window.MessageEvent('message',{origin:window.location.origin,source,data:{voltexWidget:'script-error'}})));
    await notify(window);expect(document.querySelector('.vxs-tv-error')).toBeNull();
    await notify(old.contentWindow);expect(document.body.textContent).toContain('stocks.widgetLoadError');
    await React.act(async()=>document.querySelector<HTMLButtonElement>('.vxs-tv-error button')!.click());expect(document.contains(old)).toBe(false);expect(document.querySelector('.vxs-tv-error')).toBeNull();
  });
});
