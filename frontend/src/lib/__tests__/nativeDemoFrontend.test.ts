import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

const frontend=resolve(__dirname,'../../..');
const req=createRequire(resolve(frontend,'package.json'));
const React=req('react');
function load(file:string,imports:Record<string,unknown>={}){
  const output:any={};
  const source=readFileSync(resolve(frontend,'src',file),'utf8').replace(/import\.meta\.env\.VITE_API_URL/g,'undefined');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require','exports',code)((name:string)=>name in imports?imports[name]:name.endsWith('.css')?{}:req(name),output);
  return output;
}
let token:string|null='owner-token';
const privateApi=load('lib/privateTradingApi.ts',{'./api':{getToken:()=>token}});
const nativeApi=load('lib/nativeDemoApi.ts',{'./api':{getToken:()=>token},'./privateTradingApi':privateApi});
const reply=(body:unknown,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body}) as Response;
function nodes(node:any):any[]{return !node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];}
function text(node:any):string{return node===null||node===undefined||typeof node==='boolean'?'':typeof node!=='object'?String(node):Array.isArray(node)?node.map(text).join(''):text(node.props?.children);}
/** Expand function components so the rendered tree can be inspected without a DOM. */
function expand(node:any):any{
  if(Array.isArray(node))return node.map(expand);
  if(!node||typeof node!=='object')return node;
  if(typeof node.type==='function')return expand(node.type(node.props));
  return {...node,props:{...node.props,children:expand(node.props?.children)}};
}
function hooksReact(){
  let cursor=0;const hooks:any[]=[];
  const react={...React,
    useState(initial:any){const i=cursor++;if(!(i in hooks))hooks[i]=typeof initial==='function'?initial():initial;return[hooks[i],(next:any)=>{hooks[i]=typeof next==='function'?next(hooks[i]):next;}];},
    useRef(initial:any){const i=cursor++;if(!(i in hooks))hooks[i]={current:initial};return hooks[i];},
    useEffect(){},useCallback(fn:any){return fn;}};
  return{react,reset:()=>{cursor=0;}};
}
const position=(extra:object={})=>({id:'native-p1',symbol:'BTCUSDT',side:'LONG',quantity:'2',entryPrice:'50000',markPrice:'51000',lastPrice:'51000',leverage:'20',status:'OPEN',openedAt:1_700_000_000_000,closedAt:null,historical:false,
  unrealizedPnl:'2000',realizedPnl:'-55',netPnl:'1945',roiPercent:'40',roiBasis:'5000',closedRoiBasis:'0',fundingNet:'0',protection:{takeProfit:null,stopLoss:null,quantity:null,triggerBy:'MARK'},liquidationPrice:null,liquidationStatus:'ACCOUNT_CROSS_ESTIMATE',...extra});
const state=(extra:object={})=>({initialized:true,revision:7,source:'DEMO_BALANCE',asOf:1_700_000_100_000,model:{version:'VOLTEX_NATIVE_CROSS_V2',funding:{longCashflow:'-0.001',shortCashflow:'0.004',unit:'FRACTION',intervalMs:28_800_000}},
  account:{walletBalance:'10000000',initialDeposit:'10000000',unrealizedPnl:'2000',equity:'10002000',usedMargin:'5100',orderReserve:'0',available:'9996900',maintenanceMargin:'1122',maintenanceRatio:'0.0001',liquidatable:false,deficit:'0'},
  positions:[position()],history:[],orders:[],events:[],entries:[],...extra});
function controller(extra:object={}){
  const calls:any[]=[];
  return{calls,c:{requested:true,allowed:true,checked:true,state:state(),error:'',busy:false,card:null,setCard(){},dialog:null,setDialog:(d:any)=>calls.push(['dialog',d]),candle:null,setCandle(){},exitId:null,setExitId(){},selectedId:null,
    toggle:(v:boolean)=>calls.push(['toggle',v]),run:async(d:any)=>{calls.push(['run',d]);return true;},initialize(){},showCard(){},interaction:{},loader(){},selectEntry(){},exitOnChart(){},fail(){},pickEntry(){},...extra}};
}
function controls(){
  const h=hooksReact();
  const module=load('pages/private-trading/NativeDemoControls.tsx',{react:h.react,'../../lib/privateTradingApi':privateApi,'../../lib/nativeDemoApi':nativeApi,'./PrivateResultCardDialog':{PrivateResultCardDialog:()=>null}});
  return{module,h};
}

