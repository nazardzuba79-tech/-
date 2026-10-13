import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { reconcileJournal } from './evidence.mjs';
import { requireEmptyDirectory } from './safety.mjs';
export async function proveForcedInterruption(output) {
  requireEmptyDirectory(output); mkdirSync(output, { recursive: true });
  const raw = join(output, 'interrupted.attempts.ndjson'); let seen;
  const received = new Promise(ok => { seen = ok; });
  const server = createServer((_req, _res) => { seen(); /* deliberately no response */ });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const code = `import {appendFileSync} from 'node:fs'; import {createJournal} from ${JSON.stringify(new URL('./evidence.mjs', import.meta.url).href)};
    const j=createJournal({append:r=>appendFileSync(${JSON.stringify(raw)},JSON.stringify(r)+'\\n')});
    const id=j.dispatch({kind:'interruption-fixture',route:'/hang',atMs:0});
    const r=await fetch('http://127.0.0.1:${server.address().port}/hang'); j.settle(id,{ok:r.ok,ms:1,status:r.status});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; child.stderr.on('data', b => { stderr = (stderr + b).slice(-4096); });
  const closed = new Promise((ok, fail) => { child.once('error', fail); child.once('close', (code, signal) => ok({ code, signal })); });
  let timer;
  try {
    await Promise.race([received, closed.then(() => { throw Error('INTERRUPTION_CHILD_EXITED_BEFORE_HTTP'); }), new Promise((_, fail) => { timer = setTimeout(() => fail(Error('INTERRUPTION_HTTP_NOT_OBSERVED')), 5000); })]);
    clearTimeout(timer); child.kill('SIGTERM');
    const exit = await Promise.race([closed, new Promise((_, fail) => { timer = setTimeout(() => fail(Error('INTERRUPTION_CHILD_NOT_CLOSED')), 5000); })]);
    clearTimeout(timer);
    const reconciliation = reconcileJournal(readFileSync(raw, 'utf8'));
    const result = { fixture: true, intentionalInterruption: true, httpDispatchObserved: true, exit, reconciliation,
      pass: reconciliation.complete === false && reconciliation.dispatched === 1 && reconciliation.settled === 0 && reconciliation.unknown === 1,
      latencyPolicy: 'Unsettled latency/status UNKNOWN; never manufactured deadline or success.' };
    writeFileSync(join(output, 'proof.json'), JSON.stringify(result, null, 2));
    if (!result.pass) throw Error('FORCED_INTERRUPTION_NOT_DETECTED'); return result;
  } finally { clearTimeout(timer); child.kill('SIGKILL'); await closed.catch(() => {}); server.closeAllConnections(); await new Promise(ok => server.close(ok)); writeFileSync(join(output, 'child.stderr.log'), stderr); }
}
