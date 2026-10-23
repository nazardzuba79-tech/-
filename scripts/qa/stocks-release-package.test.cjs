const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {stage,verify,PENDING}=require('./stocks-release-package.cjs');
const {hash}=require('./stocks-migration-review.cjs');
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stocks-package-'));
  t.after(()=>{
    const resolved=fs.realpathSync(dir), parent=fs.realpathSync(os.tmpdir());
    if(path.dirname(resolved)!==parent||!path.basename(resolved).startsWith('stocks-package-'))throw Error('UNSAFE_CLEANUP');
    fs.rmSync(resolved,{recursive:true});
  });
  const snapshot=path.join(dir,'snapshot'),pending=path.join(dir,'pending');
  fs.mkdirSync(snapshot);fs.mkdirSync(pending);const migrations=[];
  for(let i=0;i<44;i++){
    const name=String(20260101000000+i)+'_synthetic_history',bytes=Buffer.from('-- synthetic CRLF fixture\r\nSELECT '+i+';\r\n');
    fs.mkdirSync(path.join(snapshot,name));fs.writeFileSync(path.join(snapshot,name,'migration.sql'),bytes);
    migrations.push({name,sha256:hash(bytes)});
  }
  for(const row of PENDING){
    fs.mkdirSync(path.join(pending,row.name));
    // Only pending SQL comes from Git objects, avoiding checkout EOL conversion.
    const bytes=cp.execFileSync('git',['show','HEAD:prisma/migrations/'+row.name+'/migration.sql'],{cwd:path.resolve(__dirname,'../..')});
    assert.equal(hash(bytes),row.sha256);fs.writeFileSync(path.join(pending,row.name,'migration.sql'),bytes);
  }
  const baselineFile=path.join(dir,'baseline.json');fs.writeFileSync(baselineFile,JSON.stringify({migrations}));
  return{snapshot,pending,baselineFile,output:path.join(dir,'package'),migrations};
}
test('44 historical CRLF files preserved byte-for-byte, only two pinned pending migrations added',t=>{
  const f=fixture(t),result=stage(f);
  assert.equal(result.status,'PASS_FILE_REVIEW_ONLY');assert.equal(result.sqlExecuted,false);
  assert.equal(result.releaseAuthorized,false);assert.equal(result.ledgerCompatibility,'NOT_ATTESTED');
  for(const row of f.migrations)assert.deepEqual(fs.readFileSync(path.join(f.snapshot,row.name,'migration.sql')),
    fs.readFileSync(path.join(f.output,'migrations',row.name,'migration.sql')));
  assert.throws(()=>stage(f),/EEXIST/);
  const file=path.join(f.output,'migrations',f.migrations[0].name,'migration.sql');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n'));
  assert.throws(()=>verify(f.output),/BYTES_MISMATCH/);
});
test('historical or pending tampering blocks before artifact creation',t=>{
  for(const kind of ['historical','pending']){
    const f=fixture(t),file=kind==='historical'?path.join(f.snapshot,f.migrations[0].name,'migration.sql'):path.join(f.pending,PENDING[0].name,'migration.sql');
    fs.appendFileSync(file,'-- changed\n');assert.throws(()=>stage(f),/BYTES_MISMATCH/);
    assert.equal(fs.existsSync(f.output),false);
  }
});
test('release Docker recipe pins Node22 and never invokes migration or seeding',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../services/stocks-global/Dockerfile.release'),'utf8');
  assert.equal((source.match(/FROM node:22\.23\.3-bookworm-slim/g)||[]).length,2);
  assert.doesNotMatch(source,/^\s*(?:RUN|CMD|ENTRYPOINT).*?(?:migrate|db push|seed|reset)/m);
  assert.match(source,/CMD \["node", "services\/stocks-global\/release-entrypoint.mjs"\]/);
  assert.match(source,/stocks-release-package\.cjs --verify/);
});
