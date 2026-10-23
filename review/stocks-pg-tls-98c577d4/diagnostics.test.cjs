'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDiagnostics } = require('./diagnostics.cjs');

const secret = 'boundary-secret-' + 'q'.repeat(300);
const url = 'postgresql://fixture:unit-password@127.0.0.1:5432/stocks_disposable_unit';
const key = 'unit-private-key-123456789';
const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1bml0In0.unitSignature';
function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocks-log-unit-'));
  t.after(() => {
    const resolved = fs.realpathSync(dir);
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('stocks-log-unit-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const trace = path.join(dir, 'trace.jsonl'), fake = path.join(dir, 'fake-docker.cjs');
  fs.writeFileSync(fake, `
    const fs=require('node:fs');
    const [command,...args]=process.argv.slice(2),name=args.at(-1);
    fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify({command,name})+'\\n');
    if(command==='inspect'){
      process.stdout.write(JSON.stringify({Status:'exited',Running:false,ExitCode:1,OOMKilled:false,Error:''}));
    }else if(command==='logs'){
      if(name==='stderr-only'||name==='api-exited')process.stderr.write('API_START_FAILURE: exact startup reason\\n    at boot (runtime.js:42:7)\\n');
      if(name==='mixed'||name==='failure'){process.stdout.write('normal stdout\\n');process.stderr.write('normal stderr\\n');}
      if(name==='failure')process.exitCode=9;
      if(name==='secret-long'){
        const first='START '+${JSON.stringify(url)}+' Bearer opaque-unit-token '+${JSON.stringify(key)}+' '+${JSON.stringify(jwt)};
        process.stdout.write(first+'\\n'+'x'.repeat(2000)+'\\nEND '+${JSON.stringify(secret)});
        process.stderr.write('START '+${JSON.stringify(secret)}+' '+${JSON.stringify(encodeURIComponent(key))}+'\\n'+'z'.repeat(2000)+'\\nEND '+first);
      }
    }else if(command==='rm'){process.stdout.write('removed\\n');}
    else process.exitCode=3;
  `);
  const events = [];
  const diagnostics = createDiagnostics({ secrets: [secret, key, url],
    dockerCommand: [process.execPath, fake], write: line => events.push(JSON.parse(line)), ...options });
  return { ...diagnostics, events, trace };
}
test('successful fake docker logs retains stderr-only application failure and exit/signal', t => {
  const f = fixture(t);
  assert.match(f.dockerLogs('stderr-only', 'readiness'), /API_START_FAILURE: exact startup reason/);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].stream, 'stderr');
  assert.equal(f.events[0].status, 0);
  assert.equal(f.events[0].signal, null);
  assert.match(f.events[0].text, /at boot \(runtime.js:42:7\)/);
});
test('successful fake docker logs keeps stdout and stderr separate without marking stderr as CLI failure', t => {
  const f = fixture(t);
  assert.match(f.dockerLogs('mixed', 'finalize'), /normal stdout[\s\S]+normal stderr/);
  assert.deepEqual(f.events.map(e => [e.stream, e.status, e.text.trim()]), [
    ['stdout', 0, 'normal stdout'], ['stderr', 0, 'normal stderr'],
  ]);
});
test('failed fake docker logs retains both streams and original CLI exit/signal', t => {
  const f = fixture(t);
  assert.throws(() => f.dockerLogs('failure', 'finalize'), error =>
    error.status === 9 && error.signal === null && /exit=9/.test(error.message));
  assert.equal(f.events.length, 2);
  assert.ok(f.events.every(e => e.status === 9 && e.signal === null));
  assert.equal(f.events[1].text.trim(), 'normal stderr');
});
test('both streams redact secrets before bounded head/tail truncation', t => {
  const f = fixture(t, { maxChars: 256 });
  f.dockerLogs('secret-long', 'redaction');
  assert.equal(f.events.length, 2);
  for (const event of f.events) {
    assert.ok(event.text.length <= 256);
    assert.match(event.text, /START/); assert.match(event.text, /END/);
    assert.match(event.text, /\[\.\.\.truncated\.\.\.\]/);
    for (const forbidden of [secret, 'boundary-secret-', key, url, 'unit-password', jwt, 'opaque-unit-token'])
      assert.ok(!event.text.includes(forbidden), 'secret must not survive truncation: ' + forbidden.slice(0,12));
  }
});
test('readiness exit1 captures cause and container state before finalizer/removal; original error survives', async t => {
  const f = fixture(t);
  let original;
  try { await f.waitFor('api-exited', () => { throw Error('must not probe stopped API'); }); }
  catch (error) { original = error; }
  assert.equal(original?.message, 'api-exited exited 1 during readiness');
  const early = f.events.filter(e => e.stage === 'readiness-exit-before-cleanup');
  assert.ok(early.some(e => e.container === 'api-exited' && e.status === 'exited' && e.exitCode === 1));
  assert.ok(early.some(e => e.stream === 'stderr' && e.text.includes('exact startup reason')));
  f.captureContainer('api-exited', 'finalize-before-removal');
  f.docker(['rm', '-f', 'api-exited']);
  const trace = fs.readFileSync(f.trace, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(trace.map(e => e.command), ['inspect', 'logs', 'inspect', 'logs', 'rm']);
  assert.equal(original.message, 'api-exited exited 1 during readiness');
});
test('finalizer diagnostics failure does not replace a prior error or expose command arguments', t => {
  const f = fixture(t);
  const original = new Error('original readiness failure');
  assert.doesNotThrow(() => f.captureContainer('failure', 'finalize-before-removal'));
  assert.equal(original.message, 'original readiness failure');
  assert.ok(f.events.some(e => e.diagnosticError?.includes('exit=9')));
  assert.throws(() => f.command(path.join(os.tmpdir(), 'nonexistent-stocks-docker-unit'), [key]), error => {
    assert.equal(error.errorCode, 'ENOENT'); assert.equal(error.status, null); assert.equal(error.signal, null);
    assert.ok(!error.message.includes(key)); return true;
  });
});
