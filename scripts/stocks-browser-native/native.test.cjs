'use strict';
// Pure source/fixture tests: no Chrome, container, provider or privileged operation.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {manifest,EXECUTABLE,BROWSERS_PATH,FFMPEG,browserCache,ffmpegDescriptor,ffmpegRevision,staticFfmpegElf,requested,selectExecutable,ancestors,canonicalRelative,validateProof,validateClosure}=require('./installation.cjs');
const {sha,signingProof,releaseProof}=require('./chain.cjs');
const sourceSha='a'.repeat(40),now=Date.parse('2026-10-15T10:00:00Z'),created=Math.floor(now/1000)-3600,primary=manifest.googlePrimaryFingerprint,sub='0123456789ABCDEF0123456789ABCDEF01234567';
const signature=`[GNUPG:] VALIDSIG ${sub} 2026-10-15 ${created} 0 4 0 1 8 01 ${primary}\n`;
const listing=`pub:-:4096:1:key:${created}:0:::::\nfpr:::::::::${primary}:\nsub:-:4096:1:sub:${created}:0:::::\nfpr:::::::::${sub}:\n`;
function fixture(){return {schema:1,status:'PASS_AUTHENTICATED_EXTRACTION',prefix:manifest.prefix,executable:EXECUTABLE,package:{...manifest.chrome},playwrightVersion:manifest.playwrightVersion,ffmpeg:structuredClone(manifest.ffmpeg),sourceSha,runId:'1-1',manifestSha256:sha(fs.readFileSync(path.join(__dirname,'manifest.json'))),files:[...['chrome/chrome','playwright/package.json','playwright/package-lock.json','playwright/node_modules/playwright/package.json','playwright/node_modules/playwright-core/package.json','playwright/node_modules/playwright-core/browsers.json'].map(path=>({path,sha256:'b'.repeat(64),bytes:10,mode:0o644})),...manifest.ffmpeg.files.map(row=>({path:manifest.ffmpeg.directory+'/'+row.path,sha256:row.sha256,bytes:row.bytes,mode:row.mode}))],sourceFiles:['scripts/stocks-browser-native/provision.py','scripts/stocks-browser-native/extract.py','scripts/stocks-browser-native/installation.cjs','scripts/qa-stocks-public-nss.cjs','scripts/qa-stocks-browser-launch.cjs','scripts/qa-stocks-chrome-preflight.cjs'].map(path=>({path,sha256:'c'.repeat(64),bytes:10})),dependencies:[{name:'libc6',version:'fixture-only'}],npmArchives:[{},{}]};}
test('native selection is explicit and fixed, with no arbitrary path or fallback',()=>{
  assert.equal(requested({}),false);assert.equal(selectExecutable({}),'/opt/google/chrome/chrome');assert.equal(selectExecutable({VOLTEX_STOCKS_NATIVE_BROWSER:'1'}),EXECUTABLE);
  for(const value of ['','0','true','/tmp/chrome'])assert.throws(()=>selectExecutable({VOLTEX_STOCKS_NATIVE_BROWSER:value}));
  assert.deepEqual(ancestors(EXECUTABLE),[manifest.prefix+'/chrome',manifest.prefix,'/usr/lib','/usr','/']);
  assert.ok(!manifest.prefix.startsWith('/opt/')&&!manifest.prefix.startsWith('/usr/share/'));
});
test('native proof requires exact source, package, path, manifest and complete mandatory payload',()=>{
  assert.equal(validateProof(fixture(),sourceSha).sourceSha,sourceSha);
  for(const update of [{sourceSha:'d'.repeat(40)},{prefix:'/tmp/chrome'},{executable:'/opt/google/chrome/chrome'},{manifestSha256:'0'.repeat(64)},{package:{...manifest.chrome,sha256:'0'.repeat(64)}},{playwrightVersion:'1.57.0'},{status:'PASS'},{sourceFiles:[]},{files:fixture().files.slice(1)}])assert.throws(()=>validateProof({...fixture(),...update},sourceSha));
  assert.throws(()=>validateProof(fixture(),''));
});
test('recording dependency uses the exact immutable cache, revision and complete pinned payload',()=>{
  assert.equal(browserCache({PLAYWRIGHT_BROWSERS_PATH:BROWSERS_PATH}),BROWSERS_PATH);assert.equal(FFMPEG,BROWSERS_PATH+'/ffmpeg-1011/ffmpeg-linux');
  for(const cache of [undefined,'0','/tmp/ms-playwright',BROWSERS_PATH+'/',BROWSERS_PATH+'/../browsers'])assert.throws(()=>browserCache({PLAYWRIGHT_BROWSERS_PATH:cache}));
  assert.equal(ffmpegDescriptor(manifest.ffmpeg).revision,'1011');assert.equal(ffmpegRevision({browsers:[{name:'ffmpeg',revision:'1011'}]}),'1011');
  for(const browsers of [[],[{name:'ffmpeg',revision:'1010'}],[{name:'ffmpeg',revision:'1011',revisionOverrides:{'ubuntu22.04-x64':'1012'}}],[{name:'ffmpeg',revision:'1011'},{name:'ffmpeg',revision:'1011'}]])assert.throws(()=>ffmpegRevision({browsers}));
  for(const mutate of [x=>x.ffmpeg.revision='1012',x=>x.files=x.files.filter(row=>!row.path.endsWith('/ffmpeg-linux')),x=>x.files.find(row=>row.path.endsWith('/ffmpeg-linux')).sha256='0'.repeat(64),x=>x.files.find(row=>row.path.endsWith('/ffmpeg-linux')).mode=0o644,x=>x.files.push({path:'browsers/unreviewed',sha256:'b'.repeat(64),bytes:1,mode:0o755})]){const value=fixture();mutate(value);assert.throws(()=>validateProof(value,sourceSha));}
  const elf=Buffer.alloc(120);Buffer.from('7f454c460201','hex').copy(elf);elf.writeUInt16LE(2,16);elf.writeUInt16LE(62,18);elf.writeBigUInt64LE(64n,32);elf.writeUInt16LE(56,54);elf.writeUInt16LE(1,56);elf.writeUInt32LE(1,64);assert.equal(staticFfmpegElf(elf).dynamicLoader,false);
  for(const type of [2,3]){const bad=Buffer.from(elf);bad.writeUInt32LE(type,64);assert.throws(()=>staticFfmpegElf(bad));}assert.throws(()=>staticFfmpegElf(elf.subarray(0,80)));
});
function webmFixture({codec='V_VP8',duration=400,width=320,height=180,doctype='webm',block=true}={}){
  const element=(id,body)=>{const hex=id.toString(16),key=Buffer.from(hex.length%2?'0'+hex:hex,'hex'),size=body.length<127?Buffer.from([0x80|body.length]):Buffer.from([0x40|(body.length>>8),body.length&255]);return Buffer.concat([key,size,body]);};
  const uint=value=>value<256?Buffer.from([value]):Buffer.from([value>>8,value&255]),d=Buffer.alloc(8);d.writeDoubleBE(duration);const frame=Buffer.from('0000009d012a4001b400','hex');frame.writeUInt16LE(width,6);frame.writeUInt16LE(height,8);
  const info=element(0x1549a966,element(0x4489,d)),video=element(0xe0,Buffer.concat([element(0xb0,uint(width)),element(0xba,uint(height))]));
  const track=element(0x1654ae6b,element(0xae,Buffer.concat([element(0xd7,uint(1)),element(0x83,uint(1)),element(0x86,Buffer.from(codec)),video])));
  const cluster=element(0x1f43b675,block?element(0xa3,Buffer.concat([Buffer.from('81000080','hex'),frame])):Buffer.alloc(0));
  return Buffer.concat([element(0x1a45dfa3,element(0x4282,Buffer.from(doctype))),element(0x18538067,Buffer.concat([info,track,cluster]))]);
}
test('video witness requires finalized WebM, VP8 track and actual bounded keyframe payload',()=>{
  const {inspectWebm}=require('./qualification.cjs'),valid=webmFixture();assert.equal(inspectWebm(valid).keyframes,1);
  for(const options of [{codec:'V_VP9'},{duration:0},{duration:NaN},{duration:60001},{width:321},{height:181},{doctype:'matroska'},{block:false}])assert.throws(()=>inspectWebm(webmFixture(options)));
  for(const bytes of [Buffer.alloc(0),valid.subarray(0,valid.length-1),Buffer.concat([valid,Buffer.from([0])]),Buffer.alloc(16*1024*1024+1)])assert.throws(()=>inspectWebm(bytes));
  const bad=Buffer.from(valid),marker=bad.indexOf(Buffer.from('9d012a','hex'));bad[marker]=0;assert.throws(()=>inspectWebm(bad));
  assert.equal(inspectWebm(webmFixture({duration:61000}),{maxDurationMs:1680000}).durationMs,61000);assert.throws(()=>inspectWebm(webmFixture({duration:1680001}),{maxDurationMs:1680000}));for(const maxDurationMs of [0,-1,NaN,Infinity,1680001,'1680000'])assert.throws(()=>inspectWebm(valid,{maxDurationMs}));
});
function transitionVideoHelper(){const source=fs.readFileSync(path.join(__dirname,'../qa-stocks-ui.cjs'),'utf8'),start=source.indexOf('async function finalizeTransitionVideo('),end=source.indexOf('\nasync function transitions(',start);assert.ok(start>=0&&end>start);const module={exports:{}};require('node:vm').runInNewContext(source.slice(start,end)+'\nmodule.exports=finalizeTransitionVideo;', {fs,path,assert,module,setTimeout,clearTimeout,process:{getuid:process.getuid?.bind(process)},require:name=>{if(name==='./stocks-browser-native/qualification.cjs')return require('./qualification.cjs');if(name==='node:crypto')return require(name);throw Error('unexpected fixture dependency');}});return module.exports;}
test('remote CDP video uses saveAs after finalization and validates the actual copied bytes',async()=>{
  const {saveFinalizedVideo}=require('./qualification.cjs'),saveTransition=transitionVideoHelper(),os=require('node:os');
  for(const kind of ['qualification','transition']){const output=fs.mkdtempSync(path.join(os.tmpdir(),'voltex-video-unit-')),directory=path.join(output,'video');if(kind==='qualification')fs.mkdirSync(directory);const events=[],bytes=webmFixture(kind==='transition'?{width:1280,height:720,duration:61000}:{});
    try{const video={path:()=>{throw Error('Video.path is unsupported over remote CDP');},saveAs:async file=>{assert.deepEqual(events,['close']);assert.ok(fs.lstatSync(directory).isDirectory());if(kind==='transition'&&typeof process.getuid==='function'){assert.equal(fs.lstatSync(directory).uid,process.getuid());assert.equal(fs.lstatSync(directory).mode&0o777,0o700);}events.push('save');fs.writeFileSync(file,bytes);}};let saved;
      if(kind==='transition')saved=await saveTransition({close:async()=>{assert.equal(fs.existsSync(directory),false);events.push('close');}},video,directory);else{events.push('close');saved=await saveFinalizedVideo(video,directory,output);}
      assert.deepEqual(events,['close','save']);assert.equal(saved.sha256,sha(bytes));assert.equal(saved.codec,'V_VP8');assert.equal(saved.keyframes,1);assert.equal(path.basename(saved.file||saved.path),kind==='transition'?'transitions.webm':'qualification.webm');
    }finally{assert.equal(path.resolve(path.dirname(output)),path.resolve(os.tmpdir()));assert.ok(path.basename(output).startsWith('voltex-video-unit-'));fs.rmSync(output,{recursive:true,force:true});}
  }
});
test('transition export accepts an existing owned recording directory and rejects a file or directory symlink',async()=>{
  const saveTransition=transitionVideoHelper(),os=require('node:os');
  for(const kind of ['existing-directory','file','symlink']){const output=fs.mkdtempSync(path.join(os.tmpdir(),'voltex-video-unit-')),directory=path.join(output,'video');let saves=0,closed=0;
    try{if(kind==='existing-directory'){fs.mkdirSync(directory,{mode:0o700});fs.writeFileSync(path.join(directory,'local-recording.webm'),'preserved');}else if(kind==='file')fs.writeFileSync(directory,'preserved');else{const target=path.join(output,'actual');fs.mkdirSync(target,{mode:0o700});fs.symlinkSync(target,directory,'junction');}const video={path:()=>{throw Error('unsupported');},saveAs:async file=>{saves++;fs.writeFileSync(file,webmFixture({width:1280,height:720}));}};const run=()=>saveTransition({close:async()=>closed++},video,directory);
      if(kind==='existing-directory'){await run();assert.equal(saves,1);assert.equal(fs.readFileSync(path.join(directory,'local-recording.webm'),'utf8'),'preserved');}else{await assert.rejects(run);assert.equal(saves,0);}assert.equal(closed,1);
    }finally{assert.equal(path.resolve(path.dirname(output)),path.resolve(os.tmpdir()));assert.ok(path.basename(output).startsWith('voltex-video-unit-'));fs.rmSync(output,{recursive:true,force:true});}
  }
});
test('remote video export rejects missing, empty, preexisting and failed artifacts',async()=>{
  const {saveFinalizedVideo}=require('./qualification.cjs'),saveTransition=transitionVideoHelper(),os=require('node:os');
  for(const kind of ['qualification','transition'])for(const failure of ['empty','absent','existing','save-failure']){const output=fs.mkdtempSync(path.join(os.tmpdir(),'voltex-video-unit-')),directory=path.join(output,'video');fs.mkdirSync(directory);let calls=0,closed=0;
    try{const file=path.join(directory,kind==='transition'?'transitions.webm':'qualification.webm');if(failure==='existing')fs.writeFileSync(file,'preserved');const video={path:()=>{throw Error('unsupported path must not be called');},saveAs:async destination=>{calls++;if(failure==='save-failure')throw Error('fixture export failure');if(failure==='empty')fs.writeFileSync(destination,Buffer.alloc(0));}};
      await assert.rejects(()=>kind==='transition'?saveTransition({close:async()=>closed++},video,directory):saveFinalizedVideo(video,directory,output));if(kind==='transition')assert.equal(closed,1);assert.equal(calls,failure==='existing'?0:1);if(failure==='existing')assert.equal(fs.readFileSync(file,'utf8'),'preserved');
    }finally{assert.equal(path.resolve(path.dirname(output)),path.resolve(os.tmpdir()));assert.ok(path.basename(output).startsWith('voltex-video-unit-'));fs.rmSync(output,{recursive:true,force:true});}
  }
});
test('recording failures close the owned context and retain cleanup failures without a browser',async()=>{
  const {videoSmoke,bounded}=require('./qualification.cjs'),os=require('node:os');
  for(const failCleanup of [false,true]){const output=fs.mkdtempSync(path.join(os.tmpdir(),'voltex-video-unit-'));let closed=0;
    try{const context={setDefaultTimeout(){},newPage:async()=>{throw Error('fixture page failure');},close:async()=>{closed++;if(failCleanup)throw Error('fixture cleanup failure');}};
      await assert.rejects(()=>videoSmoke({newContext:async()=>context},output),error=>error.message==='fixture page failure'&&(!failCleanup||error.videoCleanup==='fixture cleanup failure'));assert.equal(closed,1);
    }finally{assert.equal(path.resolve(path.dirname(output)),path.resolve(os.tmpdir()));assert.ok(path.basename(output).startsWith('voltex-video-unit-'));fs.rmSync(output,{recursive:true,force:true});}
  }
  await assert.rejects(()=>bounded(new Promise(()=>{}),5,'fixture'),/fixture deadline exceeded/);
});
test('canonical payload inventory rejects aliases, duplicates, omissions and unexpected executable files',()=>{
  for(const value of ['/a','a/../b','a//b','a/./b','a\\b','a:stream','a\0b',''])assert.throws(()=>canonicalRelative(value));
  const good=fixture();validateClosure(good.files.map(row=>row.path),good.files);
  assert.throws(()=>validateClosure([...good.files.map(row=>row.path),'chrome/unreviewed.so'],good.files));
  assert.throws(()=>validateClosure(good.files.slice(1).map(row=>row.path),good.files));
  assert.throws(()=>validateProof({...good,files:[...good.files,good.files[0]]},sourceSha));
  assert.throws(()=>validateProof({...good,files:good.files.map((row,index)=>index?row:{...row,mode:0o4755})},sourceSha));
});
test('pinned GPG proof rejects bad, expired, revoked, wrong signer and weak-digest records',()=>{
  assert.equal(signingProof(signature,listing,manifest,now).primary,primary);
  assert.throws(()=>signingProof(signature+'[GNUPG:]\n',listing,manifest,now));
  for(const bad of ['BADSIG','ERRSIG','NO_PUBKEY','EXPSIG','EXPKEYSIG','REVKEYSIG','KEYREVOKED','KEYEXPIRED','SIGEXPIRED','FAILURE','ERROR','NODATA'])assert.throws(()=>signingProof(signature+'[GNUPG:] '+bad+' bad\n',listing,manifest,now));
  assert.throws(()=>signingProof(signature.replace(primary,'A'.repeat(40)),listing,manifest,now));assert.throws(()=>signingProof(signature.replace(' 1 8 01',' 1 2 01'),listing,manifest,now));
  for(const invalid of ['r','e','d','i'])assert.throws(()=>signingProof(signature,listing.replace('sub:-:','sub:'+invalid+':'),manifest,now));
  assert.throws(()=>signingProof(signature,listing,manifest,now+manifest.metadataMaximumAgeMs));
});
function publicWitness(){
  const bytes=fs.readFileSync(path.join(__dirname,'fixtures/gpg-status-926291d6.json'));
  assert.equal(sha(bytes),'ab511cd860788f7e61acb234b2a0f4de9b5c633770e0ad346f9be85186353efe');
  const witness=JSON.parse(bytes);assert.equal(witness.complete,true);assert.deepEqual(witness.commandExitCodes,{decrypt:0,listKeys:0});
  for(const stream of Object.values(witness.streams)){assert.equal(Buffer.byteLength(stream.text),stream.bytes);assert.equal(sha(stream.text),stream.sha256);}
  return {status:witness.streams.status.text,keys:witness.streams.keyListing.text,at:witness.observedAtUnixMs};
}
test('actual public GPG witness accepts only expired unused subkey notices with a valid current signer',()=>{
  const value=publicWitness(),proof=signingProof(value.status,value.keys,manifest,value.at);
  assert.equal(proof.primary,primary);assert.equal(proof.signer,'0E225917414670F4442C250DFD533C07C264648F');
  const notices=value.status.match(/^\[GNUPG:\] KEYEXPIRED \d+$/gm);assert.equal(notices.length,15);assert.equal(new Set(notices).size,5);
  assert.deepEqual(signingProof(value.status.replace(/^\[GNUPG:\] KEYEXPIRED.*\n/gm,''),value.keys,manifest,value.at),proof);
  for(const bad of ['BADSIG','ERRSIG','NO_PUBKEY','EXPSIG','EXPKEYSIG','REVKEYSIG','KEYREVOKED','SIGEXPIRED','FAILURE','ERROR','NODATA'])assert.throws(()=>signingProof(value.status+'[GNUPG:] '+bad+' bad\n',value.keys,manifest,value.at),undefined,bad);
});
test('expired-subkey exception rejects malformed notices, ambiguous keys and unbound signature status',()=>{
  const base=publicWitness(),notice='[GNUPG:] KEYEXPIRED 1555048520',news='[GNUPG:] NEWSIG\n';
  const good=base.status.match(/^\[GNUPG:\] GOODSIG.*\n/m)[0],valid=base.status.match(/^\[GNUPG:\] VALIDSIG.*\n/m)[0];
  const expiredKey=base.keys.match(/^sub:e:.*1555048520.*\nfpr:.*\n/m)[0],expiredFingerprint='3B068FB4789ABE4AEFA3BB491397BC53640DB551';
  const changes=[
    x=>x.status+='[GNUPG:]\n',
    x=>x.status=x.status.replace(news,''),x=>x.status+=news,
    x=>x.status=notice+'\n'+x.status.replace(notice+'\n',''),
    x=>x.status=x.status.replace(good,''),x=>x.status+=good,
    x=>x.status=x.status.replace(good,good.replace('FD533C07C264648F','0000000000000000')),
    x=>x.status=x.status.replace(good,'').replace(valid,valid+good),
    x=>x.keys=x.keys.replace('sub:e:4096:1:1397BC53640DB551','sub:-:4096:1:1397BC53640DB551'),
    x=>x.keys=x.keys.replace('sub:e:4096:1:1397BC53640DB551','sub:r:4096:1:1397BC53640DB551'),
    x=>x.keys=x.keys.replace(expiredFingerprint,'bad'),
    x=>x.keys=x.keys.replace(expiredFingerprint,primary),
    x=>x.keys=x.keys.replace('fpr:::::::::'+expiredFingerprint+':','fpr:::::::::'+expiredFingerprint+':\nfpr:::::::::'+expiredFingerprint+':'),
    x=>x.keys+=expiredKey,
    x=>x.keys+=expiredKey.replace(expiredFingerprint,'A'.repeat(40)).replace('sub:e:','sub:-:'),
    x=>x.keys=expiredKey+x.keys.replace(expiredKey,''),
    x=>x.keys=x.keys.replace(':1460440520:1555048520:',':1555048521:1555048520:'),
    x=>x.keys=x.keys.replace(':1736268781:1830876781:',':1736268781:1555048520:'),
    x=>x.keys=x.keys.replace(':1460440275::',':1460440275:1555048520:'),
    x=>x.keys=x.keys.replace('sub:-:4096:1:FD533C07C264648F','sub:e:4096:1:FD533C07C264648F'),
    x=>x.status=x.status.replace(' 1 8 01 '+primary,' 1 2 01 '+primary),
    x=>x.at+=manifest.metadataMaximumAgeMs,
  ];
  for(const timestamp of ['', '0','-1','1.5','1e3','+1555048520','01555048520','1555048520 extra','9007199254740992','1'])changes.push(x=>x.status=x.status.replace(notice,'[GNUPG:] KEYEXPIRED '+timestamp));
  for(const timestamp of ['1.460440520e9','1460440520.0','1_460_440_520','+1460440520','01460440520','-1460440520','0',' 1460440520 ','9007199254741'])changes.push(x=>x.keys=x.keys.replace(':1460440520:1555048520:',':'+timestamp+':1555048520:'));
  for(const timestamp of ['1.555048520e9','1555048520.0','1_555_048_520','+1555048520','01555048520','-1555048520','0',' 1555048520 ','9007199254741'])changes.push(x=>x.keys=x.keys.replace(':1460440520:1555048520:',':1460440520:'+timestamp+':'));
  for(const change of changes){const value={...base};change(value);assert.throws(()=>signingProof(value.status,value.keys,manifest,value.at));}
});
test('signed Release age and exact Packages digest are not relaxed',()=>{
  const release=`Origin: Google LLC\nSuite: stable\nCodename: stable\nDate: Thu, 15 Oct 2026 09:00:00 GMT\nSHA256:\n ${manifest.packages.sha256} ${manifest.packages.bytes} ${manifest.packages.path}\n`;
  assert.equal(releaseProof(release,manifest,now).packagesBytes,manifest.packages.bytes);
  assert.throws(()=>releaseProof(release.replace(manifest.packages.sha256,'0'.repeat(64)),manifest,now));assert.throws(()=>releaseProof(release,manifest,now+manifest.metadataMaximumAgeMs));
});
test('a launcher rejection after attempt never claims that Chrome did not start or cleanup succeeded',()=>{
  const {beginLaunch,failureEvidence}=require('./qualification.cjs');const report={launchAttempted:false,browserLaunched:false,cleanup:{status:'NOT_CREATED'}};
  beginLaunch(report);failureEvidence(report,Error('renderer proof failed'));
  assert.equal(report.launchAttempted,true);assert.equal(report.browserLaunched,'UNCONFIRMED');assert.equal(report.cleanup.status,'UNCONFIRMED');assert.equal(report.status,'FAIL');
  const error=Error('renderer proof failed');error.serverCleanup='owned server close failed';error.browserCleanup='owned browser close failed';error.scratchCleanup='owned scratch cleanup failed';failureEvidence(report,error);assert.equal(report.cleanup.status,'FAIL');assert.deepEqual(report.cleanup.errors.map(row=>row.stage),['browserCleanup','serverCleanup','scratchCleanup']);
});
