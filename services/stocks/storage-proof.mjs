// A conservative 30-calendar-day, continuous-session fixture upper bound.
// Does not claim actual exchange calendar coverage or live market history.
import { readFileSync,statSync,readdirSync } from 'node:fs';
import { Store,diskGuard } from './core.mjs';
import assert from 'node:assert/strict';
const dir='/testdata',path=dir+'/thirty-days.sqlite';assert.equal(process.env.STOCK_STORAGE_PROOF,'isolated-ci');assert.ok(!readdirSync(dir).length);
diskGuard(dir);const store=new Store(path),instruments=JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url))),now=Date.now();let count=0;
for(const i of instruments){for(let start=0;start<2880;start+=500){const rows=Array.from({length:Math.min(500,2880-start)},(_,n)=>({instrumentId:i.instrumentId,interval:'15m',openTimeUtc:now-(2880-start-n)*900000,closeTimeUtc:now-(2879-start-n)*900000,open:'100.12345678',high:'102.12345678',low:'99.12345678',close:'101.12345678',volume:null,currency:i.currency,provider:i.provider,providerTimestamp:now,fetchedAt:now,adjustmentMode:'unadjusted'}));count+=store.write(rows,i,now);}diskGuard(dir);}
const pages=store.db.prepare('PRAGMA page_count').get().page_count,pageSize=store.db.prepare('PRAGMA page_size').get().page_size;
assert.equal(count,720000);assert.equal(store.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');store.close();
const files=readdirSync(dir).map(name=>({name,bytes:statSync(dir+'/'+name).size}));console.log(JSON.stringify({scope:'30-day continuous-session fixture upper bound, not actual licensed history',instruments:250,candles:count,files,pageCount:pages,pageSize,indexesIncluded:true,journalMode:'delete',journalAtRest:files.filter(f=>f.name.endsWith('-journal')).reduce((s,f)=>s+f.bytes,0),transientJournalPeak:'not measured',memoryPeak:readFileSync('/sys/fs/cgroup/memory.peak','utf8').trim(),memoryEvents:readFileSync('/sys/fs/cgroup/memory.events','utf8').trim()},null,2));
