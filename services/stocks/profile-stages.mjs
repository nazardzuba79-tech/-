// Offline microprofile, fixture data only. Not a throughput/capacity acceptance test.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Store, ByteCache } from './core.mjs';

const instruments = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url))).slice(0,20);
const dir = mkdtempSync(join(tmpdir(), 'stocks-stage-profile-'));
const store = new Store(join(dir, 'fixture.sqlite'));
const now = 1791622800000, iterations = Number(process.env.STOCK_PROFILE_ITERATIONS ?? 2000);
if (!Number.isSafeInteger(iterations) || iterations < 100 || iterations > 20000) throw Error('Invalid profile iterations');
const results = {}, samples = [];
const measure = (stage, action) => {
  const start = performance.now(), cpu = process.cpuUsage();
  const value = action(), delta = process.cpuUsage(cpu);
  const result = results[stage] ??= {calls:0, wallMs:0, cpuMs:0};
  result.calls++; result.wallMs += performance.now()-start; result.cpuMs += (delta.user+delta.system)/1000;
  return value;
};
try {
  for (const instrument of instruments) store.write(Array.from({length:499}, (_, n) => ({
    instrumentId:instrument.instrumentId, interval:'15m', openTimeUtc:now-(500-n)*900000,
    closeTimeUtc:now-(499-n)*900000, open:'100.12345678',high:'102.87654321',low:'99.01234567',close:'101.56781234',
    volume:null,currency:instrument.currency,provider:instrument.provider,providerTimestamp:now,fetchedAt:now,adjustmentMode:'unadjusted',
  })), instrument, now);
  const all = store.db.prepare("SELECT * FROM candles WHERE instrumentId=? AND interval='15m' AND adjustmentMode='unadjusted' AND openTimeUtc<? ORDER BY openTimeUtc DESC LIMIT ?");
  const projected = store.db.prepare("SELECT openTimeUtc,closeTimeUtc,open,high,low,close,volume,fetchedAt FROM candles WHERE instrumentId=? AND interval='15m' AND adjustmentMode='unadjusted' AND openTimeUtc<? ORDER BY openTimeUtc DESC LIMIT ?");
  const sqlJson = store.db.prepare("SELECT json_group_array(json_object('openTimeUtc',openTimeUtc,'closeTimeUtc',closeTimeUtc,'open',open,'high',high,'low',low,'close',close,'volume',volume,'fetchedAt',fetchedAt)) AS candles FROM (SELECT openTimeUtc,closeTimeUtc,open,high,low,close,volume,fetchedAt FROM (SELECT openTimeUtc,closeTimeUtc,open,high,low,close,volume,fetchedAt FROM candles WHERE instrumentId=? AND interval='15m' AND adjustmentMode='unadjusted' AND openTimeUtc<? ORDER BY openTimeUtc DESC LIMIT ?) ORDER BY openTimeUtc ASC)");
  const cache = new ByteCache(undefined, page => page.body.length+128);
  // Alternate query modes within each iteration to avoid assigning all warm-up to one variant.
  for (let n=0;n<iterations;n++) {
    const i=instruments[n%instruments.length];
    for (const mode of n%2 ? ['projection','full'] : ['full','projection']) {
      const raw=measure(`${mode}.sql`,()=> (mode==='full'?all:projected).all(i.instrumentId,Number.MAX_SAFE_INTEGER,300));
      const candles=measure(`${mode}.prepare`,()=> mode==='full' ? raw.reverse().map(({openTimeUtc,closeTimeUtc,open,high,low,close,volume,fetchedAt})=>({openTimeUtc,closeTimeUtc,open,high,low,close,volume,fetchedAt})) : raw.reverse());
      const json=measure(`${mode}.json`,()=>JSON.stringify({instrumentId:i.instrumentId,currency:i.currency,provider:i.provider,adjustmentMode:'unadjusted',candles,next:candles[0].openTimeUtc}));
      const body=measure(`${mode}.utf8`,()=>Buffer.from(json));
      if(n<instruments.length&&mode==='full') samples.push({id:i.instrumentId,body});
    }
    const jsonCandles=measure('sqliteJson.sqlAndJson',()=>sqlJson.get(i.instrumentId,Number.MAX_SAFE_INTEGER,300).candles);
    measure('sqliteJson.utf8',()=>Buffer.from(jsonCandles));
  }
  for(const page of samples) await cache.get(page.id,()=>page);
  measure('cache.100000Hits',()=>{for(let n=0;n<100000;n++)if(!cache.peek(samples[n%samples.length].id))throw Error('Missing cache fixture');});
  const total = Object.entries(results).filter(([stage])=>stage.startsWith('full.')).reduce((sum,[,value])=>sum+value.cpuMs,0);
  for(const [stage,value] of Object.entries(results)) {value.cpuMsPerCall=value.cpuMs/value.calls;value.wallMsPerCall=value.wallMs/value.calls;if(stage.startsWith('full.'))value.fullPathCpuShare=value.cpuMs/total;}
  console.log(JSON.stringify({kind:'offline-stage-microprofile',fixture:true,capacityClaim:false,node:process.version,platform:process.platform,iterations,instruments:instruments.length,candlesPerPage:300,metrics:results,rssBytes:process.memoryUsage().rss,providerRequests:0,accountDatabaseOpened:false,notes:['Stage clocks include measurement overhead; measured synchronous CPU boundaries, not a production CPU guarantee.','SQL timing includes native SQLite and JavaScript row materialization.','Fixture prices are never served as real market data.']}));
} finally {store.close();rmSync(dir,{recursive:true,force:true});}
