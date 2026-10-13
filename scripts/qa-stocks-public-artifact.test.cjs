'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {copyAuthority}=require('./qa-stocks-public-host.cjs');
const root=path.resolve(__dirname,'..');
test('downloaded immutable authority is verified without root dist; every provenance tamper fails before copy',()=>{
  const proofFile=process.env.QA_STOCKS_BUILD_PROOF;
  assert.ok(proofFile&&path.isAbsolute(proofFile),'explicit producer proof required');
  const stage=path.dirname(proofFile),originalPackage=path.join(stage,'package');
  const proof=JSON.parse(fs.readFileSync(proofFile)),manifest=JSON.parse(fs.readFileSync(path.join(originalPackage,'manifest.json')));
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'stocks-public-artifact-'));
  const source=path.join(temp,'source-without-dist'),artifact=path.join(temp,'downloaded'),pack=path.join(artifact,'package');
  function copy(from,to){fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);}
  try{
    for(const row of proof.sourcesBefore)copy(path.join(root,row.path),path.join(source,row.path));
    for(const name of ['tsconfig.json','package-lock.json'])copy(path.join(root,name),path.join(source,name));
    for(const row of proof.compilerFiles)copy(path.join(root,'node_modules/typescript',row.file),path.join(source,'node_modules/typescript',row.file));
    for(const row of manifest.files){
      copy(path.join(originalPackage,row.path),path.join(pack,row.path));
      if(!row.path.startsWith('dist/')&&!fs.existsSync(path.join(source,row.path)))copy(path.join(root,row.path),path.join(source,row.path));
    }
    copy(path.join(originalPackage,'manifest.json'),path.join(pack,'manifest.json'));
    const copiedProof=path.join(artifact,'build-provenance.json'),log=path.join(artifact,'build.log');
    copy(proofFile,copiedProof);copy(path.join(stage,'build.log'),log);
    assert.equal(fs.existsSync(path.join(source,'dist')),false,'source checkout has no compiled output');
    const result=copyAuthority(pack,path.join(temp,'copied-authority'),source);
    assert.equal(result.build.sourceCount,proof.sourcesBefore.length);
    assert.equal(result.build.proofSha256,manifest.buildProvenanceSha256);
    assert.deepEqual(Object.keys(result.build.compiled).sort(),manifest.files.filter(f=>f.path.startsWith('dist/')).map(f=>f.path).sort());
    assert.equal(fs.existsSync(path.join(source,'dist')),false,'verification never creates or requires root dist');
    const altered=[
      ['source',path.join(source,proof.sourcesBefore[0].path),b=>Buffer.concat([b,Buffer.from('\n// altered')])],
      ['compiler',path.join(source,'node_modules/typescript',proof.compilerFiles[0].file),b=>Buffer.concat([b,Buffer.from('\n')])],
      ['compiled',path.join(pack,'dist/api/middleware/auth.js'),b=>Buffer.concat([b,Buffer.from('\n// altered')])],
      ['log',log,b=>Buffer.concat([b,Buffer.from('\nmodified')])],
      ['failed-proof',copiedProof,b=>Buffer.from(JSON.stringify({...JSON.parse(b),exitCode:1}))],
      ['emitted-proof',copiedProof,b=>{const p=JSON.parse(b);p.outputs.find(row=>row.path==='dist/api/middleware/auth.js').sha256='0'.repeat(64);return Buffer.from(JSON.stringify(p));}],
      ['proof-binding',path.join(pack,'manifest.json'),b=>Buffer.from(JSON.stringify({...JSON.parse(b),buildProvenanceSha256:'0'.repeat(64)}))],
      ['omitted-emitted',path.join(pack,'manifest.json'),b=>{const m=JSON.parse(b);m.files=m.files.filter(f=>f.path!=='dist/api/asyncRoute.js');return Buffer.from(JSON.stringify(m));}],
    ];
    for(const [label,file,change]of altered){
      const original=fs.readFileSync(file),destination=path.join(temp,'reject-'+label);
      try{fs.writeFileSync(file,change(original));assert.throws(()=>copyAuthority(pack,destination,source),label);assert.equal(fs.existsSync(destination),false,label+' rejects before output admission');}
      finally{fs.writeFileSync(file,original);}
    }
    assert.equal(copyAuthority(pack,path.join(temp,'restored-valid-copy'),source).build.proofSha256,result.build.proofSha256);
  }finally{
    assert.equal(path.dirname(temp),path.resolve(os.tmpdir()));assert.ok(path.basename(temp).startsWith('stocks-public-artifact-'));
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
