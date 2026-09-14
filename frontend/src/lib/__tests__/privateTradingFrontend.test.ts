import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

const frontend=resolve(__dirname,'../../..');
const req=createRequire(resolve(frontend,'package.json'));
const React=req('react');
function load(file:string,imports:Record<string,unknown>={}){
  const output:any={};
  const source=readFileSync(resolve(frontend,'src',file),'utf8').replace('import.meta.env.VITE_API_URL','undefined');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require','exports',code)((name:string)=>name in imports?imports[name]:name.endsWith('.css')?{}:req(name),output);
  return output;
}
const api=load('lib/privateTradingApi.ts',{'./api':{getToken:()=>null}});
const cardRenderer=load('lib/privateResultCard.ts',{'./privateTradingApi':api});
const reply=(body:unknown,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body}) as Response;

function mount(file:string,name:string,initialProps:any,imports:Record<string,unknown>={}){
  let cursor=0,props=initialProps;
  const hooks:any[]=[],effects:(()=>void)[]=[];
  const react={...React,useState(initial:any){const i=cursor++;if(!(i in hooks))hooks[i]=typeof initial==='function'?initial():initial;return[hooks[i],(next:any)=>{hooks[i]=typeof next==='function'?next(hooks[i]):next;}];},useRef(initial:any){const i=cursor++;return hooks[i]??(hooks[i]={current:initial});},useEffect(fn:()=>any,deps:any[]){const i=cursor++,previous=hooks[i];if(!previous||deps.some((v,j)=>!Object.is(v,previous.deps[j]))){hooks[i]={deps};effects.push(()=>{previous?.cleanup?.();hooks[i].cleanup=fn();});}},useCallback:(fn:any)=>fn};
  const icons=new Proxy({}, {get:(_target,key)=>()=>React.createElement('i',{'data-icon':String(key)})});
  const module=load(file,{react,'lucide-react':icons,'../../lib/privateTradingApi':api,'../copy-trading-bolt/LiveMetric':{LiveMetric:({value}:any)=>React.createElement('span',null,value)},...imports});
  const render=(updates:any={})=>{props={...props,...updates};cursor=0;const tree=module[name](props);effects.splice(0).forEach(fn=>fn());return tree;};
  return{render};
}
function nodes(node:any):any[]{return !node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];}
function text(node:any):string{return node===null||node===undefined||typeof node==='boolean'?'':typeof node!=='object'?String(node):Array.isArray(node)?node.map(text).join(''):text(node.props?.children);}
function find(tree:any,predicate:(node:any)=>boolean){const node=nodes(tree).find(predicate);if(!node)throw new Error('Expected rendered control not found');return node;}
function button(tree:any,label:string){return find(tree,n=>n.type==='button'&&text(n)===label);}
function labeled(tree:any,label:string){const container=find(tree,n=>n.type==='label'&&text(n).startsWith(label));return find(container,n=>n.type==='input');}
function input(tree:any,label:string){return find(tree,n=>n.type==='input'&&n.props['aria-label']===label);}
const tick=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};

test('direct private route loads reference book flex layout without visiting the public terminal',()=>{
  const {JSDOM}=req('jsdom');
  const page=readFileSync(resolve(frontend,'src/pages/private-trading/PrivateTradingPage.tsx'),'utf8');
  const styles=[...page.matchAll(/^import '([^']+\.css)';/gm)].map(match=>readFileSync(resolve(frontend,'src/pages/private-trading',match[1]),'utf8')).join('\n');
  const dom=new JSDOM(`<style>${styles}</style><div class="trade-terminal futures-reference futures-studio terminal-studio private-trading-terminal"><div class="private-book repaired-futures-book"><div class="reference-book"><div class="rb-body rb-both"><div class="rb-stack rb-asks"></div><div class="rb-center"></div><div class="rb-stack rb-bids"></div></div></div></div></div>`);
  const style=(selector:string)=>dom.window.getComputedStyle(dom.window.document.querySelector(selector));
  expect(style('.reference-book').display).toBe('flex');
  expect(style('.reference-book').flexDirection).toBe('column');
  expect(style('.rb-body').display).toBe('flex');
  expect(style('.rb-body').flexGrow).toBe('1');
  expect(style('.rb-body').minHeight).toBe('0');
  expect(style('.rb-stack').display).toBe('flex');
  expect(style('.rb-asks').flexDirection).toBe('column-reverse');
  expect(style('.rb-bids').flexDirection).toBe('column');
  for(const className of ['private-card-dialog','private-action-dialog']){
    const dialog=dom.window.document.createElement('dialog');dialog.className=className;dialog.open=true;dom.window.document.body.append(dialog);
    expect(style(`.${className}`).margin).toBe('auto');
  }
  dom.window.close();
});

