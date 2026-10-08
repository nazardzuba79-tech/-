import { readFileSync,existsSync,openSync,closeSync,unlinkSync,mkdirSync,statSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { Store,validateManifest,diskGuard } from './core.mjs';
import { ProviderGateway,TwelveDataAdapter } from './provider.mjs';
import { Scheduler } from './scheduler.mjs';
import { createStockServer } from './server.mjs';

// Stock-only environment; intentionally refuses the financial DB credential.
if(process.env.DATABASE_URL)throw Error('Financial database access is forbidden');
const dir=resolve(process.env.STOCKS_DATA_DIR??'/data'),db=join(dir,'stocks.sqlite');
if(process.argv[2]==='init'){
  mkdirSync(dir,{recursive:true});if(existsSync(db))throw Error('Stock database already exists');diskGuard(dir);new Store(db).close();console.log('Stock storage initialized');
}else{
  if(process.env.STOCKS_ENABLED!=='true')throw Error('Stocks disabled');
  if(!existsSync(db))throw Error('Explicit stock storage initialization required');
  const instruments=validateManifest(JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url))));
  // Review ships with every entitlement disabled. Activation requires reviewed metadata.
  const active=instruments.filter(x=>x.enabled);const stage=Number(process.env.STOCKS_ACTIVE_STAGE??0);
  if(active.length&&!([10,25,50,100,250].includes(stage)&&active.length<=stage))throw Error('Explicit activation stage required');
  let calendar=null;
  if(active.length){calendar=JSON.parse(readFileSync(join(dir,'calendar.json')));if(calendar.verified!==true||!calendar.sourceUrl?.startsWith('https://')||calendar.validUntil<=Date.now()||!Array.isArray(calendar.sessions)||!Number.isFinite(calendar.publicationDelayMs))throw Error('Verified current exchange calendar required');}
  const lock=join(dir,'runtime.lock'),fd=openSync(lock,'wx',0o600);closeSync(fd);
  const store=new Store(db),gateway=new ProviderGateway(),adapter=new TwelveDataAdapter(gateway,process.env.STOCKS_PROVIDER_KEY);
  const scheduler=new Scheduler({store,adapter,instruments,sessions:calendar?.sessions??[],dataDir:dir,delayMs:calendar?.publicationDelayMs});
  const server=createStockServer({store,instruments,origin:process.env.STOCKS_FRONTEND_ORIGIN??''});
  let timer,stopping=false,nextCollection=0;
  const tick=async()=>{
    if(stopping)return;
    try{if(calendar&&Date.now()<calendar.validUntil){
      if(Date.now()>=nextCollection){await scheduler.cycle();nextCollection=Date.now()+900000+Math.floor(Math.random()*15000);server.stockCache.clear();}
      const controlPath=join(dir,'backfill-control.json');
      if(existsSync(controlPath)){
        if(statSync(controlPath).size>4096)throw Error('Invalid stock control');
        const control=JSON.parse(readFileSync(controlPath,'utf8'));
        if(control.enabled===true){await scheduler.backfill(control.instrumentId);server.stockCache.clear();}
      }
    }}
    catch{console.error('Stock collection paused; previous data retained');}
    finally{if(!stopping&&active.length)timer=setTimeout(tick,30000);}
  };
  server.listen(Number(process.env.PORT??8091),process.env.STOCKS_BIND??'127.0.0.1');if(active.length)void tick();
  // Backfill requires an explicit local operator control file; no HTTP trigger.
  const stop=()=>{if(stopping)return;stopping=true;clearTimeout(timer);scheduler.stop();server.closeAllConnections();server.close(()=>{store.close();unlinkSync(lock);process.exit(0);});};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
