import { readFileSync, statfsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const limits = Object.freeze(JSON.parse(readFileSync(new URL('./limits.json', import.meta.url))));
const ceilings = {MAX_INSTRUMENTS:250,UPSTREAM_REQUESTS_IN_FLIGHT:1,MAX_CANDLES_PER_PROVIDER_RESPONSE:500,WRITE_BATCH_CANDLES:250,WRITER_CONCURRENCY:1,MAX_PENDING_CANDLES:1000,BACKFILL_JOB_CONCURRENCY:1,BACKFILL_MAX_CANDLES_PER_MINUTE:1000,BACKFILL_INITIAL_LOOKBACK_DAYS:30,CHART_DEFAULT_LIMIT:300,CHART_HARD_LIMIT:500,MAX_UNCACHED_HISTORY_READS:2,MAX_PENDING_HISTORY_READS:8,STOCK_CACHE_MAX_MIB:16,PROVIDER_RESPONSE_MAX_MIB:1,STOCK_LOCAL_DATA_BUDGET:1073741824,STOCK_WAL_PAUSE_THRESHOLD:67108864};
export function validateLimits(value) {
  for (const [key,max] of Object.entries(ceilings)) if (!Number.isSafeInteger(value[key]) || value[key] < 1 || value[key] > max) throw Error(`Invalid limit: ${key}`);
  if (value.MIN_UPSTREAM_REQUEST_GAP_MS < 2000 || value.MIN_FREE_DISK < 10737418240 || value.BACKFILL_ENABLED_BY_DEFAULT !== false) throw Error('Unsafe stock defaults');
  if (value.WRITE_BATCH_CANDLES > value.MAX_CANDLES_PER_PROVIDER_RESPONSE || value.CHART_DEFAULT_LIMIT > value.CHART_HARD_LIMIT) throw Error('Inconsistent limits');
  return value;
}
validateLimits(limits);
export function validateManifest(rows) {
  if (!Array.isArray(rows) || rows.length > limits.MAX_INSTRUMENTS) throw Error('Catalogue limit');
  const seen = new Set(), counts = {USA:0,Russia:0,Asia:0};
  for (const i of rows) {
    if (!/^[A-Z0-9]{4}:[A-Za-z0-9._-]{1,24}$/.test(i.instrumentId) || seen.has(i.instrumentId)) throw Error('Invalid canonical instrument');
    for (const field of ['symbol','exchange','name','type','country','currency','exchangeTimeZone','provider','providerSymbol','dataRightsStatus']) if (!i[field]) throw Error(`Missing ${field}`);
    if (!['stock','index'].includes(i.type) || !/^[A-Z]{3}$/.test(i.currency) || !(i.region in counts)) throw Error('Invalid instrument metadata');
    new Intl.DateTimeFormat('en',{timeZone:i.exchangeTimeZone});
    if (i.enabled && i.dataRightsStatus !== 'confirmed') throw Error('Unlicensed activation');
    counts[i.region]++; seen.add(i.instrumentId);
  }
  if (counts.USA>100 || counts.Russia>50 || counts.Asia>100) throw Error('Regional limit');
  return rows;
}
export class Busy extends Error { constructor(){super('Stock capacity exhausted');this.status=503;} }
export class ReadGate {
  active=0; queue=[];
  async run(fn) {
    if(this.active>=limits.MAX_UNCACHED_HISTORY_READS) {
      if(this.queue.length>=limits.MAX_PENDING_HISTORY_READS) throw new Busy();
      await new Promise((resolve,reject)=>{const entry={resolve,reject};entry.timer=setTimeout(()=>{this.queue=this.queue.filter(x=>x!==entry);reject(new Busy());},2000);this.queue.push(entry);});
    } else this.active++;
    try{return await fn();}finally{const next=this.queue.shift();if(next){clearTimeout(next.timer);next.resolve();}else this.active--;}
  }
  close(){for(const x of this.queue){clearTimeout(x.timer);x.reject(new Busy());}this.queue=[];}
}
export class ByteCache {
  entries=new Map();bytes=0; pending=new Map();
  constructor(max=limits.STOCK_CACHE_MAX_MIB*1048576){this.max=max;}
  async get(key,loader,now=Date.now()) {
    const hit=this.entries.get(key);if(hit&&hit.until>now)return hit.value;
    if(this.pending.has(key))return this.pending.get(key);
    const work=Promise.resolve().then(loader).then(value=>{const size=Buffer.byteLength(value);if(size<=this.max){if(hit){this.entries.delete(key);this.bytes-=hit.size;}while(this.bytes+size>this.max){const [k,v]=this.entries.entries().next().value;this.entries.delete(k);this.bytes-=v.size;}this.entries.set(key,{value,size,until:now+900000});this.bytes+=size;}return value;}).finally(()=>this.pending.delete(key));
    this.pending.set(key,work);return work;
  }
  clear(){this.entries.clear();this.bytes=0;}
}
export function diskGuard(dir) {
  const fs=statfsSync(dir);let bytes=0;
  const walk=p=>{for(const f of readdirSync(p,{withFileTypes:true})){if(f.isSymbolicLink())throw Error('Stock directory contains symlink');const child=join(p,f.name);if(f.isDirectory())walk(child);else{const size=statSync(child).size;bytes+=size;if(f.name.endsWith('-wal')&&size>=limits.STOCK_WAL_PAUSE_THRESHOLD)throw Error('WAL pause');}}};walk(dir);
  if(bytes>=limits.STOCK_LOCAL_DATA_BUDGET || fs.bavail*fs.bsize<limits.MIN_FREE_DISK)throw Error('Stock storage paused');
  return bytes;
}
const decimal = v => typeof v==='string' && /^(?:0|[1-9]\d{0,14})(?:\.\d{1,12})?$/.test(v);
export function validateCandle(c,i,now=Date.now()) {
  if(c.instrumentId!==i.instrumentId || c.currency!==i.currency || c.interval!=='15m' || c.provider!==i.provider || c.adjustmentMode!=='unadjusted')throw Error('Candle identity mismatch');
  if(!Number.isSafeInteger(c.openTimeUtc)||!Number.isSafeInteger(c.closeTimeUtc)||c.closeTimeUtc-c.openTimeUtc!==900000||c.closeTimeUtc>now||c.openTimeUtc<0)throw Error('Candle is not closed');
  if(!['open','high','low','close'].every(k=>decimal(c[k])))throw Error('Invalid decimal price');
  const [o,h,l,cl]=['open','high','low','close'].map(k=>Number(c[k]));if(l<=0||l>Math.min(o,cl)||h<Math.max(o,cl))throw Error('Invalid OHLC');
  if(c.volume!==null && !decimal(c.volume))throw Error('Invalid volume');
  if(!Number.isSafeInteger(c.providerTimestamp)||!Number.isSafeInteger(c.fetchedAt)||c.fetchedAt<c.closeTimeUtc||c.fetchedAt>now)throw Error('Invalid provenance');
  return c;
}
export class Store {
  constructor(path,{readonly=false}={}) {
    this.db=new DatabaseSync(path,{readOnly:readonly});this.db.exec('PRAGMA busy_timeout=200; PRAGMA cache_size=-2048;');
    if(!readonly){ // DELETE avoids depending on WAL fixes in the shared crypto runtime.
      this.db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS candles(instrumentId TEXT,interval TEXT,openTimeUtc INTEGER,closeTimeUtc INTEGER,open TEXT,high TEXT,low TEXT,close TEXT,volume TEXT,currency TEXT,provider TEXT,providerTimestamp INTEGER,fetchedAt INTEGER,adjustmentMode TEXT,PRIMARY KEY(instrumentId,interval,openTimeUtc,adjustmentMode)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS checkpoints(instrumentId TEXT PRIMARY KEY,cursor INTEGER NOT NULL,completed INTEGER NOT NULL DEFAULT 0);`);
    }
  }
  write(rows,i,now=Date.now()){
    if(rows.length>limits.MAX_CANDLES_PER_PROVIDER_RESPONSE)throw Error('Provider candle limit');
    let last=-1;for(const c of rows){validateCandle(c,i,now);if(c.openTimeUtc<=last)throw Error('Unordered or duplicate response');last=c.openTimeUtc;}
    const q=this.db.prepare(`INSERT INTO candles VALUES(${Array(14).fill('?').join(',')}) ON CONFLICT DO UPDATE SET open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,volume=excluded.volume,providerTimestamp=excluded.providerTimestamp,fetchedAt=excluded.fetchedAt WHERE candles.open!=excluded.open OR candles.high!=excluded.high OR candles.low!=excluded.low OR candles.close!=excluded.close OR candles.volume IS NOT excluded.volume`);
    let changes=0;for(let n=0;n<rows.length;n+=limits.WRITE_BATCH_CANDLES){this.db.exec('BEGIN IMMEDIATE');try{for(const c of rows.slice(n,n+limits.WRITE_BATCH_CANDLES))changes+=Number(q.run(...['instrumentId','interval','openTimeUtc','closeTimeUtc','open','high','low','close','volume','currency','provider','providerTimestamp','fetchedAt','adjustmentMode'].map(k=>c[k])).changes);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}}
    return changes;
  }
  history(id,limit=300,before=Number.MAX_SAFE_INTEGER){return this.db.prepare("SELECT * FROM candles WHERE instrumentId=? AND interval='15m' AND adjustmentMode='unadjusted' AND openTimeUtc<? ORDER BY openTimeUtc DESC LIMIT ?").all(id,before,limit).reverse();}
  checkpoint(id,cursor,completed=false){this.db.prepare('INSERT INTO checkpoints VALUES(?,?,?) ON CONFLICT DO UPDATE SET cursor=excluded.cursor,completed=excluded.completed').run(id,cursor,Number(completed));}
  close(){this.db.close();}
}
export const moduleDirectory=fileURLToPath(new URL('.',import.meta.url));
