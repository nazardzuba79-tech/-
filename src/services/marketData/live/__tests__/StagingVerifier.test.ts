import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
const {settings,Tracker,SSEParser,parseFrame,secretIn,safeDiagnostics,verify}=require('../../../../../scripts/verify-market-data-staging.cjs');
const token=randomBytes(24).toString('hex');
const row=(overrides:any={})=>({id:'spot:BTCUSDT',pair:'BTC/USDT',symbol:'BTC/USDT',provider:'bybit',providerSymbol:'BTCUSDT',marketType:'spot',baseAsset:'BTC',quoteAsset:'USDT',settleAsset:null,lastPrice:1,bidPrice:null,askPrice:null,high24h:null,low24h:null,volume24h:0,quoteVolume24h:0,changePercent24h:0,indexPrice:null,markPrice:null,fundingRate:null,fundingIntervalMinutes:null,openInterest:null,openInterestValue:null,providerEventAt:10,sequence:1,receivedAt:10,fetchedAt:10,stale:false,...overrides});
const frame=(type='snapshot',revision=1,rows=[row()],epoch='a')=>JSON.stringify({version:1,type,rows,epoch,revision,status:'live',sentAt:Date.now()});
describe('read-only staging verifier',()=>{
  test.each(['http://remote.invalid','https://u:p@host.invalid','https://host.invalid?token=x','https://host.invalid/#secret','https://host.invalid/private'])('refuses unsafe collector URL %s',url=>{
    expect(()=>settings({MARKET_DATA_COLLECTOR_URL:url,MARKET_DATA_COLLECTOR_TOKEN:token,VOLTEX_API_URL:'https://api.invalid'})).toThrow();
  });
  test('accepts loopback QA and HTTPS origins; API /api/v1 suffix is normalized',()=>{
    expect(settings({MARKET_DATA_COLLECTOR_URL:'http://127.0.0.1:1',MARKET_DATA_COLLECTOR_TOKEN:token,VOLTEX_API_URL:'https://api.invalid/api/v1',STAGING_SOAK_MINUTES:'15'})).toMatchObject({api:'https://api.invalid',soakMs:900000});
  });
  test('missing config fails without IO or printing any environment value',async()=>{
    const log=jest.fn(),result=await verify({MARKET_DATA_COLLECTOR_TOKEN:token},log);
    expect(result.ok).toBe(false);expect(JSON.stringify(log.mock.calls)).not.toContain(token);
  });
  test('snapshot/delta identity, real zero, null and stale remain distinct',()=>{
    const t=new Tracker(token);t.receive(frame());t.receive(frame('delta',2,[row({lastPrice:0,stale:true})]));
    expect(t.rows.get('spot:BTCUSDT')).toMatchObject({lastPrice:0,markPrice:null,stale:true});
    expect(t.report()).toMatchObject({tickers:1,assets:1,stale:1,deltas:1});
  });
  test('reconnect rejects same-epoch rollback and delta before authoritative snapshot',()=>{
    const t=new Tracker(token);t.receive(frame('snapshot',5));t.reconnect();expect(()=>t.receive(frame('snapshot',4))).toThrow();
    expect(()=>t.receive(frame('delta',6))).toThrow();t.receive(frame('snapshot',7));expect(t.report().revisionGaps).toBe(2);
  });
  test('rejects old ticker timestamp and malformed values, including absent instead of null',()=>{
    const t=new Tracker(token);t.receive(frame());expect(()=>t.receive(frame('delta',2,[row({providerEventAt:9})]))).toThrow();
    for(const lastPrice of ['0',undefined])expect(()=>parseFrame(frame('snapshot',1,[row({lastPrice})]))).toThrow();
    expect(()=>parseFrame(frame('snapshot',1,[row(),row()]))).toThrow();
  });
  test('SSE parser handles split CRLF, comments, event/data chunks and multiple events',()=>{
    const t=new Tracker(token),p=new SSEParser((data:string,event:string)=>t.receive(data,event));
    const wire=`: ping\r\n\r\nevent: snapshot\r\ndata: ${frame()}\r\n\r\nevent: delta\r\ndata: ${frame('delta',2)}\r\n\r\n`;
    for(let i=0;i<wire.length;i+=13)p.push(wire.slice(i,i+13));expect(t.report().frames).toBe(2);
    expect(()=>p.push('x'.repeat(16_065_537))).toThrow();
  });
  test('tokens in raw, encoded, JSON-escaped or base64 SSE cause a hard failure',()=>{
    for(const text of [token,encodeURIComponent(token),Buffer.from(token).toString('base64')])expect(secretIn(text,token)).toBe(true);
    expect(secretIn(JSON.stringify('a"b'),'a"b')).toBe(true);
    const t=new Tracker(token);expect(()=>t.receive(frame().replace('"status":"live"',`"leak":"${token}","status":"live"`))).toThrow();
  });
  test('diagnostics output allows numeric counters and known states, never arbitrary server config',()=>{
    const d=safeDiagnostics({token,url:token,status:token,memory:{rss:100,secret:token},connections:[{category:token,state:token,topics:3}]});
    expect(JSON.stringify(d)).not.toContain(token);expect(d.memory.rss).toBe(100);
  });
  test('CLI uses env only, no local storage, financial imports, mutation requests or secret-bearing URLs',()=>{
    const source=readFileSync(resolve(__dirname,'../../../../../scripts/verify-market-data-staging.cjs'),'utf8');
    expect(source).toContain('Authorization:`Bearer ${');expect(source).toContain("redirect:'error'");
    expect(source).not.toMatch(/localStorage|sessionStorage|NEXT_PUBLIC|DATABASE_URL|method:\s*['"](?:POST|PUT|PATCH|DELETE)|console\.(?:error|log)\(.*(?:config|token|\.stack)/);
  });
});
