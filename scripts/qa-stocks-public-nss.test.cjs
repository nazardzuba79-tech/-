'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {assertLinux,trustInventory,safeLaunch,inspectNss,verifyNssPackage,chromePackage,inspectChrome,retainChromePreflight,assertChromePath,CHROME}=require('./qa-stocks-public-nss.cjs');
test('NSS helper accepts Linux only; never invokes Windows certutil',()=>{
  assertLinux('linux');for(const platform of ['win32','darwin',undefined])assert.throws(()=>assertLinux(platform),/NSS_FIXTURE_REQUIRES_LINUX/);
  if(process.platform!=='linux')assert.throws(()=>inspectNss('/never/executed'),/NSS_FIXTURE_REQUIRES_LINUX/);
});
test('NSS inventory requires exactly the private server-CA entry',()=>{
  const header='Certificate Nickname                  Trust Attributes\n  SSL,S/MIME,JAR/XPI\n\n';
  trustInventory(header+'fixture       C,,\n','fixture');
  for(const value of ['fixture P,,','fixture C,,\nother C,,','fixture C,,\nunknown text','fixture ,,',''])assert.throws(()=>trustInventory(header+value,'fixture'));
});
test('owned browser launch rejects every certificate/security bypass spelling',()=>{
  safeLaunch(['chromium','--headless','--user-data-dir=/private/profile']);
  for(const option of ['--ignore-certificate-errors','--ignore-certificate-errors-spki-list=abc','--allow-insecure-localhost','--disable-web-security','--no-sandbox','--disable-setuid-sandbox','--disable-namespace-sandbox','--disable-seccomp-filter-sandbox','--disable-gpu-sandbox','--single-process'])assert.throws(()=>safeLaunch(['chromium',option]),/bypass prohibited/);
});
function trustedPath(){
  const row=path=>({path,status:'AVAILABLE',uid:0,mode:'755',symlink:false,regular:path===CHROME,directory:path!==CHROME,write:{allowed:false,code:'EACCES'},executeOrSearch:{allowed:true}});
  return {process:{uid:1001,euid:1001},file:row(CHROME),parents:['/opt/google/chrome','/opt/google','/opt','/'].map(row),binaryExecuted:false};
}
test('Chrome path requires actual unprivileged write denial on the executable and every ancestor',()=>{
  assertChromePath(trustedPath());
  for(const target of ['file',0,1,2,3])for(const delta of [{status:'UNKNOWN'},{uid:1001},{mode:'777'},{mode:'775'},{symlink:true},{write:{allowed:true}},{write:{allowed:false,code:'ENOENT'}},{executeOrSearch:{allowed:false}}]){
    const observed=trustedPath();Object.assign(target==='file'?observed.file:observed.parents[target],delta);let executed=0;
    assert.throws(()=>retainChromePreflight(observed,()=>{assertChromePath(observed);executed++;}));
    assert.equal(executed,0);assert.equal(observed.binaryExecuted,false);assert.equal(observed.status,'REJECTED');
  }
});
test('Chrome path rejects root identity, missing/reordered parents and path substitution',()=>{
  for(const mutate of [o=>o.process.uid=0,o=>o.process.euid=0,o=>o.parents.pop(),o=>o.parents.reverse(),o=>o.file.path='/tmp/chrome',o=>o.file.regular=false,o=>o.parents[0].directory=false]){
    const observed=trustedPath();mutate(observed);assert.throws(()=>assertChromePath(observed));
  }
});
const installed={requested:CHROME,resolved:CHROME,owner:'google-chrome-stable: '+CHROME,packageVersion:'123.0.4567.89-1',actualVersion:'Google Chrome 123.0.4567.89',uid:0,mode:0o100755,regular:true,symlink:false};
test('native Chrome ancestry uses the same actual-UID non-writability gate',()=>{
  const {EXECUTABLE,ancestors}=require('./stocks-browser-native/installation.cjs');
  const row=(path,file)=>({path,status:'AVAILABLE',uid:0,gid:0,mode:'755',regular:file,directory:!file,symlink:false,write:{allowed:false,code:'EACCES'},executeOrSearch:{allowed:true}});
  const observation={installationKind:'authenticated-extracted-google-deb-v1',process:{uid:1001,euid:1001},file:row(EXECUTABLE,true),parents:ancestors(EXECUTABLE).map(path=>row(path,false))};
  assertChromePath(observation);
  for(let index=0;index<observation.parents.length;index++){const changed=structuredClone(observation);changed.parents[index].write={allowed:true};assert.throws(()=>assertChromePath(changed));}
  for(const delta of [{process:{uid:0,euid:0}},{parents:observation.parents.slice(1)},{file:{...observation.file,path:CHROME}},{file:{...observation.file,symlink:true}}])assert.throws(()=>assertChromePath({...observation,...delta}));
  assert.throws(()=>chromePackage({...installed,requested:EXECUTABLE,resolved:EXECUTABLE}),'native path cannot claim legacy dpkg ownership');
});
test('installed Chrome requires exact path, package, root ownership and non-writable executable',()=>{
  assert.equal(chromePackage(installed),'123.0.4567.89');
  for(const delta of [{requested:'/tmp/chrome'},{resolved:'/tmp/chrome'},{owner:'chromium: '+CHROME},{uid:1001},{mode:0o100777},{mode:0o100644},{regular:false},{symlink:true}])assert.throws(()=>chromePackage({...installed,...delta}));
});
test('installed Chrome version must match package; no bundled or platform fallback',()=>{
  for(const delta of [{packageVersion:''},{packageVersion:'123.0.4567.89'},{actualVersion:'Chromium 123.0.4567.89'},{actualVersion:'Google Chrome 124.0.4567.89'},{actualVersion:'Google Chrome 123.0.4567.89\nextra'}])assert.throws(()=>chromePackage({...installed,...delta}));
  if(process.platform!=='linux')assert.throws(()=>inspectChrome(CHROME,{}),/NSS_FIXTURE_REQUIRES_LINUX/);
});
test('rejected Chrome identity retains bounded safe observations and the original error without executing it',()=>{
  const observation={status:'IN_PROGRESS',stage:'identity',binaryExecuted:false,file:{path:CHROME,uid:0,gid:0,mode:'775',bytes:100,write:{allowed:false,code:'EACCES'}},process:{uid:1001,gid:1001,groups:[1001]},parents:[{path:'/opt',uid:0,gid:0,mode:'755'}],packageOwner:installed.owner,packageVersion:installed.packageVersion};
  let executed=0,original;
  assert.throws(()=>retainChromePreflight(observation,()=>{
    try{chromePackage({...installed,mode:0o100775});}catch(error){original=error;throw error;}
    executed++;
  }),error=>{
    assert.equal(error,original);assert.match(error.message,/Chrome executable permissions/);assert.equal(error.chromePreflight,observation);return true;
  });
  assert.equal(executed,0);assert.equal(observation.binaryExecuted,false);assert.equal(observation.status,'REJECTED');assert.equal(observation.file.mode,'775');assert.equal(observation.file.write.allowed,false);assert.deepEqual(observation.process.groups,[1001]);assert.equal(observation.rejection.message,original.message);
  const valid={status:'IN_PROGRESS'};assert.equal(retainChromePreflight(valid,()=>42),42);assert.equal(valid.rejection,undefined);
});

