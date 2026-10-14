import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { acquireImageLease,validateImageLeaseOptions,IMAGE_LEASE_BOUNDS } from './image-lease.mjs';

const imageId='sha256:'+'a'.repeat(64),sourceSha='b'.repeat(40),sha=b=>createHash('sha256').update(b).digest('hex');
const image=()=>({Id:imageId,Os:'linux',Architecture:'amd64',Config:{User:'10001:10001',WorkingDir:'/source',Entrypoint:['node'],
  Cmd:['-e',"throw new Error('REVIEW_ONLY_NO_DEFAULT_ENTRY')"],Env:['NODE_VERSION=24.21.0','YARN_VERSION=1.22.22','PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'],
  Labels:{'org.opencontainers.image.revision':sourceSha,'voltex.auth-http.context':'c'.repeat(64),'voltex.auth-http.prepare':'stocks-prepare-'+sourceSha.slice(0,12)+'-123'}}});
const absent=()=>Object.assign(Error('not exposed'),{status:1,signal:null,stderr:`Error response from daemon: No such image: ${imageId}\n`});
async function archive(fn){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'stocks-image-lease-pure-'));
  try{const archivePath=path.join(root,'owned-image.tar'),bytes=Buffer.from('not an actual image; pure executor fixture only');await fs.writeFile(archivePath,bytes,{mode:0o600});
    return await fn({imageId,sourceSha,archivePath,archiveBytes:bytes.length,archiveSha256:sha(bytes)},root);
  }finally{assert.ok(path.dirname(root)===os.tmpdir()&&path.basename(root).startsWith('stocks-image-lease-pure-'));await fs.rm(root,{recursive:true,force:true});}
}
function executor({present=false,inspectError,load,remove,clock}={}){
  const state={present,info:image(),calls:[]};
  state.execute=async(binary,args,timeoutMs)=>{
    assert.equal(binary,'/usr/bin/docker');assert.ok(Number.isInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=IMAGE_LEASE_BOUNDS.loadMs);state.calls.push([...args]);
    if(args[1]==='inspect'){assert.deepEqual(args,['image','inspect',imageId]);if(state.inspectError||inspectError)throw state.inspectError||inspectError;if(!state.present)throw absent();return JSON.stringify([state.info]);}
    if(args[1]==='load'){assert.equal(args[2],'--input');state.present=true;if(load)return await load(state,args,timeoutMs);return `Loaded image ID: ${imageId}\n`;}
    if(args[1]==='rm'){assert.deepEqual(args,['image','rm','--no-prune',imageId]);if(remove)return await remove(state);state.present=false;return 'Deleted: '+imageId;}
    assert.fail('No broad image listing, pull, build, tag, push or other Docker operation');
  };
  return state;
}
const code=name=>error=>{assert.equal(error.code,name);assert.equal(error.message,name);return true;};

test('new verified local image is loaded once and removed only after explicit closed-container proof',()=>archive(async opts=>{
  const fake=executor(),lease=await acquireImageLease({...opts,execute:fake.execute});assert.equal(lease.owned,true);assert.equal(lease.evidence.status,'LOADED_VERIFIED');
  assert.equal(lease.evidence.loadOwnershipRegistered,true);assert.equal(lease.evidence.archive.verified,true);
  await assert.rejects(lease.release({containersClosed:false}),code('IMAGE_CONTAINERS_NOT_CLOSED'));assert.equal(fake.calls.some(a=>a[1]==='rm'),false);
  const result=await lease.release({containersClosed:true});assert.deepEqual(result,{status:'REMOVED',owned:true,removed:true,preserved:false,errors:[]});assert.equal(fake.present,false);
  assert.equal(fake.calls.filter(a=>a[1]==='load').length,1);assert.equal(fake.calls.filter(a=>a[1]==='rm').length,1);
  await assert.rejects(lease.release({containersClosed:true}),code('IMAGE_LEASE_ALREADY_RELEASED'));
}));

test('compatible prior image is verified and preserved without load or delete',()=>archive(async opts=>{
  const fake=executor({present:true}),lease=await acquireImageLease({...opts,execute:fake.execute});assert.equal(lease.owned,false);
  const result=await lease.release({containersClosed:true});assert.equal(result.status,'PRESERVED');assert.equal(result.preserved,true);assert.equal(result.removed,false);
  assert.deepEqual(fake.calls,[['image','inspect',imageId]]);assert.equal(fake.present,true);
}));

test('load timeout after daemon creation reconciles exact ID and removes only newly owned image',()=>archive(async opts=>{
  const fake=executor({load:()=>{throw Object.assign(Error('private raw output not exposed'),{code:'ETIMEDOUT',status:null,signal:'SIGTERM',stderr:'private'});}});
  await assert.rejects(acquireImageLease({...opts,execute:fake.execute}),error=>{code('IMAGE_COMMAND_TIMEOUT')(error);assert.equal(error.evidence.status,'INCOMPLETE');assert.equal(error.evidence.loadOwnershipRegistered,true);assert.equal(error.evidence.cleanup.removed,true);assert.equal(error.evidence.pendingOwnership,false);assert.equal(JSON.stringify(error.evidence).includes('private raw'),false);return true;});
  assert.equal(fake.present,false);assert.equal(fake.calls.filter(a=>a[1]==='load').length,1);assert.equal(fake.calls.filter(a=>a[1]==='rm').length,1);
}));

