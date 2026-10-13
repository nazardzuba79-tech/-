// Linux-only private NSS trust for disposable QA. Never uses a system trust store.
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process'),{createHash,X509Certificate}=require('node:crypto');
const sha=b=>createHash('sha256').update(b).digest('hex');
function assertLinux(platform){assert.equal(platform,'linux','NSS_FIXTURE_REQUIRES_LINUX');}
function ownedDirectory(dir){
  const st=fs.lstatSync(dir);assert.ok(st.isDirectory()&&!st.isSymbolicLink());assert.equal(st.uid,process.getuid());assert.equal(st.mode&0o777,0o700);
  return {path:dir,mode:'0700',uid:st.uid};
}
function command(executable,args,env){
  const result=spawnSync(executable,args,{env,encoding:'utf8',timeout:10000,maxBuffer:128*1024});
  assert.equal(result.error,undefined,'bounded NSS subprocess');assert.equal(result.signal,null,'NSS process signalled');
  assert.equal(result.status,0,'NSS command failed: '+(result.stderr||'').slice(0,1000));
  return {args,stdout:result.stdout,stderr:result.stderr,exitCode:result.status};
}
function inspectNss(certutil,dpkg='/usr/bin/dpkg-query'){
  assertLinux(process.platform);assert.ok(path.isAbsolute(certutil)&&path.isAbsolute(dpkg),'explicit Linux tools required');
  const executable=fs.realpathSync(certutil),st=fs.statSync(executable);assert.ok(st.isFile()&&st.size<=8*1024*1024);fs.accessSync(executable,fs.constants.X_OK);
  const env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'};
  const owner=command(dpkg,['-S',executable],env).stdout.trim();
  assert.equal(owner,'libnss3-tools: '+executable,'Linux NSS certutil must be package identified');
  const format='--showformat=$'+'{Package}\t$'+'{Version}\n';
  const versions=command(dpkg,['-W',format,'libnss3-tools','libnss3'],env).stdout.trim().split('\n');
  assert.equal(versions.length,2);for(const name of ['libnss3-tools','libnss3'])assert.ok(versions.some(s=>s.startsWith(name+'\t')&&s.length>name.length+1));
  return {executable,executableSha256:sha(fs.readFileSync(executable)),packageOwner:owner,packages:versions};
}
function trustInventory(text,nickname){
  const rows=text.split(/\r?\n/).map(s=>s.trim().replace(/\s+/g,' ')).filter(Boolean);
  assert.deepEqual(rows,['Certificate Nickname Trust Attributes','SSL,S/MIME,JAR/XPI',nickname+' C,,'],'only fixture CA is trusted in private NSS inventory');
}
function safeLaunch(argv){
  assert.ok(Array.isArray(argv));assert.ok(!argv.some(a=>/ignore-certificate-errors|allow-insecure-localhost|disable-web-security|--no-sandbox|--disable-setuid-sandbox/.test(a)),'browser certificate/security bypass prohibited');
}
function createNssHome({credentials,certutil,forbiddenRoots=[]}){
  const tool=inspectNss(certutil); // Fail before creating a profile if the platform/tool is unavailable.
  const temporary=fs.realpathSync(os.tmpdir()),home=fs.mkdtempSync(path.join(temporary,'voltex-stocks-nss-'));
  try{
  fs.chmodSync(home,0o700);
  for(const root of forbiddenRoots){const relative=path.relative(path.resolve(root),home);if(relative===''||(!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))){fs.rmSync(home,{recursive:true});throw Error('NSS_SCRATCH_MUST_NOT_BE_ARTIFACT');}}
  const marker=path.join(home,'owned-fixture.json'),caFile=path.join(home,'fixture-ca.pem');
  const dirs=['.pki','.pki/nssdb','config','data','cache','tmp','run'].map(p=>path.join(home,p));
  for(const d of dirs){fs.mkdirSync(d,{mode:0o700});ownedDirectory(d);}
  const database=path.join(home,'.pki/nssdb'),nickname='voltex-fixture-ca-'+sha(credentials.ca).slice(0,16),ca=new X509Certificate(credentials.ca);
  assert.equal(ca.ca,true);
  fs.writeFileSync(marker,JSON.stringify({home,owner:process.getuid(),fixture:true}),{flag:'wx',mode:0o600});
  fs.writeFileSync(caFile,credentials.ca,{flag:'wx',mode:0o600});
  const env={HOME:home,XDG_CONFIG_HOME:path.join(home,'config'),XDG_DATA_HOME:path.join(home,'data'),XDG_CACHE_HOME:path.join(home,'cache'),XDG_RUNTIME_DIR:path.join(home,'run'),TMPDIR:path.join(home,'tmp'),PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'};
  const commands=[];
  try{
    commands.push(command(tool.executable,['-N','--empty-password','-d','sql:'+database],env));
    commands.push(command(tool.executable,['-A','-d','sql:'+database,'-n',nickname,'-t','C,,','-i',caFile],env));
    const inventory=command(tool.executable,['-L','-d','sql:'+database],env);commands.push(inventory);
    trustInventory(inventory.stdout,nickname);
    const exported=command(tool.executable,['-L','-d','sql:'+database,'-n',nickname,'-a'],env);commands.push(exported);
    assert.equal(new X509Certificate(exported.stdout).fingerprint256,ca.fingerprint256);
    for(const file of fs.readdirSync(database)){
      const p=path.join(database,file),st=fs.lstatSync(p);assert.ok(st.isFile()&&!st.isSymbolicLink()&&st.uid===process.getuid());fs.chmodSync(p,0o600);
    }
  }catch(e){fs.rmSync(home,{recursive:true,force:true});throw e;}
  const databaseFiles=fs.readdirSync(database).map(file=>{const st=fs.lstatSync(path.join(database,file));return {name:file,mode:(st.mode&0o777).toString(8),uid:st.uid};});
  const proof={platform:process.platform,tool,home:ownedDirectory(home),directories:dirs.map(ownedDirectory),database,nickname,caFingerprint:ca.fingerprint256,trust:'C,,',commands,databaseFiles,globalTrustChanged:false,profile:null,privateKeyImported:false,
    databaseLocationReason:'Fresh private HOME/.pki/nssdb; Chromium documented compatibility location takes precedence, including M146+'};
  return {home,env,proof,
    verifyProfile(argv){
      safeLaunch(argv);
      const args=argv.filter(a=>a.startsWith('--user-data-dir='));assert.equal(args.length,1);const profile=path.resolve(args[0].slice('--user-data-dir='.length));
      assert.equal(path.dirname(profile),env.TMPDIR,'browser profile must stay inside owned private TMPDIR');
      proof.profile=ownedDirectory(profile);return proof.profile;
    },
    cleanup(){
      assert.equal(path.dirname(home),temporary);assert.ok(path.basename(home).startsWith('voltex-stocks-nss-'));ownedDirectory(home);
      const owner=JSON.parse(fs.readFileSync(marker));assert.equal(owner.home,home);assert.equal(owner.owner,process.getuid());
      fs.rmSync(home,{recursive:true,force:false});proof.cleaned=true;
    },
  };
  }catch(e){if(fs.existsSync(home))fs.rmSync(home,{recursive:true,force:false});throw e;}
}
module.exports={assertLinux,trustInventory,safeLaunch,createNssHome,inspectNss};