const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{createHash}=require('node:crypto');
const digest=(algorithm,bytes)=>createHash(algorithm).update(bytes).digest('hex');
function nssPackageFixture(){
  const bytes=Buffer.from('isolated certutil package fixture\n');
  return {executable:'/usr/bin/certutil',bytes,
    fileList:'/.'+'\n/usr\n/usr/bin\n/usr/bin/certutil\n/usr/share/doc/libnss3-tools/copyright\n',
    versions:'libnss3\t2:3.98-1build1\tinstall ok installed\nlibnss3-tools\t2:3.98-1build1\tinstall ok installed\n',
    md5sums:digest('md5',bytes)+'  usr/bin/certutil\n'+digest('md5',Buffer.from('copyright'))+'  usr/share/doc/libnss3-tools/copyright\n'};
}

test('targeted NSS proof binds the actual executable bytes to exact installed package metadata',()=>{
  const fixture=nssPackageFixture(),proof=verifyNssPackage(fixture);
  assert.equal(proof.kind,'targeted-installed-package-integrity');assert.equal(proof.packageName,'libnss3-tools');
  assert.equal(proof.registeredPath,fixture.executable);assert.equal(proof.installedFileMd5,digest('md5',fixture.bytes));
  assert.equal(proof.executableSha256,digest('sha256',fixture.bytes));
  assert.deepEqual(proof.packages,['libnss3\t2:3.98-1build1','libnss3-tools\t2:3.98-1build1']);
  assert.match(proof.note,/not an exclusive-owner search or independent publisher signature/);
});

