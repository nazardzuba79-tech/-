const test=require('node:test'),assert=require('node:assert/strict');
test('slow resource subprocesses leave the HTTP-generator event loop responsive',async()=>{
  const {sampleResources}=require('./benchmark.cjs'),exec=require('node:util').promisify(require('node:child_process').execFile);
  let heartbeats=0;const timer=setInterval(()=>heartbeats++,5);
  try{
    const result=await sampleResources(['api','gateway','pg'],(_file,args)=>exec(process.execPath,['-e',`setTimeout(()=>console.log(${JSON.stringify(args[0]==='stats'?'{}':'2')}),80)`]));
    assert.ok(heartbeats>=4,'HTTP event loop was blocked by measurement');assert.equal(result.connections,2);assert.deepEqual(result.containers,[{}]);
  }finally{clearInterval(timer);}
});
