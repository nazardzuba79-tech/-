'use strict';
// Diagnostic-only preload. No application source is edited; no values/SQL/headers are recorded.
const {AsyncLocalStorage}=require('node:async_hooks'),{performance,monitorEventLoopDelay,PerformanceObserver}=require('node:perf_hooks');
const http=require('node:http'),Module=require('node:module'),fs=require('node:fs'),crypto=require('node:crypto');
function install({generated,root}){
 const als=new AsyncLocalStorage(),raw=[],max=160000;let enabled=false,dropped=0,sequence=0;
 const now=()=>performance.now(),current=()=>als.getStore(),emit=(name,start,detail={})=>{if(!enabled)return;if(raw.length>=max){dropped++;return;}raw.push({name,start,ms:now()-start,request:current()?.id??null,...detail});};
 const hook={now,queued(type){return{start:now(),context:current(),type};},dequeued(mark){if(mark)als.run(mark.context,()=>emit('authority.queue.wait',mark.start,{type:mark.type}));}};
 global.__rc50Spans=hook;
 const originalCreate=http.createServer;http.createServer=function(...args){const i=args.findIndex(x=>typeof x==='function');if(i>=0){const fn=args[i];args[i]=function(req,res){const start=now(),given=req.headers['x-rc50-request'],id=typeof given==='string'&&/^[a-z0-9-]{1,80}$/.test(given)?given:'internal-'+(++sequence);const route=req.url.split('?')[0].replace(/\/[0-9a-f-]{20,}/gi,'/:id');return als.run({id},()=>{res.once('finish',()=>emit('http.server',start,{method:req.method,route,status:res.statusCode}));return fn.call(this,req,res);});};}return originalCreate.apply(this,args);};
 const originalFetch=global.fetch;global.fetch=async function(input,init){const start=now(),ctx=current();if(ctx){const headers=new Headers(init?.headers);headers.set('x-rc50-request',ctx.id);init={...init,headers};}try{return await originalFetch(input,init);}finally{emit('fetch.headers',start);}};
 const originalStringify=JSON.stringify;JSON.stringify=function(...args){const start=now();try{return originalStringify.apply(this,args);}finally{emit('json.stringify',start);}};
 const jwt=require(require.resolve('jsonwebtoken',{paths:[root]})),verify=jwt.verify;jwt.verify=function(...args){const start=now();try{return verify.apply(this,args);}finally{emit('jwt.verify',start);}};
 const pg=require(generated),OriginalClient=pg.PrismaClient;let monitorClient,monitorTimer;
 class Client extends OriginalClient{
  constructor(options){super({...options,log:[...(options?.log??[]),{emit:'event',level:'query'}]});
   this.$on('query',e=>emit('pg.engine.query',now()-e.duration,{engineMs:e.duration})); // Engine event lacks request context; never infer exact query correlation.
   this.$use(async(p,next)=>{const start=now();try{return await next(p);}finally{emit('prisma.operation',start,{model:p.model??'raw',action:p.action});}});
   const transaction=this.$transaction.bind(this);this.$transaction=(arg,...rest)=>{const start=now();if(typeof arg!=='function')return transaction(arg,...rest).finally(()=>emit('pg.transaction.total',start));
    return transaction(async tx=>{emit('pg.transaction.admission',start);const callbackStart=now();try{return await arg(tx);}finally{emit('pg.transaction.callback',callbackStart);}},...rest).finally(()=>emit('pg.transaction.total',start));};
  }
 }
 const realLoad=Module._load;Module._load=function(request,parent,isMain){return request==='@prisma/client'?{...pg,PrismaClient:Client}:realLoad.call(this,request,parent,isMain);};
 const authorityPath=require('node:path').join(root,'services/stocks-global/postgres-authority.mjs'),original=fs.readFileSync(authorityPath,'utf8'),hash=crypto.createHash('sha256').update(original).digest('hex');
 const authorityURL=require('node:url').pathToFileURL(authorityPath).href;let hits=0;
 const registration=Module.registerHooks({load(url,context,next){const r=next(url,context);if(url.endsWith('/services/stocks-global/postgres-authority.mjs')){let source=String(r.source);
  if(crypto.createHash('sha256').update(source).digest('hex')!==hash)throw Error('DIAGNOSTIC_AUTHORITY_SOURCE_CHANGED');
  const a='const entry={actor:actorCopy',b='detach(next);queue.active=true;';
  if(source.split(a).length!==2||source.split(b).length!==2)throw Error('DIAGNOSTIC_QUEUE_ANCHOR_MISMATCH');
  source=source.replace(a,'const entry={__diagnostic:globalThis.__rc50Spans.queued(type),actor:actorCopy').replace(b,'globalThis.__rc50Spans.dequeued(next.__diagnostic);'+b);hits++;return{...r,source};}return r;}});
 const delay=monitorEventLoopDelay({resolution:10});const gc=new PerformanceObserver(list=>{for(const e of list.getEntries())emit('gc',e.startTime,{durationMs:e.duration,kind:e.detail?.kind});});gc.observe({entryTypes:['gc']});let elu=performance.eventLoopUtilization(),cpu=process.cpuUsage(),start=0;
 return{
  async start(dbUrl){raw.length=0;dropped=0;start=now();delay.reset();delay.enable();elu=performance.eventLoopUtilization();cpu=process.cpuUsage();enabled=true;
   monitorClient=new OriginalClient({datasources:{db:{url:dbUrl.replace('connection_limit=8','connection_limit=1')}}});await monitorClient.$connect();
   let busy=false;monitorTimer=setInterval(async()=>{if(busy)return;busy=true;const at=now();try{const rows=await monitorClient.$queryRawUnsafe("SELECT wait_event_type AS type,wait_event AS event,count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state='active' GROUP BY wait_event_type,wait_event");emit('pg.wait.sample',at,{rows});}catch{emit('pg.wait.sample.error',at);}finally{busy=false;}},100);monitorTimer.unref();
  },
  async stop(){clearInterval(monitorTimer);await monitorClient?.$disconnect();enabled=false;delay.disable();return{raw,dropped,elapsedMs:now()-start,cpu:process.cpuUsage(cpu),eventLoop:performance.eventLoopUtilization(elu),delay:{meanMs:delay.mean/1e6,maxMs:delay.max/1e6,p95Ms:delay.percentile(95)/1e6,p99Ms:delay.percentile(99)/1e6},authoritySourceSha256:hash,queueTransformHits:hits,limitations:['Prisma operation includes engine/pool/transport; engine events have no guaranteed request correlation','transaction admission includes pool+BEGIN+callback scheduling, not pure pool wait','100ms pg activity samples can miss short waits; no lock absence proof','JSON/JWT durations are synchronous wall time; CPU/GC/ELU are process-wide'],pgSamplerPeriodMs:100};},
  metadata(){return{authoritySourceSha256:hash,queueTransformHits:hits};}
 };
}
module.exports={install};
