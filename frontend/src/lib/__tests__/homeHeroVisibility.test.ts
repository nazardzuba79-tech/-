import { readFileSync } from 'fs';
import { resolve } from 'path';
import ts from 'typescript';

function mount(source = 'kraken') {
  const code = ts.transpileModule(readFileSync(resolve(__dirname, '../../pages/home/useHeroStream.ts'), 'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  let dispose: (() => void) | undefined;
  let visibility: (() => void) | undefined;
  let intersect: ((entries: {isIntersecting:boolean}[]) => void) | undefined;
  const disconnect = jest.fn(), stop = jest.fn(), start = jest.fn(() => stop), state = jest.fn();
  const document = {hidden:false,getElementById:()=>({}),
    addEventListener:(_event:string,listener:()=>void)=>{visibility=listener;},
    removeEventListener:jest.fn(),
  };
  const output:any = {};
  new Function('require','exports','document','IntersectionObserver',code)((name:string)=>{
    if(name==='react')return {useState:()=>[null,state],useMemo:(fn:()=>unknown)=>fn(),useEffect:(fn:()=>void|(()=>void))=>{dispose=fn()||undefined;}};
    if(name==='../../lib/krakenSocket')return {krakenSocket:{}};
    if(name==='./heroStream')return {startHeroStream:start,combineHeroFeed:(base:unknown)=>base};
    throw new Error(name);
  },output,document,class {observe(){} disconnect=disconnect;constructor(callback:typeof intersect){intersect=callback;}});
  output.useHeroStream({hero:{pair:'BTC/USDT'},tickerSource:source});
  return {start,stop,state,disconnect,document,
    visible:(value:boolean)=>intersect?.([{isIntersecting:value}]),
    hidden:(value:boolean)=>{document.hidden=value;visibility?.();},
    dispose:()=>dispose?.(),
  };
}

test('hero visibility owns subscriptions: no offscreen/hidden connection and one idempotent resume',()=>{
  const h=mount(); expect(h.start).not.toHaveBeenCalled();
  h.visible(true); h.visible(true); expect(h.start).toHaveBeenCalledTimes(1);
  h.hidden(true); expect(h.stop).toHaveBeenCalledTimes(1); expect(h.state).toHaveBeenLastCalledWith(null);
  h.visible(true); expect(h.start).toHaveBeenCalledTimes(1);
  h.hidden(false); expect(h.start).toHaveBeenCalledTimes(2);
  h.visible(false); expect(h.stop).toHaveBeenCalledTimes(2);
  h.visible(true); h.dispose(); expect(h.stop).toHaveBeenCalledTimes(3);
  expect(h.disconnect).toHaveBeenCalledTimes(1); expect(h.document.removeEventListener).toHaveBeenCalledTimes(1);
});

test('a different upstream is never mixed with Kraken trades or OHLC',()=>{
  const h=mount('other-provider');h.visible(true);h.hidden(false);expect(h.start).not.toHaveBeenCalled();h.dispose();
});