test('malformed load output never becomes success even if expected image appeared',()=>archive(async opts=>{
  const fake=executor({load:()=> 'Loaded unexpected tag or private output'});
  await assert.rejects(acquireImageLease({...opts,execute:fake.execute}),error=>{code('IMAGE_LOAD_OUTPUT_INVALID')(error);assert.equal(error.evidence.cleanup.removed,true);return true;});assert.equal(fake.present,false);
}));

test('permission or transport inspection failure never means absent and cannot load/delete',()=>archive(async opts=>{
  for(const inspectError of [Object.assign(Error('permission'),{status:1,stderr:'permission denied'}),Object.assign(absent(),{code:'ETIMEDOUT',signal:'SIGTERM'}),Object.assign(absent(),{stderr:`permission denied\nError response from daemon: No such image: ${imageId}`})]){
    const fake=executor({inspectError});await assert.rejects(acquireImageLease({...opts,execute:fake.execute}),code('IMAGE_INSPECT_UNKNOWN'));assert.equal(fake.calls.length,1);
  }
}));

test('foreign prior labels and malformed inspect output are preserved and fail closed',()=>archive(async opts=>{
  const fake=executor({present:true});fake.info.Config.Labels['org.opencontainers.image.revision']='d'.repeat(40);
  await assert.rejects(acquireImageLease({...opts,execute:fake.execute}),code('IMAGE_LABEL_MISMATCH'));assert.equal(fake.calls.length,1);assert.equal(fake.present,true);
  let calls=0;await assert.rejects(acquireImageLease({...opts,execute:async()=>{calls++;return 'not json';}}),code('IMAGE_INSPECT_OUTPUT_INVALID'));assert.equal(calls,1);
}));

test('foreign labels after unknown load preserve image and report incomplete cleanup',()=>archive(async opts=>{
  const fake=executor({load:state=>{state.info.Config.Labels['org.opencontainers.image.revision']='d'.repeat(40);throw Object.assign(Error('late timeout'),{code:'ETIMEDOUT'});}});
  await assert.rejects(acquireImageLease({...opts,execute:fake.execute}),error=>{code('IMAGE_COMMAND_TIMEOUT')(error);assert.equal(error.evidence.cleanup.status,'INCOMPLETE');assert.deepEqual(error.evidence.cleanup.errors,['IMAGE_LABEL_MISMATCH']);return true;});
  assert.equal(fake.present,true);assert.equal(fake.calls.some(a=>a[1]==='rm'),false);
}));

test('archive digest, size and local regular path checks happen before Docker',()=>archive(async(opts,root)=>{
  let calls=0;const execute=()=>{calls++;assert.fail('must not invoke Docker');};
  await assert.rejects(acquireImageLease({...opts,archiveSha256:'d'.repeat(64),execute}),code('IMAGE_ARCHIVE_HASH_MISMATCH'));
  await assert.rejects(acquireImageLease({...opts,archiveBytes:opts.archiveBytes+1,execute}),code('IMAGE_ARCHIVE_SIZE_MISMATCH'));
  await assert.rejects(acquireImageLease({...opts,archivePath:root,execute}),code('IMAGE_ARCHIVE_NOT_REGULAR'));
  for(const archivePath of ['https://example.invalid/image.tar','//server/share/image.tar','\\\\server\\share\\image.tar'])assert.throws(()=>validateImageLeaseOptions({...opts,archivePath,execute}),code('IMAGE_ARCHIVE_PATH_INVALID'));
  assert.throws(()=>validateImageLeaseOptions({...opts,archiveBytes:IMAGE_LEASE_BOUNDS.archiveBytes+1,execute}),code('IMAGE_ARCHIVE_SIZE_INVALID'));assert.equal(calls,0);
}));

test('same-length archive change with changed timestamp is detected and owned image cleaned',()=>archive(async opts=>{
  const before=await fs.stat(opts.archivePath);
  const fake=executor({load:async()=>{await fs.writeFile(opts.archivePath,Buffer.alloc(opts.archiveBytes,0));await fs.utimes(opts.archivePath,before.atime,new Date(before.mtimeMs+2000));return `Loaded image ID: ${imageId}`;}});
  await assert.rejects(acquireImageLease({...opts,execute:fake.execute}),error=>{code('IMAGE_ARCHIVE_CHANGED')(error);assert.equal(error.evidence.cleanup.removed,true);return true;});assert.equal(fake.present,false);
}));

test('post-callback deadline is enforced when event loop delayed past command cap',()=>archive(async opts=>{
  let time=0;const fake=executor({load:(_state,_args,cap)=>{time+=cap+1;return `Loaded image ID: ${imageId}`;}});
  await assert.rejects(acquireImageLease({...opts,execute:fake.execute,now:()=>time}),error=>{code('IMAGE_LEASE_DEADLINE')(error);assert.equal(error.evidence.cleanup.removed,true);return true;});assert.equal(fake.present,false);
}));

test('unknown cleanup inspect never deletes and reports INCOMPLETE',()=>archive(async opts=>{
  const fake=executor(),lease=await acquireImageLease({...opts,execute:fake.execute});
  // Executor closure observes this switch without changing the lease identity.
  fake.inspectError=Object.assign(Error('transport'),{status:1,stderr:'permission denied'});
  const result=await lease.release({containersClosed:true});assert.equal(result.status,'INCOMPLETE');assert.equal(result.removed,false);assert.deepEqual(result.errors,['IMAGE_INSPECT_UNKNOWN']);assert.equal(fake.calls.some(a=>a[1]==='rm'),false);
}));
