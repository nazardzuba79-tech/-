// Isolated disposable bind mount ONLY. Proves throttling independently of page cache.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, unlinkSync } from 'node:fs';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
const cgroup=name=>readFileSync('/sys/fs/cgroup/'+name,'utf8');
const file='/data/isolated-io-probe.bin';
const measure=args=>{const start=performance.now();execFileSync('dd',args,{stdio:['ignore','ignore','pipe']});return performance.now()-start;};
const initial=cgroup('io.stat');
const writeMs=measure(['if=/dev/zero','of='+file,'bs=128K','count=16','oflag=direct','status=none']);
const bytes=statSync(file).size;
const readMs=measure(['if='+file,'of=/dev/null','bs=128K','iflag=direct','status=none']);
const result={kind:'direct-I/O probe, not historical read latency',bytes,writeMs,readMs,initial,ioMax:cgroup('io.max'),ioStat:cgroup('io.stat'),pressure:cgroup('io.pressure'),cpuMax:cgroup('cpu.max'),memoryMax:cgroup('memory.max')};
console.log(JSON.stringify(result));unlinkSync(file);
assert.equal(bytes,2097152);assert.match(result.ioMax,/rbps=1048576/);assert.match(result.ioMax,/wbps=131072/);
assert.match(result.ioStat,/rbytes=[1-9]/);assert.match(result.ioStat,/wbytes=[1-9]/);
assert.ok(writeMs>=12800,'Write throttle not evidenced (allow 20% burst tolerance)');
assert.ok(readMs>=1600,'Read throttle not evidenced (allow 20% burst tolerance)');
