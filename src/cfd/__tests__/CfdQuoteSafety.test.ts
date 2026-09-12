import BigNumber from 'bignumber.js';
import { CfdMarketDataService } from '../../services/CfdMarketDataService';
import { assertCfdExecutionQuote, quoteAgeLimit, type CfdQuote, type CfdQuoteSource } from '../../services/marketData/cfd/CfdQuote';
import { CfdCreditBudget, CFD_REFERENCE_CATALOG } from '../../services/marketData/cfd/catalog';
import { CfdPositionService } from '../CfdPositionService';
import { CfdLiquidationEngine } from '../CfdLiquidationEngine';

const at = Date.UTC(2026,8,12);
const quote = (over: Partial<CfdQuote>={}):CfdQuote => ({provider:'test',symbol:'XAUUSD',providerSymbol:'XAU/USD',
  bid:null,ask:null,mid:null,last:1800,providerTimestamp:at,fetchedAt:at,stale:false,status:'live',executionAllowed:true,...over});
const invalid: [string, Partial<CfdQuote>][] = [
  ['stale',{stale:true}],['unavailable',{status:'unavailable'}],['entitlement',{status:'entitlement_required'}],
  ['unapproved',{executionAllowed:false}],['closed',{status:'market_closed'}],['reference',{status:'reference_only'}],
  ['wrong instrument',{symbol:'EURUSD'}],['old cache',{fetchedAt:at-60000}],['old provider',{providerTimestamp:at-60000}],
  ['null timestamp',{providerTimestamp:null}],['future timestamp',{providerTimestamp:at+10000}],
  ['null price',{last:null}],['NaN',{last:NaN}],['infinity',{last:Infinity}],['zero',{last:0}],['negative',{last:-1}],
];
beforeEach(()=>jest.useFakeTimers().setSystemTime(at));
afterEach(()=>jest.useRealTimers());
test('fresh single reference price accepted with null bid/ask/mid, no synthetic spread',()=>{
  const q=quote();expect(assertCfdExecutionQuote(q,'XAUUSD',5000,at)).toBe(1800);expect(q).toMatchObject({bid:null,ask:null,mid:null});
});
test('preserves the exact provider decimal for existing BigNumber accounting',async()=>{
  const {service}=adapter({'XAU/USD':{close:'2000.123456789012345678',timestamp:at/1000}});
  const q=await service.getExecutionQuote('XAUUSD');
  expect(new BigNumber(assertCfdExecutionQuote(q,'XAUUSD',5000,at)).toString()).toBe('2000.123456789012345678');
  expect(()=>assertCfdExecutionQuote(quote({lastDecimal:'100'}),'XAUUSD',5000,at)).toThrow();
});
test.each(invalid)('execution rejects %s',(_,over)=>expect(()=>assertCfdExecutionQuote(quote(over),'XAUUSD',5000,at)).toThrow());
test.each([0,60000,Infinity,NaN,-1,249,10001])('rejects unsafe max quote age %s',age=>expect(()=>quoteAgeLimit(age)).toThrow());

function source(q:CfdQuote):CfdQuoteSource {return {maxQuoteAgeMs:5000,isConfigured:()=>true,getExecutionQuote:async()=>q,getQuotes:async()=>[q]};}
function db() {
  const position={id:'p',userId:'u',symbol:'XAUUSD',status:'OPEN',side:'LONG',size:'1',entryPrice:'2000',initialMargin:'200',liquidationPrice:'1810'};
  const tx={user:{findUnique:jest.fn(async()=>({createdAt:new Date(at-365*86400000)}))},
    futuresBalance:{findUnique:jest.fn(async()=>({available:'9800',locked:'200'})),update:jest.fn(),upsert:jest.fn()},
    cfdPosition:{findUnique:jest.fn(async()=>position),findFirst:jest.fn(async()=>null),create:jest.fn(),update:jest.fn()}};
  const prisma={cfdPosition:{findMany:async()=>[position]},$transaction:jest.fn(async(fn:any)=>fn(tx))};return {tx,prisma:prisma as any};
}
test.each(invalid)('open, close and liquidation make no financial writes on %s',async(_,over)=>{
  const {tx,prisma}=db(),data=source(quote(over)),service=new CfdPositionService(prisma,data);
  await expect(service.open({userId:'u',symbol:'XAUUSD',side:'BUY',quantity:new BigNumber(1),leverage:10})).rejects.toThrow();
  await expect(service.close({userId:'u',positionId:'p'})).rejects.toThrow();
  expect(await new CfdLiquidationEngine(prisma,data).checkAndLiquidate()).toBe(0);
  expect(tx.futuresBalance.update).not.toHaveBeenCalled();expect(tx.futuresBalance.upsert).not.toHaveBeenCalled();expect(tx.cfdPosition.update).not.toHaveBeenCalled();
});
test.each(['open','close','liquidation'])('%s revalidates after database wait before money writes',async(kind)=>{
  const {tx,prisma}=db(),data=source(quote());
  tx.futuresBalance.findUnique.mockImplementation(async()=>{jest.setSystemTime(at+6000);return {available:'9800',locked:'200'};});
  const service=new CfdPositionService(prisma,data);
  const action=kind==='open'?service.open({userId:'u',symbol:'XAUUSD',side:'BUY',quantity:new BigNumber(1),leverage:10})
    :kind==='close'?service.close({userId:'u',positionId:'p'}):new CfdLiquidationEngine(prisma,data).liquidatePosition('p',quote());
  await expect(action).rejects.toThrow('temporarily unavailable');expect(tx.futuresBalance.update).not.toHaveBeenCalled();expect(tx.futuresBalance.upsert).not.toHaveBeenCalled();
});