describe('private trading API boundary',()=>{
  test('no token means no request, including card export',async()=>{
    const fetcher=jest.fn();const client=api.createPrivateTradingClient('/api/v1',()=>null,fetcher);
    await expect(client.getCard('private-snapshot')).rejects.toMatchObject({status:401});expect(fetcher).not.toHaveBeenCalled();
  });
  test('all reads and writes stay private and preserve decimal strings and idempotency',async()=>{
    const fetcher=jest.fn(async()=>reply({}));const client=api.createPrivateTradingClient('/api/v1/',()=> 'owner-token',fetcher);
    const preview={mode:'DEMO_LIVE',symbol:'ETHUSDT',side:'SHORT',type:'LIMIT',quantity:'0.030',leverage:'3',limitPrice:'2345.67',idempotencyKey:'same-preview'};
    await client.access();await client.state();await client.market('ETH/USDT');await client.allocate('100.001','capital-once');await client.preview(preview);
    await client.confirm('p','confirm-once');await client.cancelPreview('p');await client.cancelOrder('o','cancel-once');await client.close('position','0.010','close-once');
    await client.amend('position',{marginDelta:'-3.25',takeProfit:null,idempotencyKey:'amend-once'});await client.advance('s','2026-08-08T12:00:00.000Z','advance-once');await client.card('position');await client.getCard('snapshot');
    const calls=fetcher.mock.calls as unknown as [string,RequestInit][];
    expect(calls).toHaveLength(13);for(const[url,options]of calls){expect(url).toMatch(/^\/api\/v1\/private-trading\//);expect(options.cache).toBe('no-store');expect(options.headers).toMatchObject({Authorization:'Bearer owner-token'});}
    expect(JSON.parse(calls[4][1].body as string)).toEqual(preview);
    expect(JSON.parse(calls[8][1].body as string)).toEqual({quantity:'0.010',idempotencyKey:'close-once'});
    expect(JSON.parse(calls[9][1].body as string)).toEqual({marginDelta:'-3.25',takeProfit:null,idempotencyKey:'amend-once'});
    expect(calls[2][0]).toContain('symbol=ETH%2FUSDT');
  });
  test('resource IDs cannot escape private routes',async()=>{
    const fetcher=jest.fn(async()=>reply({}));const client=api.createPrivateTradingClient('/api/v1',()=> 'token',fetcher);
    await client.getCard('../orders?owner=other');
    expect((fetcher.mock.calls as unknown as [string][])[0][0]).toBe('/api/v1/private-trading/cards/..%2Forders%3Fowner%3Dother');
  });
  test('session revocation during a request discards private response',async()=>{
    let token:string|null='old-owner';let complete!:(response:Response)=>void;
    const client=api.createPrivateTradingClient('/api/v1',()=>token,()=>new Promise<Response>(r=>{complete=r;}));
    const pending=client.state();token=null;complete(reply({wallet:{available:'10000'}}));
    await expect(pending).rejects.toMatchObject({status:401});
  });
  test('403 and stale preview are errors, never a fake empty account or successful fill',async()=>{
    const client=api.createPrivateTradingClient('/api/v1',()=> 'token',async()=>reply({error:'access_denied'},403));
    await expect(client.state()).rejects.toMatchObject({status:403});
    expect(api.privateErrorText(new api.PrivateTradingError('quote_stale',409))).toContain('предпросмотр');
  });
});

describe('private snapshot display and dates',()=>{
  test('PNG data URL preserves the exact generated image bytes',async()=>{
    const {JSDOM}=req('jsdom'),dom=new JSDOM('');
    const previous=(globalThis as any).FileReader;(globalThis as any).FileReader=dom.window.FileReader;
    try{
      const bytes=new Uint8Array([137,80,78,71,13,10,26,10,0,255,128,1]);
      const result=await cardRenderer.privateResultCardDataUrl(new dom.window.Blob([bytes],{type:'image/png'}));
      expect(result).toBe(`data:image/png;base64,${Buffer.from(bytes).toString('base64')}`);
    }finally{(globalThis as any).FileReader=previous;dom.window.close();}
  });
  test.each([null,undefined,'','NaN','Infinity'])('unknown %s stays unavailable',value=>expect(api.privateNumber(value)).toBe('—'));
  test('real zero is displayed and decimal amounts are not financial recalculations',()=>{expect(api.privateNumber('0')).toBe('0.00');expect(api.privateNumber('1234.56')).toBe('1,234.56');});
  test('historical local input explicitly means UTC and impossible dates fail',()=>{
    expect(api.privateInputUtc('2024-02-29T12:35')).toBe('2024-02-29T12:35:00.000Z');
    expect(()=>api.privateInputUtc('2026-02-30T12:35')).toThrow();expect(()=>api.privateInputUtc('2026-08-01T25:00')).toThrow();
  });
  test('history ordering uses effective time instead of creation today',()=>{
    const rows=[{id:'older-created-today',effectiveOpenedAt:'2020-01-01T00:00:00Z',createdAt:'2026-09-14T00:00:00Z'},{id:'newer-effective',effectiveOpenedAt:'2026-09-01T00:00:00Z',createdAt:'2026-09-01T00:00:00Z'}];
    expect(api.privateEffectiveSort(rows).map((r:any)=>r.id)).toEqual(['newer-effective','older-created-today']);expect(rows[0].id).toBe('older-created-today');
  });
  const snapshot={id:'secret-resource-id',symbol:'BTCUSDT',side:'LONG',leverage:'10',mode:'DEMO_LIVE',netPnl:'-5.75',unrealizedPnl:'123.45',roiPercent:'12.345',entryPrice:'100',valuationPrice:'220',usdPnl:null,asOf:'2026-08-08T12:00:00.000Z',status:'OPEN',label:'Симуляция'};
  test('open PNG pairs unrealized P&L with server ROI and frozen valuation, without fabricated USD',()=>{
    const svg=cardRenderer.privateResultCardSvg(snapshot);
    expect(svg).toContain('Нереализованный P&amp;L  123.45 USDT');expect(svg).toContain('12.35%');expect(svg).toContain('USD  —');expect(svg).toContain('220.000000');expect(svg).toContain('2026-08-08 12:00:00 UTC');expect(svg).not.toContain('secret-resource-id');expect(svg).not.toContain('-5.75');
  });
  test('closed historical card keeps net result and readable test designation',()=>{
    const svg=cardRenderer.privateResultCardSvg({...snapshot,status:'CLOSED',mode:'HISTORICAL_REPLAY',label:'Исторический тест',roiPercent:'-0.575'});
    expect(svg).toContain('Результат сценария · net  -5.75 USDT');expect(svg).toContain('Исторический тест');expect(svg).toContain('Цена выхода');expect(svg).not.toContain('123.45');
  });
  test('an open historical scenario uses server net P&L consistently with scenario ROI',()=>{
    const svg=cardRenderer.privateResultCardSvg({...snapshot,mode:'HISTORICAL_REPLAY',label:'Исторический тест',pnl:'-5.75',pnlKind:'NET_SCENARIO',roiPercent:'-0.575'});
    expect(svg).toContain('Результат сценария · net  -5.75 USDT');expect(svg).not.toContain('123.45');
  });
  test('expired preview refresh copies reviewed inputs but never old idempotency or server-only state',()=>{
    const request={mode:'DEMO_LIVE',symbol:'ETHUSDT',side:'SHORT',type:'MARKET',quantity:'0.1',leverage:'3',idempotencyKey:'old-command',quote:{lastPrice:'9999'},profile:{fee:'0'}};
    expect(api.privateRefreshDraft({result:{request}})).toEqual({mode:'DEMO_LIVE',symbol:'ETHUSDT',side:'SHORT',type:'MARKET',quantity:'0.1',leverage:'3'});
    expect(api.privateRefreshDraft({result:{request:{...request,margin:'100'}}})).toEqual({mode:'DEMO_LIVE',symbol:'ETHUSDT',side:'SHORT',type:'MARKET',margin:'100',leverage:'3'});
  });
  test('card cannot omit simulation provenance and escapes server strings',()=>{
    expect(()=>cardRenderer.privateResultCardSvg({...snapshot,label:''})).toThrow();expect(()=>cardRenderer.privateResultCardSvg({...snapshot,mode:'REAL'})).toThrow();
    expect(cardRenderer.privateResultCardSvg({...snapshot,symbol:'<script>&'})).toContain('&lt;script&gt;&amp;');
  });
});

describe('actual private forms',()=>{
  const market={instrument:{minLeverage:'1',maxLeverage:'30',leverageStep:'1',tickSize:'0.01',qtyStep:'0.001',minOrderQty:'0.001'}};
  function ticket(){const onPreview=jest.fn(),onConfirm=jest.fn(),onAllocate=jest.fn();return{onPreview,onConfirm,onAllocate,...mount('pages/private-trading/PrivateOrderTicket.tsx','PrivateOrderTicket',{symbol:'ETHUSDT',market,wallet:{available:'1000',demoAvailable:'2000'},busy:false,preview:null,onPreview,onConfirm,onAllocate,onCancel:jest.fn()})};}
  test('Short limit uses contract settings and only calculates a preview until explicit confirmation',()=>{
    const ui=ticket();let tree=ui.render();button(tree,'Short').props.onClick();button(tree,'Лимит').props.onClick();tree=ui.render();
    expect(input(tree,'Плечо').props.max).toBe('30');labeled(tree,'Цена лимита').props.onChange({target:{value:'2345.67'}});input(tree,'Маржа, USDT').props.onChange({target:{value:'100'}});input(tree,'Плечо').props.onChange({target:{value:'3'}});
    tree=ui.render();find(tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});
    expect(ui.onPreview).toHaveBeenCalledWith({mode:'DEMO_LIVE',symbol:'ETHUSDT',side:'SHORT',type:'LIMIT',leverage:'3',margin:'100',limitPrice:'2345.67'});expect(ui.onConfirm).not.toHaveBeenCalled();
    tree=ui.render({preview:{id:'immutable-preview',status:'READY',progress:100}});button(tree,'Подтвердить и сохранить').props.onClick();expect(ui.onConfirm).toHaveBeenCalledTimes(1);
  });
  test('book selection fills an exact limit price; quantity uses this contract step',()=>{
    const ui=ticket();ui.render({pickedPrice:{price:'123.45',sequence:1}});let tree=ui.render();expect(labeled(tree,'Цена лимита').props.value).toBe('123.45');
    find(tree,n=>n.type==='select'&&n.props['aria-label']==='Способ задания размера').props.onChange({target:{value:'quantity'}});tree=ui.render();expect(input(tree,'Количество').props.step).toBe('0.001');
  });
  test('historical preview fixes UTC asOf across uncertain retries and sends timestamped margin/close/protection events',()=>{
    const ui=ticket();let tree=ui.render();button(tree,'Историческая сделка').props.onClick();tree=ui.render();
    input(tree,'Маржа, USDT').props.onChange({target:{value:'25'}});labeled(tree,'Вход в прошлом').props.onChange({target:{value:'2026-08-01T10:00'}});labeled(tree,'Капитал сценария').props.onChange({target:{value:'500'}});
    button(tree,'Добавить событие').props.onClick();tree=ui.render();labeled(tree,'Время UTC').props.onChange({target:{value:'2026-08-02T11:00'}});labeled(tree,'Добавить / снять').props.onChange({target:{value:'20'}});
    tree=ui.render();const submit=()=>find(ui.render(),n=>n.type==='form').props.onSubmit({preventDefault(){}});submit();submit();
    const a=ui.onPreview.mock.calls[0][0],b=ui.onPreview.mock.calls[1][0];expect(a.asOf).toBe(b.asOf);expect(a.effectiveOpenedAt).toBe('2026-08-01T10:00:00.000Z');expect(a.events[0]).toMatchObject({kind:'MARGIN',amount:'20',effectiveAt:'2026-08-02T11:00:00.000Z'});expect(a.mode).toBe('HISTORICAL_REPLAY');expect(ui.onConfirm).not.toHaveBeenCalled();
  });
  test('invalid historical time produces visible error and no request',()=>{
    const ui=ticket();let tree=ui.render();button(tree,'Историческая сделка').props.onClick();tree=ui.render();labeled(tree,'Вход в прошлом').props.onChange({target:{value:'2026-02-30T10:00'}});
    find(ui.render(),n=>n.type==='form').props.onSubmit({preventDefault(){}});expect(ui.onPreview).not.toHaveBeenCalled();expect(find(ui.render(),n=>n.props?.role==='alert')).toBeDefined();
  });
  test('partial close submits requested quantity and shows server rejection inside the dialog',()=>{
    const onSubmit=jest.fn();const ui=mount('pages/private-trading/PrivatePositions.tsx','PrivatePositionDialog',{action:{kind:'close',position:{symbol:'ETHUSDT',quantity:'0.3'}},busy:false,error:'Котировка устарела',onSubmit,onClose:jest.fn()});
    let tree=ui.render();labeled(tree,'Количество для закрытия').props.onChange({target:{value:'0.1'}});tree=ui.render();find(tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});
    expect(onSubmit).toHaveBeenCalledWith({quantity:'0.1'});expect(text(find(tree,n=>n.props?.role==='alert'))).toBe('Котировка устарела');
  });
  test('EXPIRED can only refresh; a new explicit confirmation is still required',()=>{
    const ui=ticket(),onRefresh=jest.fn();const tree=ui.render({preview:{id:'expired',status:'EXPIRED'},onRefresh});
    expect(nodes(tree).some(n=>n.type==='button'&&text(n)==='Подтвердить и сохранить')).toBe(false);
    button(tree,'Обновить расчёт').props.onClick();expect(onRefresh).toHaveBeenCalledTimes(1);expect(ui.onConfirm).not.toHaveBeenCalled();
  });
  test('live confirmation discloses frozen quantity, maximum spend and adverse price bounds',()=>{
    const ui=ticket();const consent={quantity:'0.25',minimumFillQuantity:'0.2',maxRequired:'123.456789',maxAveragePrice:null,minAveragePrice:'2345.123456',slippageBps:'5',slippagePercent:'0.05'};
    const tree=ui.render({preview:{id:'intent',mode:'DEMO_LIVE',status:'READY',expiresAt:'2026-08-01T12:01:00Z',result:{position:null,consent}}});
    const conditions=find(tree,n=>n.props?.['aria-label']==='Подтверждаемые условия исполнения');
    expect(text(conditions)).toContain('0.25000000');expect(text(conditions)).toContain('0.20000000');expect(text(conditions)).toContain('123.45678900 USDT');expect(text(conditions)).toContain('2,345.12345600');expect(text(conditions)).toContain('0.05%');expect(text(conditions)).not.toContain('Макс. средняя цена');
    expect(button(tree,'Подтвердить и сохранить').props.disabled).toBe(false);expect(ui.onConfirm).not.toHaveBeenCalled();
    button(tree,'Подтвердить и сохранить').props.onClick();expect(ui.onConfirm).toHaveBeenCalledTimes(1);
  });
  test('older LIVE preview without reviewed bounds cannot confirm',()=>{
    const ui=ticket();const tree=ui.render({preview:{id:'old',mode:'DEMO_LIVE',status:'READY'}});
    expect(button(tree,'Подтвердить и сохранить').props.disabled).toBe(true);
  });
  test('mode changes request clearing the old preview; resumed preview selects its own mode',()=>{
    const ui=ticket(),onModeChange=jest.fn();let tree=ui.render({onModeChange,preview:{id:'live',mode:'DEMO_LIVE',status:'READY'}});
    button(tree,'Историческая сделка').props.onClick();expect(onModeChange).toHaveBeenCalledWith('HISTORICAL_REPLAY');expect(ui.onConfirm).not.toHaveBeenCalled();
    tree=ui.render({preview:null});expect(text(tree)).not.toContain('Предпросмотр ·');
    ui.render({preview:{id:'resume-historical',mode:'HISTORICAL_REPLAY',status:'RUNNING'}});tree=ui.render();expect(button(tree,'Историческая сделка').props['aria-selected']).toBe(true);expect(text(tree)).toContain('Предпросмотр · Исторический тест');
  });
  test('stale position valuation is unavailable and order history uses dedicated server collection',()=>{
    const p={id:'p',symbol:'ETHUSDT',side:'LONG',mode:'DEMO_LIVE',status:'OPEN',dataStatus:'UNAVAILABLE',verification:'VERIFIED',quantity:'0.1',leverage:'3',entryPrice:'2000',markPrice:'2222.22',notional:'222.222',allocatedMargin:'75',netPnl:'22.22',unrealizedPnl:'23.45',roiPercent:'30.01',liquidationPrice:'1000',effectiveOpenedAt:'2026-08-01T12:00:00Z'};
    const state={positions:[p],orders:[],orderHistory:[{id:'o',symbol:'ETHUSDT',side:'LONG',type:'MARKET',status:'FILLED',quantity:'0.1',filledQuantity:'0.1',remainingQuantity:'0',createdAt:'2026-08-01T12:00:00Z'}],history:[],scenarios:[],copyHistory:[],wallet:{}};
    const ui=mount('pages/private-trading/PrivatePositions.tsx','PrivatePositions',{state,busy:false,onAction:jest.fn(),onCard:jest.fn(),onCancelOrder:jest.fn(),onAdvance:jest.fn()});let tree=ui.render();
    expect(text(tree)).not.toContain('2,222.220000');expect(text(tree)).not.toContain('30.01');expect(text(tree)).toContain('Обновление котировки');expect(find(tree,n=>n.props?.['aria-label']==='Открыть карточку ETHUSDT').props.disabled).toBe(true);
    button(tree,'История ордеров').props.onClick();tree=ui.render();expect(text(tree)).toContain('FILLED');expect(text(tree)).toContain('0.10000000');
  });
  test('saved preview can be resumed without creating or confirming another trade',()=>{
    const ui=ticket(),onResume=jest.fn();const tree=ui.render({onResume,savedPreviews:[{id:'job',status:'RUNNING',createdAt:'2026-08-01T12:00:00Z'}]});
    find(tree,n=>n.type==='button'&&text(n).includes('Выполняется')).props.onClick();expect(onResume).toHaveBeenCalledWith('job');expect(ui.onPreview).not.toHaveBeenCalled();expect(ui.onConfirm).not.toHaveBeenCalled();
  });
  test('permission revoked while PNG renders prevents file delivery',async()=>{
    let finishRender!:(blob:Blob)=>void;const onError=jest.fn();
    const snapshot={id:'card',symbol:'ETHUSDT',label:'Симуляция',mode:'DEMO_LIVE',status:'OPEN',unrealizedPnl:'10'};
    const getCard=jest.fn().mockResolvedValueOnce(snapshot).mockRejectedValueOnce(new api.PrivateTradingError('access_denied',403));
    const png=jest.fn().mockResolvedValueOnce(new Blob(['preview'],{type:'image/png'})).mockImplementationOnce(()=>new Promise<Blob>(resolve=>{finishRender=resolve;}));
    const ui=mount('pages/private-trading/PrivateResultCardDialog.tsx','PrivateResultCardDialog',{snapshot,onClose:jest.fn(),onError},{'../../lib/privateTradingApi':{...api,privateTradingApi:{getCard}},'../../lib/privateResultCard':{privateResultCardPng:png,privateResultCardDataUrl:async()=> 'data:image/png;base64,cG5n'}});
    ui.render();await tick();const tree=ui.render();button(tree,'Сохранить PNG').props.onClick();await tick();
    finishRender(new Blob(['finished'],{type:'image/png'}));await tick();await tick();
    expect(getCard).toHaveBeenCalledTimes(2);expect(onError).toHaveBeenCalledWith(expect.objectContaining({status:403}));expect(text(ui.render())).toContain('Доступ к приватному режиму завершён');
  });
  test('Open uses a normal protected link with no asynchronous popup activation',async()=>{
    const snapshot={id:'card/owner?test',symbol:'ETHUSDT',label:'Симуляция',mode:'DEMO_LIVE',status:'OPEN'};
    const getCard=jest.fn();const ui=mount('pages/private-trading/PrivateResultCardDialog.tsx','PrivateResultCardDialog',{snapshot,onClose:jest.fn(),onError:jest.fn()},{'../../lib/privateTradingApi':{...api,privateTradingApi:{getCard}},'../../lib/privateResultCard':{privateResultCardPng:async()=>new Blob(['png'],{type:'image/png'}),privateResultCardDataUrl:async()=> 'data:image/png;base64,cG5n'}});
    ui.render();await tick();await tick();const tree=ui.render(),link=find(tree,n=>n.type==='a'&&text(n)==='Открыть');
    expect(link.props.href).toBe('/futures?privateTrading=1&card=card%2Fowner%3Ftest');expect(link.props.target).toBe('_blank');expect(link.props.rel).toContain('noopener');expect(link.props.onClick).toBeUndefined();expect(getCard).not.toHaveBeenCalled();
    expect(find(tree,n=>n.type==='img').props.src).toBe('data:image/png;base64,cG5n');
  });
  test('PNG save attaches its download anchor only after both owner checks and removes it after click',async()=>{
    const snapshot={id:'card',symbol:'ETHUSDT',label:'Симуляция',mode:'DEMO_LIVE',status:'OPEN'},getCard=jest.fn().mockResolvedValue(snapshot),onError=jest.fn();
    let attached=false;const anchor:any={remove:jest.fn(()=>{attached=false;}),click:jest.fn(()=>{expect(attached).toBe(true);expect(getCard).toHaveBeenCalledTimes(2);})};
    const previous=(globalThis as any).document;(globalThis as any).document={createElement:()=>anchor,body:{append:()=>{attached=true;}}};
    try{
      const ui=mount('pages/private-trading/PrivateResultCardDialog.tsx','PrivateResultCardDialog',{snapshot,onClose:jest.fn(),onError},{'../../lib/privateTradingApi':{...api,privateTradingApi:{getCard}},'../../lib/privateResultCard':{privateResultCardPng:async()=>new Blob(['png'],{type:'image/png'}),privateResultCardDataUrl:async()=> 'data:image/png;base64,cG5n'}});
      ui.render();await tick();await tick();button(ui.render(),'Сохранить PNG').props.onClick();await tick();await tick();await tick();
      expect(anchor.href).toBe('data:image/png;base64,cG5n');expect(anchor.download).toBe('VOLTEX-ETHUSDT-simulation.png');expect(anchor.click).toHaveBeenCalledTimes(1);expect(anchor.remove).toHaveBeenCalledTimes(1);expect(attached).toBe(false);expect(onError).not.toHaveBeenCalled();
    }finally{(globalThis as any).document=previous;}
  });
  test('linked card fetches the immutable snapshot and rejects a revoked owner before rendering it',async()=>{
    const snapshot={id:'frozen',symbol:'ETHUSDT',label:'Исторический тест'},onDenied=jest.fn(),navigate=jest.fn(),Dialog=()=>null;
    const getCard=jest.fn().mockResolvedValueOnce(snapshot).mockRejectedValueOnce(new api.PrivateTradingError('access_denied',403));
    const ui=mount('pages/private-trading/PrivateLinkedCard.tsx','PrivateLinkedCard',{id:'frozen',onDenied},{'react-router-dom':{Link:()=>null,useNavigate:()=>navigate},'./PrivateResultCardDialog':{PrivateResultCardDialog:Dialog},'../../lib/privateTradingApi':{...api,privateTradingApi:{getCard}}});
    let tree=ui.render();expect(nodes(tree).some(n=>n.type===Dialog)).toBe(false);await tick();tree=ui.render();expect(getCard).toHaveBeenCalledWith('frozen');expect(find(tree,n=>n.type===Dialog).props.snapshot).toBe(snapshot);
    find(tree,n=>n.type===Dialog).props.onClose();expect(navigate).toHaveBeenCalledWith('/futures?privateTrading=1',{replace:true});
    ui.render({id:'revoked'});await tick();tree=ui.render();expect(onDenied).toHaveBeenCalledTimes(1);expect(nodes(tree).some(n=>n.type===Dialog)).toBe(false);
  });
  test('saved verified historical positions appear under chart, open history after closing, and never get live close actions',()=>{
    const wallet=Object.freeze({available:'800',allocatedCapital:'1000',realizedPnl:'0'}),onCard=jest.fn(),onAdvance=jest.fn(),onAction=jest.fn();
    const empty={positions:[],orders:[],orderHistory:[],history:[],scenarios:[],copyHistory:[],wallet};
    const scenario={id:'historical-id',symbol:'ETHUSDT',side:'LONG',mode:'HISTORICAL_REPLAY',status:'OPEN',verification:'VERIFIED',quantity:'0.1',initialQuantity:'0.1',leverage:'3',entryPrice:'2000',markPrice:'2200',notional:'220',allocatedMargin:'70',allocatedCapital:'200',scenarioEquity:'219.5',netPnl:'19.5',unrealizedPnl:'20',roiPercent:'27.85',liquidationPrice:'1500',effectiveOpenedAt:'2026-08-01T12:00:00Z',asOf:'2026-08-02T12:00:00Z'};
    const ui=mount('pages/private-trading/PrivatePositions.tsx','PrivatePositions',{state:empty,busy:false,onAction,onCard,onAdvance,onCancelOrder:jest.fn()});let tree=ui.render();button(tree,'Сценарии').props.onClick();ui.render();
    ui.render({state:{...empty,scenarios:[scenario]}});tree=ui.render();expect(button(tree,'Позиции (1)').props['aria-selected']).toBe(true);expect(text(tree)).toContain('Исторический тест');expect(text(tree)).toContain('На: 2026-08-02 12:00:00 UTC');
    expect(nodes(tree).filter(n=>n.type==='small'&&text(n)==='Net')).toHaveLength(1);expect(text(tree)).not.toContain('Net · Net');
    expect(nodes(tree).some(n=>n.type==='button'&&['Маржа','Закрыть','TP/SL'].includes(text(n)))).toBe(false);
    button(tree,'Обновить до сейчас').props.onClick();expect(onAdvance).toHaveBeenCalledWith('historical-id');find(tree,n=>n.props?.['aria-label']==='Открыть карточку ETHUSDT').props.onClick();expect(onCard).toHaveBeenCalledWith('historical-id');expect(onAction).not.toHaveBeenCalled();
    ui.render({state:{...empty,scenarios:[{...scenario,status:'CLOSED',quantity:'0',effectiveClosedAt:'2026-08-03T12:00:00Z'}]}});tree=ui.render();expect(button(tree,'История позиций').props['aria-selected']).toBe(true);expect(text(tree)).toContain('0.10000000');expect(text(tree)).toContain('Исторический тест');expect(wallet.realizedPnl).toBe('0');
    button(tree,'Сценарии').props.onClick();tree=ui.render();expect(text(tree)).toContain('200.00');expect(text(tree)).toContain('219.50');expect(text(tree)).toContain('19.50');
  });
  test('unverified scenarios stay in drafts and do not populate positions/history or expose verified equity',()=>{
    const scenario={id:'draft',symbol:'ETHUSDT',mode:'HISTORICAL_REPLAY',status:'OPEN',verification:'AMBIGUOUS',allocatedCapital:'200',scenarioEquity:'9999',netPnl:'9799',asOf:'2026-08-02T12:00:00Z',effectiveOpenedAt:'2026-08-01T12:00:00Z'};
    const ui=mount('pages/private-trading/PrivatePositions.tsx','PrivatePositions',{state:{positions:[],orders:[],history:[],scenarios:[scenario],copyHistory:[],wallet:{}},busy:false,onAction:jest.fn(),onCard:jest.fn(),onAdvance:jest.fn(),onCancelOrder:jest.fn()});let tree=ui.render();expect(button(tree,'Позиции (0)')).toBeDefined();expect(text(tree)).toContain('Нет открытых позиций');button(tree,'Сценарии').props.onClick();tree=ui.render();expect(text(tree)).toContain('Неоднозначный');expect(text(tree)).not.toContain('9,999');expect(text(tree)).not.toContain('9,799');
  });
});