test('NSS metadata never trims a malformed final row into accepted evidence',()=>{
  const fixture=nssPackageFixture(),sum=digest('md5',fixture.bytes);
  for(const suffix of [' ','\t','\r','\n']){
    assert.throws(()=>verifyNssPackage({...fixture,fileList:'/.'+'\n/usr/bin/certutil'+suffix+'\n'}));
    assert.throws(()=>verifyNssPackage({...fixture,versions:fixture.versions.replace(/\n$/,'')+suffix+'\n'}));
    assert.throws(()=>verifyNssPackage({...fixture,md5sums:sum+'  usr/bin/certutil'+suffix+'\n'}));
  }
});

test('NSS package membership rejects missing, duplicate, substituted and diverted executable rows',()=>{
  const fixture=nssPackageFixture();
  const invalid=[fixture.fileList.replace('/usr/bin/certutil\n',''),fixture.fileList+'/usr/bin/certutil\n',
    fixture.fileList.replace('/usr/bin/certutil','/usr/bin/certutil-other'),
    ...['locally diverted to: /tmp/certutil','package diverts others to: /tmp/certutil','diverted by foreign-package to: /tmp/certutil',
      'unexpected metadata','/usr/bin/../bin/certutil','/usr/bin/certutil\r','/usr/bin/certutil\0'].map(row=>fixture.fileList+row+'\n')];
  for(const fileList of invalid)assert.throws(()=>verifyNssPackage({...fixture,fileList}),undefined,fileList);
  for(const executable of ['usr/bin/certutil','/usr/bin/../bin/certutil'])assert.throws(()=>verifyNssPackage({...fixture,executable}),/canonical Linux NSS path/);
});

test('NSS installed metadata requires both exact package names, versions and healthy installed status',()=>{
  const fixture=nssPackageFixture();
  for(const versions of [fixture.versions.split('\n')[0]+'\n',fixture.versions+fixture.versions.split('\n')[0]+'\n',
    fixture.versions.replace('libnss3-tools\t','other-tools\t'),fixture.versions.replace('libnss3-tools\t','libnss3\t'),
    fixture.versions.replace('2:3.98-1build1',''),fixture.versions.replace('2:3.98-1build1','3.98 injected'),
    fixture.versions.replace('install ok installed','deinstall ok config-files'),fixture.versions.replace('install ok installed','install reinstreq installed'),
    fixture.versions.replace('install ok installed','install ok unpacked'),fixture.versions.replace('install ok installed','install ok installed\textra')]){
    assert.throws(()=>verifyNssPackage({...fixture,versions}),undefined,versions);
  }
});

test('NSS checksum proof rejects missing, duplicate, malformed, unsafe paths and changed executable bytes',()=>{
  const fixture=nssPackageFixture(),sum=digest('md5',fixture.bytes);
  for(const md5sums of ['',fixture.md5sums.split('\n')[1]+'\n',fixture.md5sums+sum+'  usr/bin/certutil\n',
    fixture.md5sums.replace(sum,'0'.repeat(32)),fixture.md5sums.replace(sum,sum.toUpperCase()),
    fixture.md5sums.replace('  usr/bin/certutil',' usr/bin/certutil'),
    ...['/usr/bin/certutil','../usr/bin/certutil','usr/bin/../bin/certutil'].map(name=>fixture.md5sums.replace('usr/bin/certutil',name))]){
    assert.throws(()=>verifyNssPackage({...fixture,md5sums}),undefined,md5sums);
  }
  assert.throws(()=>verifyNssPackage({...fixture,bytes:Buffer.from('modified certutil')}),/differs from installed package/);
  for(const bytes of [Buffer.alloc(0),Buffer.alloc(8*1024*1024+1),'not bytes'])assert.throws(()=>verifyNssPackage({...fixture,bytes}),/bounded NSS executable bytes/);
  for(const field of ['fileList','versions','md5sums'])assert.throws(()=>verifyNssPackage({...fixture,[field]:'x'.repeat(128*1024+1)}),/bounded package metadata/);
});

