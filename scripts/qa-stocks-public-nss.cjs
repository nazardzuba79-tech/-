// Linux-only private NSS trust for disposable QA. Never uses a system trust store.
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process'),{createHash,X509Certificate}=require('node:crypto');
const sha=b=>createHash('sha256').update(b).digest('hex');
const CHROME='/opt/google/chrome/chrome';
const native=require('./stocks-browser-native/installation.cjs');
const selectedChrome=()=>native.selectExecutable();
function assertLinux(platform){assert.equal(platform,'linux','NSS_FIXTURE_REQUIRES_LINUX');}
function chromeIdentity({requested,resolved,owner,uid,mode,regular,symlink,installation}){
  const expected=installation?native.EXECUTABLE:CHROME;
  assert.equal(requested,expected,'explicit installed Chrome path required');assert.equal(resolved,expected,'Chrome executable path changed');
  assert.ok(regular&&!symlink,'Chrome must be a regular non-symlink executable');assert.equal(uid,0,'Chrome executable must be root owned');
  assert.ok(Number.isInteger(mode)&&(mode&0o022)===0&&(mode&0o111)!==0,'Chrome executable permissions');
  if(installation){native.validateProof(installation);assert.equal(installation.kind,'authenticated-extracted-google-deb-v1');assert.equal(owner,'authenticated-google-deb: '+native.manifest.chrome.sha256);}
  else assert.equal(owner,'google-chrome-stable: '+CHROME,'installed Chrome package ownership');
}
function chromePackage(value){
  chromeIdentity(value);const {packageVersion,actualVersion}=value;
  assert.match(packageVersion,/^\d+\.\d+\.\d+\.\d+-\d+$/,'installed Chrome package version');
  const match=/^Google Chrome (\d+\.\d+\.\d+\.\d+)\s*$/.exec(actualVersion);assert.ok(match,'actual Google Chrome version required');
  assert.equal(match[1],packageVersion.replace(/-\d+$/,''),'actual Chrome must match installed package version');return match[1];
}
function fileHash(file,maxBytes){
  const fd=fs.openSync(file,'r');try{const before=fs.fstatSync(fd);assert.ok(before.isFile()&&before.size>0&&before.size<=maxBytes,'bounded Chrome proof file');
    const hash=createHash('sha256'),buffer=Buffer.alloc(128*1024);let total=0,count;
    while((count=fs.readSync(fd,buffer,0,buffer.length,null))>0){total+=count;assert.ok(total<=maxBytes);hash.update(buffer.subarray(0,count));}
    const after=fs.fstatSync(fd);assert.ok(total===before.size&&before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs,'proof file changed while hashing');return hash.digest('hex');
  }finally{fs.closeSync(fd);}
}
function retainChromePreflight(observation,check){
  try{return check();}catch(error){
    observation.status='REJECTED';observation.rejection={message:error.message,code:error.code||null};
    error.chromePreflight=observation;throw error;
  }
}
function accessObservation(file,mode){
  try{fs.accessSync(file,mode);return {allowed:true};}catch(error){return {allowed:false,code:error.code||'UNKNOWN'};}
}
function pathObservation(file){
  const row={path:file};
  try{const st=fs.lstatSync(file);Object.assign(row,{status:'AVAILABLE',uid:st.uid,gid:st.gid,mode:(st.mode&0o7777).toString(8),regular:st.isFile(),directory:st.isDirectory(),symlink:st.isSymbolicLink(),bytes:st.size,read:accessObservation(file,fs.constants.R_OK),write:accessObservation(file,fs.constants.W_OK),executeOrSearch:accessObservation(file,fs.constants.X_OK)});}
  catch(error){Object.assign(row,{status:'UNKNOWN',code:error.code||'UNKNOWN'});}
  return row;
}
function assertChromePath(observation){
  const {process:identity,file,parents}=observation;
  assert.ok(identity&&Number.isInteger(identity.uid)&&identity.uid>0&&identity.uid===identity.euid,'Chrome QA must run as a non-root identity');
  const expected=observation.installationKind==='authenticated-extracted-google-deb-v1'?native.EXECUTABLE:CHROME;
  assert.deepEqual(parents.map(row=>row.path),native.ancestors(expected),'complete Chrome ancestry required');
  assert.equal(file.path,expected);
  for(const row of [file,...parents]){
    assert.equal(row.status,'AVAILABLE','Chrome path observation unavailable');
    assert.equal(row.uid,0,'Chrome path must be root owned');assert.equal(row.symlink,false,'Chrome path symlink prohibited');
    assert.match(row.mode,/^[0-7]{3,4}$/);assert.equal(parseInt(row.mode,8)&0o022,0,'Chrome path must not be group/world writable');
    assert.equal(row.write?.allowed,false,'Chrome path is writable by the test identity');
    assert.ok(['EACCES','EPERM','EROFS'].includes(row.write?.code),'Chrome write denial must be explicit');
    assert.equal(row.executeOrSearch?.allowed,true,'Chrome path must be searchable/executable');
    assert.equal(row===file?row.regular:row.directory,true,'Chrome path type mismatch');
  }
}
function inspectChrome(executable,env){
  assertLinux(process.platform);assert.equal(executable,selectedChrome(),'explicit installed Chrome path required');
  const isNative=native.requested(),groups=process.getgroups(),observation={status:'IN_PROGRESS',stage:'filesystem',executable,installationKind:isNative?'authenticated-extracted-google-deb-v1':'dpkg-installed',installationPerformed:false,binaryExecuted:false,process:{uid:process.getuid(),euid:process.geteuid(),gid:process.getgid(),egid:process.getegid(),groups:groups.slice(0,128),groupsTruncated:groups.length>128},file:pathObservation(executable),parents:native.ancestors(executable).map(pathObservation)};
  return retainChromePreflight(observation,()=>{
  assertChromePath(observation); // Includes actual-UID denial and every parent, before any candidate execution.
  const resolved=fs.realpathSync(executable),st=fs.lstatSync(executable);observation.resolved=resolved;observation.executableBound={maximumBytes:1024*1024*1024,withinBound:st.size>0&&st.size<=1024*1024*1024};fs.accessSync(executable,fs.constants.X_OK);
  observation.stage='package';
  const dpkg='/usr/bin/dpkg-query',installation=isNative?native.verifyInstallation(env):undefined;
  const owner=isNative?'authenticated-google-deb: '+installation.package.sha256:command(dpkg,['-S',resolved],env).stdout.trim();
  observation.packageOwner=owner;
  const packageVersion=isNative?installation.package.version:command(dpkg,['-W','--showformat=$'+'{Version}','google-chrome-stable'],env).stdout.trim();
  observation.packageVersion=packageVersion;observation.stage='identity';
  const identity={requested:executable,resolved,owner,uid:st.uid,mode:st.mode,regular:st.isFile(),symlink:st.isSymbolicLink(),installation};
  chromeIdentity(identity);assert.match(packageVersion,/^\d+\.\d+\.\d+\.\d+-\d+$/); // Verify ownership before executing any candidate binary.
  observation.stage='hash';
  const executableHash=fileHash(executable,1024*1024*1024);
  observation.sha256=executableHash;observation.stage='version';observation.binaryExecuted=true;
  const versionCall=command(executable,['--version'],env),actualVersion=versionCall.stdout.trim();
  const version=chromePackage({...identity,packageVersion,actualVersion});
  const proof={executable,resolved,sha256:executableHash,bytes:st.size,uid:st.uid,gid:st.gid,mode:(st.mode&0o777).toString(8),owner,packageVersion,actualVersion,version,versionCommand:versionCall,installationPerformed:false,...(installation?{installation}: {})};
  const profile='/etc/apparmor.d/chrome';
  try{const p=fs.lstatSync(profile);assert.ok(p.isFile()&&!p.isSymbolicLink());
    const result=spawnSync(dpkg,['-S',profile],{env,encoding:'utf8',timeout:10000,maxBuffer:16384});
    proof.appArmorProfile={status:'AVAILABLE',path:profile,sha256:fileHash(profile,1024*1024),bytes:p.size,uid:p.uid,gid:p.gid,mode:(p.mode&0o777).toString(8),packageOwner:result.status===0?result.stdout.trim():null,packageOwnerStatus:result.status===0?'AVAILABLE':'UNKNOWN',packageQueryExitCode:result.status,packageQueryError:result.error?.code||null,modified:false};
  }catch(e){proof.appArmorProfile={status:'UNKNOWN',path:profile,reason:e.code||e.message,modified:false};}
  observation.status='VERIFIED';observation.stage='complete';proof.preflight=observation;return proof;
  });
}
function inspectBrowserProcess(child,chrome){
  assertLinux(process.platform);assert.equal(chrome.resolved,selectedChrome());assert.equal(child.spawnfile,chrome.resolved,'actual spawned executable must be explicit installed Chrome');assert.ok(Number.isSafeInteger(child.pid)&&child.pid>0);
  const base='/proc/'+child.pid,start=()=>{const text=fs.readFileSync(base+'/stat','utf8'),end=text.lastIndexOf(')');assert.ok(end>0);const value=text.slice(end+2).trim().split(/\s+/)[19];assert.match(value,/^\d+$/);return value;};
  const before=start(),actual=fs.realpathSync(base+'/exe');assert.equal(actual,chrome.resolved,'actual browser process executable mismatch');
  const stat=fs.statSync(base);assert.equal(stat.uid,process.getuid());let label;
  try{const value=fs.readFileSync(base+'/attr/current','utf8').trim();assert.ok(value.length>0&&value.length<=1024);label={status:'AVAILABLE',value};}catch(e){label={status:'UNKNOWN',reason:e.code||e.message};}
  assert.equal(start(),before,'browser process identity changed during inspection');
  return {pid:child.pid,startTimeTicks:before,spawnfile:child.spawnfile,actualExecutable:actual,uid:stat.uid,appArmorLabel:label,note:'Observed process label only; not an independent proof of all sandbox layers'};
}
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
  assert.ok(Array.isArray(argv));assert.ok(!argv.some(a=>/ignore-certificate-errors|allow-insecure-localhost|disable-web-security|--no-sandbox|--disable-setuid-sandbox|--disable-namespace-sandbox|--disable-seccomp-filter-sandbox|--disable-gpu-sandbox|--single-process/.test(a)),'browser certificate/security bypass prohibited');
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
module.exports={assertLinux,trustInventory,safeLaunch,createNssHome,inspectNss,chromePackage,inspectChrome,inspectBrowserProcess,retainChromePreflight,assertChromePath,CHROME,selectedChrome};
