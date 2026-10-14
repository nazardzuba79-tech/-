// One built-in-only worker proves clone-at-construction. No app, DB, HTTP or provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker, getEnvironmentData } from 'node:worker_threads';
import { allocateTraceBuffer, createRecorder, ENVIRONMENT_KEY, BUFFER_BYTES } from './recorder.mjs';

test('real Node worker retains exact SAB after parent key deletion, with original workerData keys', {timeout:7000}, async()=>{
  assert.equal(process.version,'v24.21.0');
  assert.equal(getEnvironmentData(ENVIRONMENT_KEY),undefined);
  const buffer=allocateTraceBuffer(),recorder=createRecorder({buffer});
  const data={path:'/data/accounts.sqlite',diagnostics:true,clock:undefined,testControl:undefined,registrationControl:undefined};
  let worker,exited=false,timer;
  try {
    worker=recorder.withWorkerTrace(()=>new Worker(`
      const {parentPort,workerData,getEnvironmentData}=require('node:worker_threads');
      const assert=require('node:assert/strict');
      parentPort.once('message',message=>{
        assert.equal(message,'parent-key-cleared');
        assert.deepEqual(Object.keys(workerData),['path','diagnostics','clock','testControl','registrationControl']);
        assert.equal(workerData.path,'/data/accounts.sqlite');assert.equal(workerData.diagnostics,true);
        assert.equal(workerData.clock,undefined);assert.equal(workerData.testControl,undefined);assert.equal(workerData.registrationControl,undefined);
        const buffer=getEnvironmentData(${JSON.stringify(ENVIRONMENT_KEY)});
        assert.ok(buffer instanceof SharedArrayBuffer);assert.equal(buffer.byteLength,${BUFFER_BYTES});
        Atomics.store(new Int32Array(buffer),buffer.byteLength/4-1,5311489);
        parentPort.postMessage({keys:Object.keys(workerData),bytes:buffer.byteLength,witness:5311489,node:process.version});
        parentPort.close();
      });`,{eval:true,workerData:data,execArgv:[]}));
    assert.equal(getEnvironmentData(ENVIRONMENT_KEY),undefined);
    let evidence;
    await new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(Error('TRACE_ENVIRONMENT_WORKER_DEADLINE')),5000);
      worker.once('error',reject);worker.once('message',value=>{evidence=value;});
      worker.once('exit',code=>{exited=true;code===0?resolve():reject(Error('TRACE_ENVIRONMENT_WORKER_EXIT_'+code));});
      worker.postMessage('parent-key-cleared');
    });
    assert.equal(evidence.node,process.version);assert.equal(evidence.bytes,BUFFER_BYTES);
    assert.deepEqual(evidence.keys,Object.keys(data));
    assert.equal(Atomics.load(new Int32Array(buffer),buffer.byteLength/4-1),5311489);
    assert.equal(getEnvironmentData(ENVIRONMENT_KEY),undefined);
  } finally {
    clearTimeout(timer);
    if(worker&&!exited)await worker.terminate();
    assert.equal(getEnvironmentData(ENVIRONMENT_KEY),undefined);
  }
});