describe('native demo frontend',()=>{
  test('custom funding coefficients are shown as percent without floating point drift',()=>{
    expect(nativeApi.nativeFundingPercent('-0.001')).toBe('−0.1%');
    expect(nativeApi.nativeFundingPercent('0.004')).toBe('+0.4%');
    expect(nativeApi.nativeFundingPercent('0.0001')).toBe('+0.01%');
    expect(nativeApi.nativeFundingPercent('0')).toBe('0%');
    expect(nativeApi.nativeFundingPercent('abc')).toBe('—');
  });
  test('client sends the bearer and the idempotency key, maps server text, and never sends without a session',async()=>{
    const seen:any[]=[];token='owner-token';
    const client=nativeApi.createNativeDemoClient('/api/v1',()=>token,async(url:string,init:any)=>{seen.push([url,init]);return reply({initialized:true});});
    await client.command({kind:'REFRESH'},'refresh-key-1');
    expect(seen[0][0]).toBe('/api/v1/private-trading/native/commands');
    expect(seen[0][1]).toMatchObject({method:'POST',cache:'no-store',headers:{Authorization:'Bearer owner-token'}});
    expect(JSON.parse(seen[0][1].body)).toEqual({kind:'REFRESH',idempotencyKey:'refresh-key-1'});
    const failing=nativeApi.createNativeDemoClient('/api/v1',()=>token,async()=>reply({code:'CONTRACT_LIMIT',error:'Одновременно можно держать не более 6 разных контрактов.'},409));
    await expect(failing.state()).rejects.toMatchObject({status:409,message:'Одновременно можно держать не более 6 разных контрактов.'});
    token=null;
    await expect(client.state()).rejects.toMatchObject({status:401});
    expect(seen).toHaveLength(1);
    token='owner-token';
    expect(()=>client.getCard('native:1:../../admin')).toThrow();
  });
  test('Real/Demo switch lives inside the terminal trading panel, not in the crowded global header',()=>{
    const page=readFileSync(resolve(frontend,'src/pages/FuturesPage.tsx'),'utf8');
    expect(page).toContain('rightExtra={native.allowed?undefined:<PrivateTradingEntry/>}');
    const formArea=page.slice(page.indexOf('<div className="order-form-area">'),page.indexOf('<div className="bottom-panel"'));
    expect(formArea).toContain('<NativeDemoSwitch controller={native}/>');
    const {module}=controls();const {c,calls}=controller();
    const tree=module.NativeDemoSwitch({controller:c});
    const [real,demo]=nodes(tree).filter(n=>n.type==='button');
    expect([real.props['aria-pressed'],demo.props['aria-pressed']]).toEqual([false,true]);
    real.props.onClick();expect(calls).toEqual([['toggle',false]]);
    expect(module.NativeDemoSwitch({controller:{...c,allowed:false}})).toBeNull();
  });
  test('positions show the Cross liquidation estimate, or — when collateral makes it unreachable',()=>{
    const {module,h}=controls();
    const withPrice=controller({state:state({positions:[position(),position({id:'native-p2',liquidationPrice:'47692.2',side:'SHORT'})]})});
    h.reset();const tree=expand(module.NativeDemoPanel({controller:withPrice.c}));
    const header=nodes(tree).filter(n=>n.type==='th').map(text);
    expect(header).toContain('Цена ликв.');
    const rows=nodes(tree).filter(n=>n.type==='tr').slice(1).map(r=>nodes(r).filter(n=>n.type==='td').map(text));
    const liqColumn=header.indexOf('Цена ликв.');
    expect(rows.map(r=>r[liqColumn])).toEqual(['—','47,692.20']);
    expect(text(tree)).toContain('Ревизия 7');
  });
  test('closed history uses the recorded exit price and the closed margin basis',()=>{
    const {module,h}=controls();
    const closed=position({status:'CLOSED',closedAt:1_700_000_050_000,netPnl:'-1109.45',roiPercent:'-22.189',roiBasis:'0',closedRoiBasis:'5000',historical:true});
    const {c}=controller({state:state({positions:[],history:[closed],events:[{id:'e2',kind:'STOP_LOSS',time:1_700_000_050_000,positionId:'native-p1',orderId:null,symbol:'BTCUSDT',quantity:'2',price:'49500',fee:'54.45',cashflow:'-1054.45',pricing:'OHLC_PATH_MODEL'}]})});
    h.reset();const first=expand(module.NativeDemoPanel({controller:c}));
    const tab=nodes(first).find(n=>n.type==='button'&&text(n)==='История позиций');tab.props.onClick();
    h.reset();const tree=expand(module.NativeDemoPanel({controller:c}));
    const header=nodes(tree).filter(n=>n.type==='th').map(text);
    const row=nodes(nodes(tree).filter(n=>n.type==='tr')[1]).filter(n=>n.type==='td').map(text);
    expect(row[header.indexOf('Цена выхода')]).toBe('49,500.00');
    expect(row[header.indexOf('Маржа')]).toBe('5,000.00');
    expect(row[header.indexOf('Закрыть')]).toBe('Закрыта');
    expect(row[0]).toContain('Historical Test');
  });
  test('a limit placed on a selected historical candle is sent with the candle open (owner wick rule) and decimal strings only',async()=>{
    const {module,h}=controls();
    const candle={symbol:'BTCUSDT',interval:'1h',openTime:1_700_000_000_000,open:1,high:1,low:1,close:1};
    const {c,calls}=controller({candle});
    h.reset();let tree=module.NativeDemoTicket({controller:c,symbol:'BTC/USDT'});
    nodes(tree).find(n=>n.type==='button'&&text(n)==='Лимитный').props.onClick();
    h.reset();tree=module.NativeDemoTicket({controller:c,symbol:'BTC/USDT'});
    expect(text(tree)).toContain('Buy исполняется, если Low ≤ цены');
    expect(nodes(tree).some(n=>n.type==='select')).toBe(false);
    nodes(tree).find(n=>n.props?.['aria-label']==='Лимитная цена').props.onChange({target:{value:'49000.5'}});
    h.reset();tree=module.NativeDemoTicket({controller:c,symbol:'BTC/USDT'});
    await nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
    expect(calls).toEqual([['run',{kind:'OPEN',symbol:'BTC/USDT',side:'LONG',type:'LIMIT',margin:'5000',leverage:'10',price:'49000.5',
      candle:{source:'BYBIT_LINEAR',interval:'1h',openTime:1_700_000_000_000,pricePoint:'OPEN'},protection:{takeProfit:null,stopLoss:null}}]]);
  });
  test('ticket discloses the custom funding model and never calls it Bybit funding',()=>{
    const {module,h}=controls();const {c}=controller();
    h.reset();const tree=module.NativeDemoTicket({controller:c,symbol:'BTC/USDT'});
    const all=text(tree);
    expect(all).toContain('Long −0.1%, Short +0.4% от стоимости позиции каждые 8 ч UTC');
    expect(all).toContain('не исторический funding Bybit');
    expect(all).toContain('Поддерживающая маржа');
  });
});