function adapter(raw:unknown,options:any={}){
  const fetchFn=jest.fn(async()=>({ok:true,status:200,json:async()=>raw}) as Response);
  const service=new CfdMarketDataService('test-key',fetchFn,undefined,{retries:0},{now:()=>Date.now(),creditsPerMinute:100,creditsPerDay:10000,
    entitledSymbols:['XAUUSD'],executionSymbols:['XAUUSD'],...options});return {fetchFn,service};
}
test('provider close and Unix timestamp normalize without bid/ask fabrication, concurrent quotes cost one batch',async()=>{
  const {service,fetchFn}=adapter({'XAU/USD':{close:'2000.1',timestamp:at/1000,is_market_open:true}});
  const rows=await Promise.all(Array.from({length:30},()=>service.getExecutionQuote('XAUUSD')));
  expect(fetchFn).toHaveBeenCalledTimes(1);expect(rows[0]).toMatchObject({last:2000.1,bid:null,ask:null,mid:null,providerTimestamp:at,fetchedAt:at,status:'live'});
  expect((await service.diagnostics()).credits).toMatchObject({minuteUsed:6,dayUsed:6});
});
test.each([null,'',true,'NaN','Infinity',{},'0','-5','0x10'])('malformed provider close %p cannot execute',async(close)=>{
  const {service}=adapter({'XAU/USD':{close,timestamp:at/1000}});await expect(service.getExecutionQuote('XAUUSD')).rejects.toThrow();
});
test.each([null,undefined,0,(at-60000)/1000,(at+60000)/1000])('missing/old/future provider timestamp %p cannot execute',async(timestamp)=>{
  const {service}=adapter({'XAU/USD':{close:'2000',timestamp}});await expect(service.getExecutionQuote('XAUUSD')).rejects.toThrow();
});
test('support, entitlement, actual freshness and execution approval remain independent',async()=>{
  const {service}=adapter({'XAU/USD':{close:'2000',timestamp:at/1000}},{entitledSymbols:[],executionSymbols:[]});
  expect(service.catalog()).toHaveLength(13);expect(CFD_REFERENCE_CATALOG.some(i=>/gas/i.test(i.name))).toBe(false);
  expect((await service.getQuotes()).find(q=>q.symbol==='XAUUSD')).toMatchObject({status:'reference_only',executionAllowed:false});
  expect((await service.getQuotes()).find(q=>q.symbol==='WTIUSD')).toMatchObject({status:'entitlement_required',last:null,bid:null,ask:null});
  await expect(service.getExecutionQuote('XAUUSD')).rejects.toThrow();
  expect(()=>adapter({}, {entitledSymbols:['GUESS']})).toThrow('Unverified');
});
test('provider outage yields unavailable, never an old execution price',async()=>{
  const {service,fetchFn}=adapter({'XAU/USD':{close:'2000',timestamp:at/1000}});
  await service.getExecutionQuote('XAUUSD');jest.setSystemTime(at+6000);fetchFn.mockRejectedValue(Error('provider down'));
  await expect(service.getExecutionQuote('XAUUSD')).rejects.toThrow();
  expect((await service.getQuotes()).find(q=>q.symbol==='XAUUSD')).toMatchObject({status:'unavailable',executionAllowed:true,last:null});
});
test('minute/day quota counts actual symbol cost and denies HTTP, including retries',async()=>{
  const {service,fetchFn}=adapter({}, {creditsPerMinute:5});await service.getQuotes();expect(fetchFn).not.toHaveBeenCalled();
  let now=at;const b=new CfdCreditBudget(8,10,()=>now);b.take(6);expect(()=>b.take(3)).toThrow();now+=60001;b.take(4);expect(()=>b.take(1)).toThrow();
  now+=86400001;expect(()=>b.take(8)).not.toThrow();
});