// Execute the actual helper in a Linux-shaped VM with an entirely synthetic
// filesystem/process boundary. No Windows certutil, Linux binary or subprocess
// can be reached by these tests, including on a Linux CI host.
function isolatedNss(overrides={}){
  const fixture=nssPackageFixture(),calls=[],closed=[],profiles=[],opened=[];
  const fileBytes=new Map([[fixture.executable,fixture.bytes],['/usr/bin/dpkg-query',Buffer.from('isolated dpkg query fixture\n')]]);
  const descriptors=new Map(),statCalls=new Map();let nextFd=100;
  const plain=value=>JSON.parse(JSON.stringify(value));
  function stat(file,stage){
    const key=stage+':'+file,call=(statCalls.get(key)||0)+1;statCalls.set(key,call);
    const bytes=fileBytes.get(file),regular=Boolean(bytes);
    const result={dev:1,ino:regular?(file===fixture.executable?11:12):20,size:regular?bytes.length:0,
      uid:0,gid:0,mode:regular?0o100755:0o40755,mtimeMs:100,ctimeMs:100,
      isFile:()=>regular,isDirectory:()=>!regular,isSymbolicLink:()=>false};
    return overrides.stat?overrides.stat({file,stage,call},result):result;
  }
  const fakeFs={constants:{X_OK:1,O_RDONLY:0,O_NOFOLLOW:0x20000},
    realpathSync(file){return overrides.resolve?overrides.resolve(file):file;},
    lstatSync(file){assert.ok(fileBytes.has(file)||['/usr/bin','/usr','/'].includes(file),'unexpected filesystem path '+file);return stat(file,'lstat');},
    accessSync(file,mode){assert.equal(mode,1);if(overrides.denyExecute===file)throw Object.assign(Error('execution denied'),{code:'EACCES'});},
    openSync(file,flags){assert.equal(flags,0x20000,'actual helper must keep O_NOFOLLOW');assert.ok(fileBytes.has(file));const fd=nextFd++;descriptors.set(fd,{file,offset:0});opened.push(fd);return fd;},
    fstatSync(fd){return stat(descriptors.get(fd).file,'fstat');},
    readSync(fd,buffer,offset,length){const entry=descriptors.get(fd);let bytes=fileBytes.get(entry.file);if(overrides.readBytes)bytes=overrides.readBytes(entry.file,bytes);const count=Math.min(length,Math.max(0,bytes.length-entry.offset));bytes.copy(buffer,offset,entry.offset,entry.offset+count);entry.offset+=count;return count;},
    closeSync(fd){assert.ok(descriptors.has(fd));closed.push(fd);descriptors.delete(fd);},
    mkdtempSync(){profiles.push(true);throw Error('No NSS profile may be created by this fixture');}};
  function spawnSync(executable,args,options){
    calls.push({executable,args:plain(args),options:plain(options)});
    assert.equal(executable,'/usr/bin/dpkg-query','only synthetic package queries are allowed');
    const index=calls.length-1;if(overrides.result){const result=overrides.result(index,args);if(result)return result;}
    const stdout=args[0]==='-L'?fixture.fileList:args[0]==='-W'?fixture.versions:args[0]==='--control-show'?fixture.md5sums:null;
    assert.notEqual(stdout,null,'unreviewed package query');return {stdout,stderr:'',status:0,signal:null};
  }
  const module={exports:{}},source=fs.readFileSync(path.join(__dirname,'qa-stocks-public-nss.cjs'),'utf8');
  vm.runInNewContext(source,{module,exports:module.exports,Buffer,process:{platform:'linux'},performance:require('node:perf_hooks').performance,
    require(name){if(name==='node:fs')return fakeFs;if(name==='node:child_process')return {spawnSync};if(name==='node:path')return path.posix;
      if(name==='./stocks-browser-native/installation.cjs')return {};return require(name);}}, {filename:'isolated-qa-stocks-public-nss.cjs'});
  return {helper:module.exports,calls,closed,opened,profiles,fixture};
}

