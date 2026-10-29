const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const R=path.resolve(__dirname,'..'),A=path.join(R,'api-source');const req=require('module').createRequire(path.join(A,'package.json'));
const url=process.env.COPY_SOCIAL_TEST_URL;if(!/^postgresql:\/\/postgres@127\.0\.0\.1:\d+\/voltex_copy_social_test$/.test(url||''))throw Error('Fixture only');
const previous=path.join(A,'node_modules/.prisma/client-previous');fs.cpSync(path.join(R,'baseline/api-installed/node_modules/.prisma/client'),previous,{recursive:true});
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(A,'node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node'))).digest('hex'),crypto.createHash('sha256').update(fs.readFileSync(path.join(previous,'libquery_engine-debian-openssl-3.0.x.so.node'))).digest('hex'),'Installed Linux Prisma engine unchanged');
const fresh=req('@prisma/client'),old=require(path.join(previous,'index.js'));
const models=JSON.parse(JSON.stringify(fresh.Prisma.dmmf.datamodel));const social=models.models.find(m=>m.name==='CopyStrategyOwner');social.fields=social.fields.filter(f=>!['xUrl','telegramUrl','socialOwnerUserId'].includes(f.name));assert.deepEqual(models,old.Prisma.dmmf.datamodel,'No other Prisma model change');
const db=new fresh.PrismaClient({datasources:{db:{url}}}),prior=new old.PrismaClient({datasources:{db:{url}}});
const express=req('express'),request=req('supertest');
async function main(){
 const owner=await db.copyStrategyOwner.findUniqueOrThrow({where:{traderId:'VX-001'}});assert(owner.ownerUserId);
 await db.copyStrategyOwner.update({where:{traderId:'VX-001'},data:{xUrl:'https://x.com/qa_owner',telegramUrl:'https://t.me/qa_telegram',socialOwnerUserId:owner.ownerUserId}});
 const snapshot=async()=>Promise.all(['Balance','DemoBalance','Order','Trade','CopyPerformanceScenario'].map(t=>db.$queryRawUnsafe(`SELECT * FROM "${t}" ORDER BY "id"`)));
 const before=await snapshot();const previousRuntime=path.join(R,'old-runtime');fs.cpSync(path.join(R,'baseline/api-installed/dist'),path.join(previousRuntime,'dist'),{recursive:true});if(!fs.existsSync(path.join(previousRuntime,'node_modules')))fs.symlinkSync(path.join(A,'node_modules'),path.join(previousRuntime,'node_modules'),'junction');
 const app=express();app.use(require(path.join(previousRuntime,'dist/api/routes/copyPerformance')).copyPerformanceRouter(prior));
 const result=await request(app).get('/copy-trading/identity/VX-001').expect(200);assert(!('xUrl' in result.body));assert(!('telegramUrl' in result.body));
 await request(app).get('/copy-trading/socials/VX-001').expect(404);
 const current=express();current.use(require(path.join(R,'runtime-candidate/dist/api/routes/copyPerformance')).copyPerformanceRouter(db));
 const now=await request(current).get('/copy-trading/identity/VX-001').expect(200);assert.equal(now.body.xUrl,'https://x.com/qa_owner');assert.equal(now.body.telegramUrl,'https://t.me/qa_telegram');
 assert.deepEqual(await snapshot(),before);assert.equal((await db.copyStrategyOwner.findUniqueOrThrow({where:{traderId:'VX-001'}})).xUrl,'https://x.com/qa_owner');
 fs.writeFileSync(path.join(R,'evidence/rollback-compatibility.json'),JSON.stringify({passed:true,oldInstalledApiReadsMigratedSchema:true,oldInstalledPrismaClientReadsMigratedSchema:true,newLinksRetained:true,oldApiDoesNotExposeNewLinks:true,financialFixtureUnchanged:true,allOtherPrismaModelsIdentical:true},null,2));
 await db.$disconnect();await prior.$disconnect();console.log('PASS: old installed API/client after migration; saved links retained; financial fixture unchanged; other Prisma models identical');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>Promise.all([db.$disconnect(),prior.$disconnect()]));
