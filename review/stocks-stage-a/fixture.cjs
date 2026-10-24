'use strict';
// Executed only in a newly created container on a new --internal Docker network.
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const cfg=JSON.parse(fs.readFileSync('/fixture/config.json','utf8'));
assert.equal(cfg.fixture,'stocks-stage-a-disposable');
assert.match(cfg.runId,/^\d+$/);
const url=new URL(cfg.url);assert.equal(url.hostname,'db');assert.equal(url.pathname,'/voltex_stage');
const {PrismaClient}=require('/app/node_modules/@prisma/client');
const db=new PrismaClient({datasources:{db:{url:cfg.url}}});
async function fingerprint(){
  // Every table except identity/session login metadata and the synthetic User row.
  const tables=await db.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('User','Session','AuditLog') ORDER BY tablename");
  const result={};for(const {tablename}of tables){assert.match(tablename,/^[A-Za-z0-9_]+$/);const rows=await db.$queryRawUnsafe(`SELECT md5(COALESCE(string_agg(row_to_json(t)::text, '' ORDER BY row_to_json(t)::text),'')) AS hash, COUNT(*)::int AS count FROM "${tablename}" t`);result[tablename]=rows[0];}return result;
}
async function main(){
  assert.equal((await db.$queryRawUnsafe('SELECT current_database() AS name'))[0].name,'voltex_stage');
  if(process.argv[2]==='setup'){
    assert.equal((await db.$queryRawUnsafe("SELECT COUNT(*)::int AS n FROM pg_tables WHERE schemaname='public'"))[0].n,0);
    await db.$disconnect();
    require('node:child_process').execFileSync(process.execPath,['/app/node_modules/prisma/build/index.js','db','push','--skip-generate','--schema','/app/prisma/schema.prisma'],{env:{...process.env,DATABASE_URL:cfg.url,DIRECT_URL:cfg.url},stdio:'pipe'});
    const passwordHash=await require('/app/node_modules/bcrypt').hash(cfg.password,10);
    for(const id of cfg.users){await db.user.create({data:{id,email:id+'@example.invalid',passwordHash,referralCode:crypto.randomBytes(10).toString('hex'),role:'USER',country:'US'}});await db.demoBalance.create({data:{userId:id,asset:'USDT',available:'0',locked:'0'}});}
    const tables=await db.$queryRawUnsafe(`SELECT to_regclass('public."StocksTestAccount"')::text AS a,to_regclass('public."StocksTestReceipt"')::text AS r,to_regclass('public."StocksTestAudit"')::text AS u`);assert.deepEqual(tables[0],{a:null,r:null,u:null});
  }
  if(process.argv[2]==='revoke')await db.session.updateMany({where:{userId:cfg.users[0],revokedAt:null},data:{revokedAt:new Date()}});
  assert.equal(await db.auditLog.count({where:{action:{not:'SESSION_REVOKED'}}}),0,'no financial or unrelated audit writes');
  const {PERFORMANCE_SCENARIOS}=require('/app/dist/services/copyTrading/CopyPerformanceService.js');
  const expectedIds=Object.values(PERFORMANCE_SCENARIOS).flatMap(({id})=>[id,id+':marketplace']).sort();
  const actualIds=(await db.copyPerformanceScenario.findMany({select:{id:true},orderBy:{id:'asc'}})).map(r=>r.id);
  console.log(JSON.stringify({fingerprint:await fingerprint(),expectedCopyScenarioIds:JSON.stringify(actualIds)===JSON.stringify(expectedIds),pg:(await db.$queryRawUnsafe('SELECT version() AS v'))[0].v,connections:(await db.$queryRawUnsafe('SELECT COUNT(*)::int AS n FROM pg_stat_activity'))[0].n}));
}
main().catch(e=>{
  let error=JSON.stringify({code:e.code,message:e.message,meta:e.meta,stack:e.stack});
  for(const secret of [cfg.url,cfg.password,encodeURIComponent(cfg.password)])error=error.split(secret).join('[fixture-secret-redacted]');
  console.error(error.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi,'[fixture-pg-url-redacted]'));process.exitCode=1;
}).finally(()=>db.$disconnect());
