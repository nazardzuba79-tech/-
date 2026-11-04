'use strict';
// CI-only Docker lifecycle. No SSH, production URLs, secrets or deployment commands.
const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('assert/strict');
const root=process.cwd(),out=path.resolve('output/history20-container-cycle'),candidate=path.resolve('output/history20-installed-candidate/candidate');
const m=JSON.parse(fs.readFileSync(candidate+'/manifest.json')),name='h20-qa-'+(process.env.GITHUB_RUN_ID||process.pid),db=name+'-pg';
const run=(args,options={})=>{const {includeStderr,...spawnOptions}=options;const r=cp.spawnSync('docker',args,{encoding:'utf8',maxBuffer:20*1024*1024,timeout:240000,...spawnOptions});if(r.status!==0)throw Error('docker '+args.slice(0,4).join(' ')+'\n'+r.stdout+'\n'+r.stderr);return r.stdout+(includeStderr?r.stderr:'');};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 run(['load','-i',out+'/base.tar.gz']);fs.unlinkSync(out+'/base.tar.gz');
 const image=JSON.parse(run(['image','inspect',m.installedImage]))[0];assert.equal(image.Id,m.installedImage);
 const forbidden=(image.Config.Env||[]).filter(v=>/^(DATABASE_URL|DIRECT_URL|JWT_SECRET|.*TOKEN|.*PASSWORD|.*API_KEY|.*SECRET)=.+/.test(v));
 assert.equal(forbidden.length,0,'Base image contains credential-like ENV entries; do not start it');
 const base=name+'-base:pinned';run(['tag',m.installedImage,base]);
 for(const kind of ['install','rollback']){
  const source=fs.readFileSync(candidate+'/'+(kind==='install'?'Dockerfile':'Dockerfile.rollback'),'utf8');assert(source.startsWith('FROM '+m.installedImage+'\n'));
  const dockerfile=out+'/Dockerfile.'+kind;fs.writeFileSync(dockerfile,source.replace('FROM '+m.installedImage,'FROM '+base));
  run(['build','--network=none','-f',dockerfile,'-t',name+'-'+kind+':tested',candidate]);
 }
 run(['network','create','--internal',name]);run(['volume','create',name+'-worker']);
 run(['run','-d','--name',db,'--network',name,'--tmpfs','/var/lib/postgresql:rw,size=1g','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:18.6']);
 for(let i=0;i<40;i++){const r=cp.spawnSync('docker',['exec',db,'pg_isready','-U','postgres'],{encoding:'utf8'});if(!r.status)break;if(i===39)throw Error('fixture PG timeout');await sleep(500);}
 for(const database of ['voltex_container_smoke','voltex_listing_test']){
  run(['exec',db,'createdb','-U','postgres',database]);
  for(const n of fs.readdirSync('prisma/migrations').sort()){const f=path.join('prisma/migrations',n,'migration.sql');if(fs.existsSync(f))run(['exec','-i',db,'psql','-X','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'],{input:fs.readFileSync(f,'utf8')});}
 }
 const common=['--rm','--network','container:'+db,'-v',root+':/qa/repo:ro','-v',candidate+':/qa/candidate:ro','-v',out+':/qa/report','-v',name+'-worker:/worker-state','--entrypoint','node'];
 for(const phase of ['baseline','install','rollback']){
  const imageTag=name+'-'+(phase==='install'?'install':'rollback')+':tested';
  console.log(run(['run',...common,'-e','DATABASE_URL=postgresql://postgres@127.0.0.1:5432/voltex_container_smoke',imageTag,'/qa/repo/scripts/ops/history20-container-phase.cjs',phase]));
  if(phase==='install'){
   const resolver=out+'/candidate-resolver.cjs';fs.writeFileSync(resolver,`const fs=require('fs');module.exports=(r,o)=>{const v=o.defaultResolver(r,o);if(v.startsWith('/qa/repo/src/')&&!v.includes('/__tests__/')&&v.endsWith('.ts')){const f='/app/dist/'+v.slice('/qa/repo/src/'.length).replace(/\\.ts$/,'.js');if(!fs.existsSync(f))throw Error('Missing installed module '+f);return f;}return v;};`);
   const url='postgresql://postgres@127.0.0.1:5432/voltex_listing_test';
   const tests=['src/services/listings/__tests__/history20SimusdtSettlement.pg.test.ts','src/services/listings/__tests__/history20PrivateSpot.pg.test.ts','src/services/listings/__tests__/history20ColdRegistryCashout.pg.test.ts','src/services/listings/__tests__/history20PrivateConfig.test.ts','src/services/__tests__/History20ReplayAdmission.test.ts'];
   const result=run(['run',...common,'-w','/qa/repo','-e','DATABASE_URL='+url,'-e','DIRECT_URL='+url,'-e','VOLTEX_LISTING_TEST_URL='+url,imageTag,'/qa/repo/node_modules/jest/bin/jest.js','--runInBand','--resolver','/qa/report/candidate-resolver.cjs','--runTestsByPath',...tests],{timeout:180000,includeStderr:true});
   fs.writeFileSync(out+'/container-pg.log',result);console.log(result);
  }
 }
 const receipt={baseImage:m.installedImage,installImage:JSON.parse(run(['image','inspect',name+'-install:tested']))[0].Id,rollbackImage:JSON.parse(run(['image','inspect',name+'-rollback:tested']))[0].Id,steps:['baseline','install','rollback'].map(p=>JSON.parse(fs.readFileSync(out+'/'+p+'.json'))),privateNetwork:true,productionTouched:false};
 fs.writeFileSync(out+'/cycle-receipt.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
})().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(()=>{
 for(const args of [['rm','-f',db],['volume','rm',name+'-worker'],['network','rm',name]])cp.spawnSync('docker',args,{stdio:'ignore'});
});
