import { limits, diskGuard } from './core.mjs';
import { closedSessionEnd } from './provider.mjs';

export class Scheduler {
  running=false;stopped=false;backfillRunning=false;minuteStart=0;minuteCandles=0;
  constructor({store,adapter,instruments,sessions,dataDir,delayMs,guard=diskGuard}){Object.assign(this,{store,adapter,instruments,sessions,dataDir,delayMs,guard});}
  async cycle(now=Date.now()){
    if(this.running||this.stopped)return false;this.running=true;
    try{for(const i of this.instruments.filter(x=>x.enabled)){if(this.stopped)break;const end=closedSessionEnd(i,this.sessions,now,this.delayMs);if(end===null)continue;
      const latest=this.store.history(i.instrumentId,1).at(-1);
      if(latest&&latest.closeTimeUtc>=end)continue;
      const start=latest?Math.max(latest.openTimeUtc-900000,end-3*900000):end-2*900000;
      const rows=await this.adapter.page(i,start,end);this.guard(this.dataDir);this.store.write(rows,i);}}
    finally{this.running=false;}return true;
  }
  async backfill(id,now=Date.now()){
    if(this.running||this.backfillRunning||this.stopped)return false;
    const i=this.instruments.find(x=>x.instrumentId===id&&x.enabled);if(!i)throw Error('Inactive instrument');
    this.backfillRunning=true;
    try{const saved=this.store.db.prepare('SELECT * FROM checkpoints WHERE instrumentId=?').get(id);if(saved?.completed)return true;
      const cursor=Math.max(saved?.cursor??0,now-limits.BACKFILL_INITIAL_LOOKBACK_DAYS*86400000);
      const end=closedSessionEnd(i,this.sessions,now,this.delayMs);if(end===null||cursor>=end)return false;
      if(now-this.minuteStart>=60000){this.minuteStart=now;this.minuteCandles=0;}
      if(this.minuteCandles+500>limits.BACKFILL_MAX_CANDLES_PER_MINUTE)return false;
      // One bounded time window per explicit step; current collection takes priority.
      const pageEnd=Math.min(end,cursor+500*900000);this.minuteCandles+=500;
      const rows=await this.adapter.page(i,cursor,pageEnd);if(this.running||this.stopped)return false;
      this.guard(this.dataDir);this.store.write(rows,i);this.store.checkpoint(id,pageEnd,pageEnd===end);return pageEnd===end;
    }finally{this.backfillRunning=false;}
  }
  stop(){this.stopped=true;this.adapter.gateway?.close();}
}
