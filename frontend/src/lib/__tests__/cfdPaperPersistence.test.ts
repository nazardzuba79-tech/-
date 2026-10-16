import { closeCfdPaperPosition, getCfdPaperState, openCfdPaperPosition } from '../cfdPaperStore';

// A browser storage error must never be acknowledged as a practice trade.
const KEY='voltex_cfd_practice_v1';
const originalWindow=(globalThis as { window?: unknown }).window;
let saved:string|null=null;
let failRead=false,failWrite=false;
let notifications=0;

beforeEach(()=>{
  saved=null;failRead=false;failWrite=false;notifications=0;
  Object.defineProperty(globalThis,'window',{configurable:true,value:{
    localStorage:{
      getItem:(key:string)=>{if(failRead)throw new Error('SecurityError');return key===KEY?saved:null;},
      setItem:(key:string,value:string)=>{if(failWrite)throw new Error('QuotaExceededError');if(key===KEY)saved=value;},
    },
    dispatchEvent:()=>{notifications++;return true;},
  }});
});
afterEach(()=>{
  if(originalWindow===undefined)delete (globalThis as { window?: unknown }).window;
  else Object.defineProperty(globalThis,'window',{configurable:true,value:originalWindow});
});
const open=()=>openCfdPaperPosition({symbol:'XAUUSD',side:'BUY',quantity:2,price:100,leverage:10,initialMargin:20,liquidationPrice:null});

test('successful open, partial close, and full close persist before notifying',()=>{
  const p=open();
  expect(getCfdPaperState().open).toHaveLength(1);
  closeCfdPaperPosition(p.id,110,0.5);
  expect(getCfdPaperState().open[0].size).toBe('1.5');
  expect(getCfdPaperState().history).toHaveLength(1);
  closeCfdPaperPosition(p.id,115);
  expect(getCfdPaperState().open).toHaveLength(0);
  expect(getCfdPaperState().history).toHaveLength(2);
  expect(notifications).toBe(3);
});
test('quota failure on open does not acknowledge or notify',()=>{
  failWrite=true;
  expect(open).toThrow('cfd_practice_storage_unavailable');
  expect(saved).toBeNull();
  expect(notifications).toBe(0);
});
test.each(['partial','full'] as const)('%s close failure retains stored positions and history',kind=>{
  const p=open(),original=saved,prior=getCfdPaperState(),count=notifications;
  failWrite=true;
  expect(()=>closeCfdPaperPosition(p.id,110,kind==='partial'?1:undefined)).toThrow('cfd_practice_storage_unavailable');
  expect(saved).toBe(original);
  expect(getCfdPaperState()).toEqual(prior);
  expect(notifications).toBe(count);
});
test('read failure cannot reset previous saved positions',()=>{
  open();const original=saved;failRead=true;
  expect(open).toThrow('cfd_practice_storage_unavailable');
  expect(saved).toBe(original);
});
test('malformed ledger cannot be overwritten with an apparently successful new order',()=>{
  saved='{invalid json';const original=saved;
  expect(open).toThrow('cfd_practice_storage_unavailable');
  expect(saved).toBe(original);
});
test('invalid position entries cannot be silently removed by the next order',()=>{
  saved=JSON.stringify({open:[{id:'invalid'}],history:[]});const original=saved;
  expect(open).toThrow('cfd_practice_storage_unavailable');
  expect(saved).toBe(original);
});
