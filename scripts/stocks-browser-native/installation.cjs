'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const manifest=require('./manifest.json'),{sha,signingProof,releaseProof,packageProof,bytesMatch}=require('./chain.cjs');
const EXECUTABLE=manifest.prefix+'/chrome/chrome',PROOF=manifest.prefix+'/installation.json';
function requested(env=process.env){const value=env[manifest.runtimeSelectionVariable];assert.ok(value===undefined||value===manifest.runtimeSelectionValue,'invalid native browser selection');return value===manifest.runtimeSelectionValue;}
function ancestors(file){const rows=[];let current=path.posix.dirname(file);for(;;){rows.push(current);if(current==='/')break;current=path.posix.dirname(current);}return rows;}
function protectedPath(file,{regular=true,actualIdentity=true}={}){
  assert.ok(path.isAbsolute(file));assert.equal(fs.realpathSync(file),file,'protected path must not resolve through a symlink');
  for(const item of [file,...ancestors(file)]){const st=fs.lstatSync(item);assert.ok(!st.isSymbolicLink());assert.equal(st.uid,0,'root-owned immutable installation path required');assert.equal(st.mode&0o022,0,'installation path must not be group/world writable');assert.ok(item===file?(regular?st.isFile():st.isDirectory()):st.isDirectory());
    if(item!==file||!regular)fs.accessSync(item,fs.constants.X_OK);
    if(actualIdentity){assert.ok(process.getuid()>0&&process.getuid()===process.geteuid());let denied=false;try{fs.accessSync(item,fs.constants.W_OK);}catch(error){assert.ok(['EACCES','EPERM','EROFS'].includes(error.code));denied=true;}assert.ok(denied,'installation path writable by QA identity');}}
}
function readProtected(file,maximum){protectedPath(file);const st=fs.lstatSync(file);assert.ok(st.size>0&&st.size<=maximum);return fs.readFileSync(file);}
function hashProtected(file,maximum=1024*1024*1024){protectedPath(file);const fd=fs.openSync(file,'r');try{const before=fs.fstatSync(fd);assert.ok(before.isFile()&&before.size<=maximum);const hash=crypto.createHash('sha256'),buffer=Buffer.alloc(128*1024);let count,total=0;while((count=fs.readSync(fd,buffer,0,buffer.length,null))>0){total+=count;assert.ok(total<=maximum);hash.update(buffer.subarray(0,count));}const after=fs.fstatSync(fd);assert.equal(before.ino,after.ino);assert.equal(before.mtimeMs,after.mtimeMs);assert.equal(total,before.size);return {sha256:hash.digest('hex'),bytes:total,mode:before.mode&0o7777};}finally{fs.closeSync(fd);}}
function canonicalRelative(value){assert.ok(typeof value==='string'&&value.length>0&&value.length<=1024&&!/[\\\0:]/.test(value)&&!value.startsWith('/')&&path.posix.normalize(value)===value&&!value.split('/').includes('..'),'canonical relative payload path required');return value;}
function validateProof(proof,sourceSha=process.env.QA_SOURCE_SHA){
  assert.match(sourceSha||'',/^[a-f0-9]{40}$/,'exact QA_SOURCE_SHA required');
  assert.equal(proof.schema,1);assert.equal(proof.status,'PASS_AUTHENTICATED_EXTRACTION');assert.equal(proof.prefix,manifest.prefix);assert.equal(proof.executable,EXECUTABLE);assert.deepEqual(proof.package,manifest.chrome);assert.equal(proof.playwrightVersion,manifest.playwrightVersion);assert.equal(proof.sourceSha,sourceSha);
  assert.equal(proof.manifestSha256,sha(fs.readFileSync(path.join(__dirname,'manifest.json'))));assert.match(proof.runId,/^\d+-\d+$/);
  assert.ok(Array.isArray(proof.files)&&proof.files.length>0&&proof.files.length<=20000);const seen=new Set();let total=0;
  for(const row of proof.files){canonicalRelative(row.path);assert.ok(row.path.startsWith('chrome/')||row.path.startsWith('playwright/'));assert.ok(!seen.has(row.path),'duplicate payload destination');seen.add(row.path);assert.match(row.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(row.bytes)&&row.bytes>=0&&row.bytes<=1024*1024*1024);total+=row.bytes;assert.ok(total<=3*1024*1024*1024);assert.ok([0o644,0o755].includes(row.mode));}
  for(const name of ['chrome/chrome','playwright/package.json','playwright/package-lock.json','playwright/node_modules/playwright/package.json','playwright/node_modules/playwright-core/package.json'])assert.ok(seen.has(name),'required payload absent');
  assert.ok(Array.isArray(proof.sourceFiles)&&proof.sourceFiles.length>0&&proof.sourceFiles.length<=100);const sourceSeen=new Set();for(const row of proof.sourceFiles){canonicalRelative(row.path);assert.ok(/^scripts\/(stocks-browser-native\/|qa-stocks-(public-nss|browser-launch|chrome-preflight)\.cjs$)/.test(row.path));assert.ok(!sourceSeen.has(row.path));sourceSeen.add(row.path);assert.match(row.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(row.bytes)&&row.bytes>0&&row.bytes<=4*1024*1024);}
  for(const required of ['scripts/stocks-browser-native/provision.py','scripts/stocks-browser-native/extract.py','scripts/stocks-browser-native/installation.cjs','scripts/qa-stocks-public-nss.cjs','scripts/qa-stocks-browser-launch.cjs','scripts/qa-stocks-chrome-preflight.cjs'])assert.ok(sourceSeen.has(required),'provisioner/admission source binding absent');
  assert.ok(Array.isArray(proof.dependencies)&&proof.dependencies.length>0&&proof.dependencies.length<=100);assert.equal(proof.npmArchives?.length,2);return proof;
}
function payloadPaths(directory){const rows=[];function visit(current){protectedPath(current,{regular:false});for(const name of fs.readdirSync(current)){const target=path.join(current,name),st=fs.lstatSync(target);assert.ok(!st.isSymbolicLink(),'extra payload symlink');if(st.isDirectory())visit(target);else{assert.ok(st.isFile()&&st.nlink===1,'payload hardlink/special file');rows.push(path.relative(manifest.prefix,target).split(path.sep).join('/'));assert.ok(rows.length<=20000);}}}visit(directory);return rows.sort();}
function validateClosure(actual,files){assert.deepEqual(actual.slice().sort(),files.map(row=>row.path).sort(),'installed payload closure differs from authenticated extraction inventory');}
function checkedCommand(executable,args,env){protectedPath(fs.realpathSync(executable));const result=spawnSync(executable,args,{env,encoding:'utf8',timeout:10000,maxBuffer:256*1024});assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,0,'native dependency command failed: '+(result.stderr||'').slice(0,1000));return result.stdout;}
function runtimeLibraries(proof,env){
  for(const row of proof.dependencies){assert.match(row.name,/^[a-z0-9][a-z0-9+.-]*$/);assert.equal(checkedCommand('/usr/bin/dpkg-query',['-W','-f=$'+'{db:Status-Status}\t$'+'{Version}',row.name],env).trim(),'installed\t'+row.version,'native dependency changed after provisioning');}
  // ldd traces this already authenticated ELF only after full package/payload admission.
  const output=checkedCommand('/usr/bin/ldd',[EXECUTABLE],env);assert.ok(!/not found/.test(output),'missing Chrome shared library');const libraries=[];
  for(const line of output.trim().split('\n')){if(/^\s*linux-vdso\.so\.\d+\s+\(0x[0-9a-f]+\)$/.test(line))continue;const match=/^\s*(?:\S+\s+=>\s+)?(\/\S+)\s+\(0x[0-9a-f]+\)\s*$/.exec(line);assert.ok(match,'unrecognized loader dependency output');const resolved=fs.realpathSync(match[1]);protectedPath(resolved);libraries.push({requested:match[1],resolved,...hashProtected(resolved)});}
  assert.ok(libraries.length>0&&libraries.length<=256);return libraries;
}
function verifyInstallation(env){assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');assert.ok(requested(),'native installation must be explicitly selected');
  const proof=validateProof(JSON.parse(readProtected(PROOF,4*1024*1024)));const meta=manifest.prefix+'/verification/';
  assert.deepEqual(proof.tools?.map(row=>row.requested),['/usr/bin/python3','/usr/bin/git','/usr/bin/gpg','/usr/bin/dpkg-deb','/usr/bin/dpkg-query','/usr/bin/dpkg']);
  for(const tool of proof.tools){assert.equal(fs.realpathSync(tool.requested),tool.resolved);assert.deepEqual(hashProtected(tool.resolved,64*1024*1024),{sha256:tool.sha256,bytes:tool.bytes,mode:tool.mode},'provisioner system tool changed');}
  bytesMatch(readProtected(meta+'manifest.json',65536),{bytes:fs.statSync(path.join(__dirname,'manifest.json')).size,sha256:proof.manifestSha256});
  const key=readProtected(meta+'google-key.asc',65536),releaseSigned=readProtected(meta+'InRelease',65536),packages=readProtected(meta+'Packages.gz',65536);bytesMatch(key,manifest.key);bytesMatch(releaseSigned,manifest.inRelease);bytesMatch(packages,manifest.packages);
  const signature=signingProof(readProtected(meta+'gpg-status.txt',65536).toString(),readProtected(meta+'key-listing.txt',65536).toString(),manifest,Date.now());
  const release=releaseProof(readProtected(meta+'Release',65536).toString(),manifest,Date.now());packageProof(packages,manifest);assert.deepEqual(signature,proof.signature);assert.equal(release.date,proof.release.date);
  const deb=hashProtected(meta+'google-chrome.deb');assert.equal(deb.sha256,manifest.chrome.sha256);assert.equal(deb.bytes,manifest.chrome.bytes);
  const lockBytes=readProtected(manifest.prefix+'/playwright/package-lock.json',65536);bytesMatch(lockBytes,manifest.playwrightLock);const lock=JSON.parse(lockBytes);
  for(const name of ['playwright','playwright-core']){const record=proof.npmArchives.find(row=>row.path==='verification/'+name+'.tgz');assert.ok(record);assert.equal(record.integrity,lock.packages['node_modules/'+name].integrity);const archive=readProtected(manifest.prefix+'/'+record.path,32*1024*1024);assert.equal('sha512-'+crypto.createHash('sha512').update(archive).digest('base64'),record.integrity);bytesMatch(archive,record);}
  for(const row of proof.sourceFiles){const raw=fs.readFileSync(path.join(__dirname,'../..',row.path));bytesMatch(raw,row);}
  validateClosure([...payloadPaths(manifest.prefix+'/chrome'),...payloadPaths(manifest.prefix+'/playwright')],proof.files);
  for(const row of proof.files){const actual=hashProtected(path.join(manifest.prefix,row.path));assert.deepEqual(actual,{sha256:row.sha256,bytes:row.bytes,mode:row.mode},'authenticated installed payload changed: '+row.path);}
  for(const name of ['playwright','playwright-core'])assert.equal(JSON.parse(readProtected(manifest.prefix+'/playwright/node_modules/'+name+'/package.json',65536)).version,manifest.playwrightVersion);
  const libraries=runtimeLibraries(proof,env||{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'});
  return {...proof,signature,release,libraries,kind:'authenticated-extracted-google-deb-v1'};
}
// Selection is not admission: inspectChrome still verifies the full installation.
function selectExecutable(env=process.env){return requested(env)?EXECUTABLE:'/opt/google/chrome/chrome';}
module.exports={manifest,EXECUTABLE,PROOF,requested,ancestors,protectedPath,hashProtected,canonicalRelative,validateProof,validateClosure,verifyInstallation,selectExecutable};