test('actual inspectNss performs three targeted bounded commands with a clean environment and recorded proof',()=>{
  const fixture=isolatedNss(),proof=fixture.helper.inspectNss('/usr/bin/certutil');
  assert.deepEqual(fixture.calls.map(c=>c.args),[['-L','libnss3-tools'],
    ['-W','--showformat=${Package}\t${Version}\t${Status}\n','libnss3-tools','libnss3'],['--control-show','libnss3-tools','md5sums']]);
  for(const call of fixture.calls){assert.equal(call.options.timeout,10000);assert.equal(call.options.maxBuffer,128*1024);assert.equal(call.options.encoding,'utf8');
    assert.deepEqual(call.options.env,{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'});assert.equal(call.options.shell,undefined);}
  assert.equal(proof.executable,'/usr/bin/certutil');assert.equal(proof.queryExecutable,'/usr/bin/dpkg-query');
  assert.equal(proof.querySha256,digest('sha256',Buffer.from('isolated dpkg query fixture\n')));
  assert.equal(proof.executableSha256,digest('sha256',fixture.fixture.bytes));assert.equal(proof.commands.length,3);
  for(const command of proof.commands){assert.equal(command.exitCode,0);assert.ok(Number.isFinite(command.elapsedMs)&&command.elapsedMs>=0);}
  assert.deepEqual(fixture.closed,fixture.opened);assert.equal(fixture.profiles.length,0);
});

test('actual inspectNss fails closed on every command timeout, overflow, signal or nonzero exit without retry/profile creation',()=>{
  const failures=[()=>({error:Object.assign(Error('timeout'),{code:'ETIMEDOUT'}),status:null,signal:'SIGTERM',stdout:'',stderr:''}),
    ()=>({error:Object.assign(Error('oversized output'),{code:'ENOBUFS'}),status:null,signal:'SIGTERM',stdout:'',stderr:''}),
    ()=>({status:null,signal:'SIGTERM',stdout:'',stderr:''}),()=>({status:2,signal:null,stdout:'',stderr:'query failed'})];
  for(let at=0;at<3;at++)for(const failure of failures){
    const fixture=isolatedNss({result(index){return index===at?failure():null;}});
    assert.throws(()=>fixture.helper.createNssHome({certutil:'/usr/bin/certutil',credentials:{}}),/NSS (subprocess|process signalled|command failed)/);
    assert.equal(fixture.calls.length,at+1);assert.equal(fixture.profiles.length,0);assert.deepEqual(fixture.closed,fixture.opened);
  }
});

test('actual inspectNss rejects untrusted executable and directory metadata before any package command',()=>{
  const mutations=[{uid:1001},{mode:0o100777},{size:0},{size:8*1024*1024+1},{isFile:()=>false},{isSymbolicLink:()=>true}];
  for(const file of ['/usr/bin/certutil','/usr/bin/dpkg-query'])for(const delta of mutations){
    const fixture=isolatedNss({stat(where,value){return where.file===file?{...value,...delta}:value;}});
    assert.throws(()=>fixture.helper.inspectNss('/usr/bin/certutil'));assert.equal(fixture.calls.length,0);assert.deepEqual(fixture.closed,fixture.opened);
  }
  for(const file of ['/usr/bin','/usr','/'])for(const delta of [{uid:1001},{mode:0o40775},{isDirectory:()=>false},{isSymbolicLink:()=>true}]){
    const fixture=isolatedNss({stat(where,value){return where.file===file?{...value,...delta}:value;}});
    assert.throws(()=>fixture.helper.inspectNss('/usr/bin/certutil'));assert.equal(fixture.calls.length,0);assert.deepEqual(fixture.closed,fixture.opened);
  }
  for(const file of ['/usr/bin/certutil','/usr/bin/dpkg-query']){
    const fixture=isolatedNss({resolve(value){return value===file?'/tmp/substituted-tool':value;}});
    assert.throws(()=>fixture.helper.inspectNss('/usr/bin/certutil'),/non-symlink NSS tool/);assert.equal(fixture.calls.length,0);
  }
  for(const args of [['certutil'],['/usr/bin/certutil','dpkg-query']])assert.throws(()=>isolatedNss().helper.inspectNss(...args),/explicit Linux tools required/);
  const denied=isolatedNss({denyExecute:'/usr/bin/certutil'});assert.throws(()=>denied.helper.inspectNss('/usr/bin/certutil'),/execution denied/);assert.equal(denied.calls.length,0);
});

test('actual trusted executable reader detects file or path mutation and always closes its descriptor',()=>{
  for(const stage of ['before','during','path'])for(const key of ['dev','ino','size','mode','uid','mtimeMs','ctimeMs']){
    const fixture=isolatedNss({stat(where,value){const changed=where.file==='/usr/bin/certutil'&&
      (stage==='before'&&where.stage==='fstat'&&where.call===1||stage==='during'&&where.stage==='fstat'&&where.call===2||stage==='path'&&where.stage==='lstat'&&where.call===2);
      return changed?{...value,[key]:value[key]+1}:value;}});
    assert.throws(()=>fixture.helper.inspectNss('/usr/bin/certutil'),/NSS tool (?:path )?changed/);
    assert.equal(fixture.calls.length,0);assert.deepEqual(fixture.closed,fixture.opened);assert.equal(fixture.opened.length,1);
  }
  for(const grow of [false,true]){
    const fixture=isolatedNss({readBytes(file,bytes){return file==='/usr/bin/certutil'?(grow?Buffer.concat([bytes,Buffer.from('x')]):bytes.subarray(0,bytes.length-1)):bytes;}});
    assert.throws(()=>fixture.helper.inspectNss('/usr/bin/certutil'),/changed size while hashing/);assert.equal(fixture.calls.length,0);assert.deepEqual(fixture.closed,fixture.opened);
  }
});
