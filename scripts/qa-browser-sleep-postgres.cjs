/** Disposable localhost only. Runs persistence/security regression; never reads a production URL. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const assert=require('node:assert/strict'),{once}=require('node:events'),{spawnSync}=require('node:child_process'),{createRequire}=require('node:module');
const qa=createRequire(path.resolve(process.env.BROWSER_SLEEP_QA_DEPS||'../admin-deletion-qa-deps/package.json'));
const out=path.resolve('output/browser-sleep-postgres');fs.mkdirSync(out,{recursive:true});
(async()=>{
  const probe=net.createServer().listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
  const bin=qa(process.platform==='win32'?'@embedded-postgres/windows-x64':'@embedded-postgres/linux-x64');
  const dir=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'voltex-sleep-qa-')),'data');
  const run=(file,args,stdio)=>spawnSync(file,args,{windowsHide:true,encoding:'utf8',stdio});
  const init=run(bin.initdb,['-D',dir,'-U','postgres','-A','trust','--encoding=UTF8','--locale=C']);assert.equal(init.status,0,init.stderr);
  const fd=fs.openSync(path.join(out,'pg-control.log'),'w');let start;
  try{start=run(bin.pg_ctl,['-D',dir,'-l',path.join(out,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'start','-w'],['ignore',fd,fd]);}finally{fs.closeSync(fd);}assert.equal(start.status,0);
  let client;
  try{
    client=new(qa('pg').Client)({host:'127.0.0.1',port,user:'postgres',database:'postgres'});await client.connect();await client.query('CREATE DATABASE voltex_native_egress_test');await client.end();
    client=new(qa('pg').Client)({host:'127.0.0.1',port,user:'postgres',database:'voltex_native_egress_test'});await client.connect();
    for(const d of fs.readdirSync('prisma/migrations').sort()){const f=path.join('prisma/migrations',d,'migration.sql');if(fs.existsSync(f))await client.query(fs.readFileSync(f,'utf8'));}
    const r=spawnSync(process.execPath,['node_modules/jest/bin/jest.js','--runInBand','--runTestsByPath',...['nativeLivePostgres','nativeLiveProjection','nativeLiveLimit','nativeTestAccounts'].map(f=>`src/private-trading/__tests__/${f}.test.ts`)],{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:20*1024*1024,env:{...process.env,NATIVE_EGRESS_TEST_DATABASE_URL:`postgresql://postgres@127.0.0.1:${port}/voltex_native_egress_test?connection_limit=8&sslmode=disable`}});
    fs.writeFileSync(path.join(out,'jest.log'),r.stdout+r.stderr);console.log((r.stdout+r.stderr).slice(-12000));assert.equal(r.status,0,'PostgreSQL regression failed; full diagnostics in output/browser-sleep-postgres/jest.log');
  }finally{await client?.end().catch(()=>{});const stop=run(bin.pg_ctl,['-D',dir,'stop','-m','fast','-w']);assert.equal(stop.status,0,stop.stderr);}
})().catch(e=>{console.error(e);process.exitCode=1;});
