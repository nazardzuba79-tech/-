import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStraceSummary,fixtureDockerArgs,SYSCALLS } from './profile-sqlite-io.mjs';

test('aggregate syscall parser retains wall time, counts and optional errno count',()=>{
  const result=parseStraceSummary(`% time seconds usecs/call calls errors syscall
  90.00 9.000000 900000 10 fdatasync
   5.00 0.500000 5000 100 2 pwrite64
   3.00 0.300000 3000 100 fcntl
   2.00 0.200000 2000 100 pread64
 100.00 10.000000 32258 310 2 total`);
  assert.equal(result.totalWallSeconds,10);assert.equal(result.totalCalls,310);assert.equal(result.totalErrors,2);
  assert.equal(result.rows[0].errors,0);assert.equal(result.rows[1].errors,2);
  assert.deepEqual(SYSCALLS,['fsync','fdatasync','pwrite64','pread64','fcntl']);
});
test('parser never fabricates absent calls and rejects unexpected or repeated summaries',()=>{
  assert.equal(parseStraceSummary('strace: attach failed').totalCalls,0);
  assert.throws(()=>parseStraceSummary('100.00 1.000000 100 10 connect'),/Unexpected/);
  assert.throws(()=>parseStraceSummary('50.00 1.000000 100 10 fsync\n50.00 1.000000 100 10 fsync'),/Duplicate/);
});
test('diagnostic container preserves original resource bounds without privileged mode',()=>{
  const args=fixtureDockerArgs({name:'fixture-owned-id',dir:'/fixture/disposable',device:'/dev/loop9',cpu:'2',image:'fixture-before:exact'});
  for(const [flag,value] of [['--cpus','0.05'],['--memory','256m'],['--memory-swap','256m'],['--device-read-bps','/dev/loop9:1048576'],['--device-write-bps','/dev/loop9:131072'],['--cpuset-cpus','2'],['--cap-drop','ALL']])assert.equal(args[args.indexOf(flag)+1],value);
  assert.ok(args.includes('--read-only'));assert.ok(!args.includes('--privileged'));assert.equal(args.at(-1),'fixture-before:exact');
});
