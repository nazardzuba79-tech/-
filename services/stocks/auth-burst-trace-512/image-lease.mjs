// One reviewed local image archive only. No CLI, network, build, pull or import-time I/O.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const IMAGE_LEASE_BOUNDS=Object.freeze({archiveBytes:3*1024**3,chunkBytes:1024**2,
  hashMs:180000,inspectMs:10000,loadMs:180000,cleanupMs:30000,totalAcquireMs:390000,outputBytes:1024**2});
const HASH=/^[a-f0-9]{64}$/,IMAGE=/^sha256:[a-f0-9]{64}$/;
const safe=code=>Object.assign(Error(code),{code});
const check=(condition,code)=>{if(!condition)throw safe(code);};
const identity=stat=>Object.fromEntries(['dev','ino','size','mtimeNs','ctimeNs','mode'].map(key=>[key,String(stat[key])]));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const output=value=>{
  check(typeof value==='string'||Buffer.isBuffer(value),'IMAGE_COMMAND_OUTPUT_INVALID');
  check(Buffer.byteLength(value)<=IMAGE_LEASE_BOUNDS.outputBytes,'IMAGE_COMMAND_OUTPUT_BOUND');
  return Buffer.isBuffer(value)?value.toString('utf8'):value;
};

export function validateImageLeaseOptions({imageId,archivePath,archiveSha256,archiveBytes,sourceSha,execute,now}={}) {
  check(IMAGE.test(imageId||'')&&HASH.test(archiveSha256||'')&&/^[a-f0-9]{40}$/.test(sourceSha||''),'IMAGE_LEASE_BINDING_INVALID');
  check(typeof archivePath==='string'&&path.isAbsolute(archivePath)&&!archivePath.includes('\0')&&
    !/^(?:\\\\|\/\/|[a-z]+:\/\/)/i.test(archivePath)&&archivePath.length<=4096,'IMAGE_ARCHIVE_PATH_INVALID');
  check(Number.isSafeInteger(archiveBytes)&&archiveBytes>0&&archiveBytes<=IMAGE_LEASE_BOUNDS.archiveBytes,'IMAGE_ARCHIVE_SIZE_INVALID');
  check(typeof execute==='function'&&(now===undefined||typeof now==='function'),'IMAGE_LEASE_EXECUTOR_INVALID');
  return true;
}

// An immutable image ID remains the primary binding. This checks the known
// preparation contract; the adapter separately binds the exact context/config.
export function validateLeaseImage(value,{imageId,sourceSha}) {
  check(Array.isArray(value)&&value.length===1,'IMAGE_INSPECT_OUTPUT_INVALID');
  const info=value[0],config=info?.Config,labels=config?.Labels;
  check(info?.Id===imageId&&info.Os==='linux'&&info.Architecture==='amd64','IMAGE_IDENTITY_MISMATCH');
  check(config?.User==='10001:10001'&&config.WorkingDir==='/source'&&same(config.Entrypoint,['node'])&&
    same(config.Cmd,['-e',"throw new Error('REVIEW_ONLY_NO_DEFAULT_ENTRY')"]),'IMAGE_CONFIG_MISMATCH');
  check(labels&&same(Object.keys(labels).sort(),['org.opencontainers.image.revision','voltex.auth-http.context','voltex.auth-http.prepare'].sort())&&
    labels['org.opencontainers.image.revision']===sourceSha&&HASH.test(labels['voltex.auth-http.context']||'')&&
    new RegExp('^stocks-prepare-'+sourceSha.slice(0,12)+'-[1-9][0-9]*$').test(labels['voltex.auth-http.prepare']||''),'IMAGE_LABEL_MISMATCH');
  check(same([...(config.Env||[])].sort(),['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','NODE_VERSION=24.21.0','YARN_VERSION=1.22.22'].sort()),'IMAGE_ENVIRONMENT_MISMATCH');
  return {imageId:info.Id,sourceSha,contextSha256:labels['voltex.auth-http.context']};
}

