import BigNumber from 'bignumber.js';
import { EventEmitter } from 'events';
import { ResilientCfdQuoteSource } from '../../services/marketData/cfd/ResilientCfdQuoteSource';
import { TraderMadeStreamQuoteSource, traderMadePrice, traderMadeTimestamp } from '../../services/marketData/cfd/TraderMadeStreamQuoteSource';
import { CfdQuoteUnavailable, type CfdQuote, type CfdQuoteSource } from '../../services/marketData/cfd/CfdQuote';

const START=Date.UTC(2026,8,14,12,0,0);
const quote=(provider:string,price='2000',at=START,execution=true):CfdQuote=>({provider,symbol:'XAUUSD',providerSymbol:provider==='tradermade'?'XAUUSD':'XAU/USD',
  bid:Number(price)-.1,ask:Number(price)+.1,mid:Number(price),last:Number(price),lastDecimal:price,providerTimestamp:at,fetchedAt:at,
  stale:false,status:'live',referenceStatus:'available',entitlementVerified:true,executionAllowed:execution});
class FakeSource implements CfdQuoteSource {
  maxQuoteAgeMs=5000; configured=true; rows=new Map<string,CfdQuote>(); fail=false; delay=0;
  constructor(readonly id:string,q?:CfdQuote){if(q)this.rows.set(q.symbol,q);}
  isConfigured(){return this.configured;}
  async getFreshQuote(symbol:string){if(this.delay)await new Promise(r=>setTimeout(r,this.delay));if(this.fail||!this.rows.has(symbol))throw new CfdQuoteUnavailable('fake');return {...this.rows.get(symbol)!};}
  async getQuotes(){if(this.delay)await new Promise(r=>setTimeout(r,this.delay));if(this.fail)throw Error('fake');return [...this.rows.values()].map(q=>({...q}));}
  catalog(){return [{symbol:'XAUUSD',entitlement:this.rows.has('XAUUSD')?'verified':'entitlement_required',executionAllowed:this.rows.get('XAUUSD')?.executionAllowed===true}];}
}

describe('Resilient CFD execution routing',()=>{
  let now=START;
  beforeEach(()=>{now=START;});
  const router=(a:FakeSource,b:FakeSource,over:any={})=>new ResilientCfdQuoteSource([
    {id:'twelvedata',source:a,priority:10,lineage:'twelve-delivery',enabled:true,admissionEvidence:'contract-a'},
    {id:'tradermade',source:b,priority:20,lineage:'tradermade-delivery',enabled:true,admissionEvidence:'contract-b'},
  ],{now:()=>now,providerWaitMs:30,failbackSamples:2,failbackHoldMs:1000,maxDivergenceBps:100,minExecutionLineages:2,...over});
  test('immediate failover to independent live reserve',async()=>{
    const a=new FakeSource('twelvedata',quote('twelvedata')),b=new FakeSource('tradermade',quote('tradermade','2000.5'));a.fail=true;
    expect(await router(a,b).getFreshQuote('XAUUSD')).toMatchObject({provider:'tradermade',executionAllowed:true});
  });
  test('provider timeout does not block a healthy stream reserve',async()=>{
    const a=new FakeSource('twelvedata',quote('twelvedata')),b=new FakeSource('tradermade',quote('tradermade'));a.delay=200;
    const started=Date.now();expect((await router(a,b).getFreshQuote('XAUUSD')).provider).toBe('tradermade');expect(Date.now()-started).toBeLessThan(150);
  });
  test('independent material disagreement quarantines rather than averaging',async()=>{
    const a=new FakeSource('twelvedata',quote('twelvedata','2000')),b=new FakeSource('tradermade',quote('tradermade','2100'));
    await expect(router(a,b).getFreshQuote('XAUUSD')).rejects.toMatchObject({reason:'provider_conflict'});
    expect((await router(a,b).getQuotes()).find(q=>q.symbol==='XAUUSD')).toMatchObject({last:null,status:'unavailable'});
  });
  test('stale provider cannot win over fresh reserve',async()=>{
    const a=new FakeSource('twelvedata',quote('twelvedata','2000',START-6000)),b=new FakeSource('tradermade',quote('tradermade','2000.2'));
    expect((await router(a,b).getFreshQuote('XAUUSD')).provider).toBe('tradermade');
  });
  test('failback requires distinct primary samples and hold time',async()=>{
    const a=new FakeSource('twelvedata',quote('twelvedata')),b=new FakeSource('tradermade',quote('tradermade'));a.fail=true;const r=router(a,b);
    expect((await r.getFreshQuote('XAUUSD')).provider).toBe('tradermade');
    a.fail=false;now+=500;a.rows.set('XAUUSD',quote('twelvedata','2000',now));b.rows.set('XAUUSD',quote('tradermade','2000',now));
    expect((await r.getFreshQuote('XAUUSD')).provider).toBe('tradermade');
    now+=600;a.rows.set('XAUUSD',quote('twelvedata','2000',now));b.rows.set('XAUUSD',quote('tradermade','2000',now));
    expect((await r.getFreshQuote('XAUUSD')).provider).toBe('twelvedata');
  });
  test('source without explicit admission evidence is invisible',async()=>{
    const b=new FakeSource('tradermade',quote('tradermade'));
    const r=new ResilientCfdQuoteSource([{id:'tradermade',source:b,priority:1,lineage:'tm',enabled:true,admissionEvidence:''}],{now:()=>now,minExecutionLineages:1});
    await expect(r.getFreshQuote('XAUUSD')).rejects.toMatchObject({reason:'no_admitted_provider'});
  });
  test('one admitted lineage stays usable for risk but blocks new execution',async()=>{
    const b=new FakeSource('tradermade',quote('tradermade'));
    const unavailable=new FakeSource('twelvedata');unavailable.configured=false;
    const r=router(unavailable,b);
    const q=await r.getFreshQuote('XAUUSD');expect(q).toMatchObject({provider:'tradermade',status:'live',entitlementVerified:true,executionAllowed:false});
    expect((await r.diagnostics())).toMatchObject({admittedLineages:1,executionRedundancyConfigured:false});
  });
  test('same lineage is not counted twice for opening redundancy',async()=>{
    const a=new FakeSource('twelvedata',quote('twelvedata')),b=new FakeSource('tradermade',quote('tradermade'));
    const r=new ResilientCfdQuoteSource([
      {id:'twelvedata',source:a,priority:10,lineage:'same-upstream',enabled:true,admissionEvidence:'a'},
      {id:'tradermade',source:b,priority:20,lineage:'same-upstream',enabled:true,admissionEvidence:'b'},
    ],{now:()=>now,minExecutionLineages:2});
    expect(await r.getFreshQuote('XAUUSD')).toMatchObject({executionAllowed:false});
  });
  test('executable reserve is preferred over a non-opening primary',async()=>{
    const a=new FakeSource('twelvedata',quote('twelvedata','2000',START,false)),b=new FakeSource('tradermade',quote('tradermade','2000',START,true));
    expect(await router(a,b).getFreshQuote('XAUUSD')).toMatchObject({provider:'tradermade',executionAllowed:true});
  });
});

