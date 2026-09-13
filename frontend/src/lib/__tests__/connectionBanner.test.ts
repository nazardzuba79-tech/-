import {readFileSync} from 'fs';
import {resolve} from 'path';
import {createRequire} from 'module';
import ts from 'typescript';
const frontend=resolve(__dirname,'../../..'),req=createRequire(resolve(frontend,'package.json'));
const {JSDOM}=req('jsdom'),React=req('react'),{act}=React;
let dom:any,root:any,host:HTMLElement,Banner:any,update:any;
const release=jest.fn(),subscribe=jest.fn((cb:any)=>{update=cb;cb('disconnected');return release;});
beforeEach(()=>{
 jest.useFakeTimers();dom=new JSDOM('<div id="root"></div>');
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 // Route DOM timers through Jest so recovery and grace periods are deterministic.
 dom.window.setTimeout=setTimeout;dom.window.clearTimeout=clearTimeout;
 host=document.getElementById('root')!;root=req('react-dom/client').createRoot(host);subscribe.mockClear();release.mockClear();
 const output:any={};const code=ts.transpileModule(readFileSync(resolve(frontend,'src/components/ConnectionBanner.tsx'),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}}).outputText;
 new Function('exports','require',code)(output,(name:string)=>name.endsWith('/i18n')?{useLanguage:()=>({t:(k:string)=>k})}:name.endsWith('/krakenSocket')?{krakenSocket:{getStatus:()=> 'disconnected',subscribeStatus:subscribe}}:req(name));Banner=output.ConnectionBanner;
});
afterEach(async()=>{await act(async()=>root.unmount());dom.window.close();jest.useRealTimers();});
async function render(props:any={}){await act(async()=>root.render(React.createElement(Banner,props)));}
async function advance(ms:number){await act(async()=>jest.advanceTimersByTime(ms));}
test('Futures observes its supplied stream, reports sustained loss and clears on recovery',async()=>{
 await render({connected:true});await advance(3000);expect(host.textContent).toBe('');expect(subscribe).not.toHaveBeenCalled();
 await render({connected:false});await advance(1999);expect(host.textContent).toBe('');await advance(1);expect(host.querySelector('[role="status"]')).not.toBeNull();
 await render({connected:true});expect(host.textContent).toBe('');await advance(3000);expect(host.textContent).toBe('');
});
test('a brief Futures reconnect does not flash a banner',async()=>{
 await render({connected:false});await advance(1000);await render({connected:true});await advance(3000);expect(host.textContent).toBe('');
});
test('Spot keeps its existing subscription, loss detection, recovery and cleanup',async()=>{
 await render();expect(subscribe).toHaveBeenCalledTimes(1);await advance(2000);expect(host.textContent).toBe('connection.lost');
 await act(async()=>update('connected'));expect(host.textContent).toBe('');
 await render({connected:true});expect(release).toHaveBeenCalledTimes(1);
});