function exactAbsent(error,imageId) {
  if(error?.status!==1||error.signal||error.code!==undefined)return false;
  const value=error.stderr;
  if(!(typeof value==='string'||Buffer.isBuffer(value))||Buffer.byteLength(value)>4096)return false;
  return value.toString().trim()===`Error response from daemon: No such image: ${imageId}`;
}

export async function acquireImageLease(options) {
  validateImageLeaseOptions(options);
  const {imageId,archiveSha256,archiveBytes,sourceSha,execute}=options,archivePath=path.resolve(options.archivePath);
  const rawNow=options.now||(()=>performance.now());let last=-Infinity;
  const now=()=>{const value=rawNow();check(Number.isFinite(value)&&value>=last,'IMAGE_LEASE_CLOCK_INVALID');last=value;return value;};
  const started=now(),deadline=started+IMAGE_LEASE_BOUNDS.totalAcquireMs;
  const evidence={schema:1,imageId,sourceSha,archive:{sha256:archiveSha256,bytes:archiveBytes,access:'read-only open; mode unchanged'},
    status:'VERIFYING',owned:false,pendingOwnership:false,commands:[],cleanup:null,
    limits:['Same-job owned artifact with fresh descriptor/stat/hash checks; no adversarial TOCTOU guarantee.','Existing images are never removed.','No pull, build, tag, push or broad image enumeration.']};
  let verified,owned=false,pending=false,released=false;
  const failCode=error=>/^IMAGE_[A-Z0-9_]+$/.test(error?.code||'')?error.code:error?.code==='ETIMEDOUT'?'IMAGE_COMMAND_TIMEOUT':'IMAGE_COMMAND_FAILED';
  async function statArchive() {
    const stat=await fs.lstat(archivePath,{bigint:true});
    check(stat.isFile()&&!stat.isSymbolicLink(),'IMAGE_ARCHIVE_NOT_REGULAR');
    check(await fs.realpath(archivePath)===archivePath,'IMAGE_ARCHIVE_SYMLINK_PARENT');
    check(stat.size===BigInt(archiveBytes),'IMAGE_ARCHIVE_SIZE_MISMATCH');
    return identity(stat);
  }
  async function unchanged() {check(same(await statArchive(),verified),'IMAGE_ARCHIVE_CHANGED');}
  async function command(args,cap,end) {
    const opStart=now(),remaining=Math.floor(Math.min(cap,end-opStart)),opEnd=opStart+remaining;check(remaining>0,'IMAGE_LEASE_DEADLINE');
    const row={operation:args.slice(0,2).join(' '),timeoutMs:remaining,status:'PENDING'};evidence.commands.push(row);
    check(evidence.commands.length<=12,'IMAGE_COMMAND_COUNT_BOUND');let timer;
    try{
      const value=await Promise.race([Promise.resolve().then(()=>execute('/usr/bin/docker',args,remaining)),new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(safe('IMAGE_COMMAND_TIMEOUT')),remaining);
      })]);
      check(now()<opEnd,'IMAGE_LEASE_DEADLINE');
      const text=output(value);row.status='SUCCESS';return text;
    }catch(error){row.status='FAILED';row.code=failCode(error);throw error;}finally{clearTimeout(timer);}
  }
  async function inspect(end) {
    let text;
    try{text=await command(['image','inspect',imageId],IMAGE_LEASE_BOUNDS.inspectMs,end);}
    catch(error){if(exactAbsent(error,imageId)){evidence.commands.at(-1).status='EXACT_ID_ABSENT';return null;}throw safe('IMAGE_INSPECT_UNKNOWN');}
    let parsed;try{parsed=JSON.parse(text);}catch{throw safe('IMAGE_INSPECT_OUTPUT_INVALID');}
    return validateLeaseImage(parsed,{imageId,sourceSha});
  }
  async function cleanup(containersClosed) {
    check(containersClosed===true,'IMAGE_CONTAINERS_NOT_CLOSED');
    check(!released,'IMAGE_LEASE_ALREADY_RELEASED');released=true;
    const result={status:'INCOMPLETE',owned:owned||pending,removed:false,preserved:false,errors:[]};
    evidence.cleanup=result;
    if(!owned&&!pending){result.status='PRESERVED';result.preserved=true;return result;}
    const end=now()+IMAGE_LEASE_BOUNDS.cleanupMs;
    try{
      const present=await inspect(end);
      if(!present){result.status='ABSENT';result.removed=true;pending=false;evidence.pendingOwnership=false;return result;}
      try{await command(['image','rm','--no-prune',imageId],IMAGE_LEASE_BOUNDS.inspectMs,end);}
      catch(error){result.errors.push(failCode(error));}
      const after=await inspect(end);
      if(after)result.errors.push('IMAGE_REMOVAL_NOT_CONFIRMED');else{result.removed=true;pending=false;evidence.pendingOwnership=false;}
      if(result.removed&&result.errors.length===0)result.status='REMOVED';
    }catch(error){result.errors.push(failCode(error));}
    return result;
  }
  try{
    verified=await statArchive();const handle=await fs.open(archivePath,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
    try{
      check(same(identity(await handle.stat({bigint:true})),verified),'IMAGE_ARCHIVE_CHANGED');
      const hash=createHash('sha256'),buffer=Buffer.alloc(IMAGE_LEASE_BOUNDS.chunkBytes),hashEnd=Math.min(deadline,now()+IMAGE_LEASE_BOUNDS.hashMs);let read=0;
      while(true){check(now()<hashEnd,'IMAGE_HASH_DEADLINE');const {bytesRead}=await handle.read(buffer,0,buffer.length,null);
        if(!bytesRead)break;read+=bytesRead;check(read<=archiveBytes,'IMAGE_ARCHIVE_SIZE_MISMATCH');hash.update(buffer.subarray(0,bytesRead));}
      check(now()<hashEnd,'IMAGE_HASH_DEADLINE');check(read===archiveBytes,'IMAGE_ARCHIVE_SIZE_MISMATCH');
      check(hash.digest('hex')===archiveSha256,'IMAGE_ARCHIVE_HASH_MISMATCH');
      check(same(identity(await handle.stat({bigint:true})),verified),'IMAGE_ARCHIVE_CHANGED');
    }finally{await handle.close();}
    await unchanged();evidence.archive.identity=verified;evidence.archive.verified=true;
    const existing=await inspect(deadline);
    if(existing){evidence.status='EXISTING_VERIFIED';evidence.image=existing;}
    else{
      await unchanged();pending=true;evidence.pendingOwnership=true;evidence.loadOwnershipRegistered=true;evidence.status='LOAD_PENDING';
      let loaded;try{loaded=await command(['image','load','--input',archivePath],IMAGE_LEASE_BOUNDS.loadMs,deadline);}
      finally{await unchanged();}
      check(loaded.trim()===`Loaded image ID: ${imageId}`,'IMAGE_LOAD_OUTPUT_INVALID');
      const info=await inspect(deadline);check(info!==null,'IMAGE_LOAD_NOT_CONFIRMED');
      owned=true;pending=false;evidence.owned=true;evidence.pendingOwnership=false;evidence.image=info;evidence.status='LOADED_VERIFIED';
    }
    return{imageId,owned,evidence,release:({containersClosed}={})=>cleanup(containersClosed)};
  }catch(error){
    const code=failCode(error)==='IMAGE_COMMAND_FAILED'&&evidence.status==='VERIFYING'?'IMAGE_ARCHIVE_READ_FAILED':failCode(error);evidence.status='INCOMPLETE';evidence.failure=code;
    // No adapter or container can have been started by this acquire function.
    if(pending&&!released)await cleanup(true);
    const failure=safe(code);failure.evidence=evidence;throw failure;
  }
}