describe('TraderMade streaming normalization',()=>{
  test('parses V2 UTC tick time and legacy epoch safely',()=>{
    expect(traderMadeTimestamp('20260914-12:34:56.789')).toBe(Date.UTC(2026,8,14,12,34,56,789));
    expect(traderMadeTimestamp('1789387200')).toBe(1789387200000);expect(traderMadeTimestamp('bad')).toBeNull();
  });
  test('uses provider midpoint when present and exact derived midpoint otherwise',()=>{
    expect(traderMadePrice('1.1000','1.1002','1.1001')).toEqual({bid:'1.1000',ask:'1.1002',mid:'1.1001',basis:'provider_mid'});
    expect(traderMadePrice('1.1000','1.1001',undefined)).toEqual({bid:'1.1000',ask:'1.1001',mid:'1.10005',basis:'derived_mid'});
    expect(traderMadePrice('2','1',undefined)).toBeNull();
  });
  test('subscription, rights evidence and source timestamp all gate financial quote',async()=>{
    class FakeSocket extends EventEmitter { readyState=1; sent:string[]=[]; send(v:string){this.sent.push(v);} close(){this.emit('close');} terminate(){this.emit('close');} }
    const socket=new FakeSocket();
    const source=new TraderMadeStreamQuoteSource('key',{now:()=>START,maxQuoteAgeMs:5000,entitledSymbols:['XAUUSD'],executionSymbols:['XAUUSD'],financialUseEvidence:'agreement-123',socketFactory:()=>socket as any,reconnectBaseMs:99999});
    source.start();socket.emit('open');source.handleMessage(JSON.stringify({type:'login_ok',cfds:true}));
    source.handleMessage(JSON.stringify({type:'sub_ack',accepted:['XAUUSD:QUOTE'],denied:[],invalid:[]}));
    source.handleMessage(JSON.stringify({t:'QUOTE',s:'XAUUSD',b:'1999.9',a:'2000.1',ts:'20260914-12:00:00.000'}));
    const q=await source.getFreshQuote('XAUUSD');expect(q).toMatchObject({provider:'tradermade',lastDecimal:'2000',entitlementVerified:true,executionAllowed:true});
    expect(new BigNumber(q.lastDecimal!).toString()).toBe('2000');source.stop();
  });
  test('missing financial-use evidence fails closed even with a key and tick',async()=>{
    const source=new TraderMadeStreamQuoteSource('key',{now:()=>START,entitledSymbols:['XAUUSD'],executionSymbols:['XAUUSD']});
    expect(source.isConfigured()).toBe(false);await expect(source.getFreshQuote('XAUUSD')).rejects.toBeInstanceOf(CfdQuoteUnavailable);
  });
});
