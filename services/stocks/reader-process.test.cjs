const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { stopReader } = require('./reader-process.cjs');
test('draining an already exited zero-reader process resolves', { timeout: 5000 }, async () => {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await once(child, 'close');
  await stopReader(child, 1000);
});
test('running reader is stopped and its final output drained', { timeout: 5000 }, async () => {
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{console.log('drained');process.exit(0)});console.log('ready');setInterval(()=>{},1000)"], { stdio: ['ignore', 'pipe', 'inherit'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  await once(child.stdout, 'data');
  await stopReader(child);
  if (process.platform !== 'win32') assert.match(output, /drained/);
  assert.notEqual(child.exitCode === null && child.signalCode === null, true);
});
test('a failed reader cannot make a benchmark appear successful', { timeout: 5000 }, async () => {
  const child = spawn(process.execPath, ['-e', 'process.exit(7)'], { stdio: 'ignore' });
  await once(child, 'close');
  await assert.rejects(stopReader(child), /READER_EXIT:7/);
});
