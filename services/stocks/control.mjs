// Explicit local operator commands; never mounted as an API route.
import { readFileSync,writeFileSync,renameSync,existsSync } from 'node:fs';
import { resolve,join } from 'node:path';
const [command,id]=process.argv.slice(2),dir=resolve(process.env.STOCKS_DATA_DIR??'/data');
if(!existsSync(join(dir,'stocks.sqlite')))throw Error('Initialize stock storage first');
if(!['backfill-start','backfill-pause','backfill-resume'].includes(command))throw Error('Use backfill-start ID, backfill-pause or backfill-resume');
let control={enabled:false,instrumentId:null};
const path=join(dir,'backfill-control.json');if(existsSync(path))control=JSON.parse(readFileSync(path,'utf8'));
if(command==='backfill-start'){
  const manifest=JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url)));
  if(!manifest.some(i=>i.instrumentId===id&&i.enabled&&i.dataRightsStatus==='confirmed'))throw Error('Only explicitly entitled/active instrument can be backfilled');
  control={enabled:true,instrumentId:id};
}else if(command==='backfill-resume'){if(!control.instrumentId)throw Error('No backfill to resume');control.enabled=true;}else control.enabled=false;
writeFileSync(path+'.tmp',JSON.stringify(control),{mode:0o600});renameSync(path+'.tmp',path);console.log('Stock backfill control updated; durable cursor retained');
