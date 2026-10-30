import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const moduleUrl = name => new URL(name, import.meta.url).href;
const attempts = {
  'JSON server factory': `const {createServer}=await import(${JSON.stringify(moduleUrl('./server.mjs'))}); await createServer({port:0,dataPath:'ledger.json',autoPoll:false});`,
  'SQLite server factory': `const {createServer}=await import(${JSON.stringify(moduleUrl('./server.mjs'))}); await createServer({port:0,accountsPath:'ledger.sqlite',authenticate:async()=>({issuer:'fixture',subject:'alice'}),autoPoll:false});`,
  'unverified authority object': `const {createServer}=await import(${JSON.stringify(moduleUrl('./server.mjs'))}); await createServer({port:0,accountAuthority:{authenticate:async()=>({issuer:'fixture',subject:'alice'})},tradePrincipals:[{issuer:'fixture',subject:'alice'},{issuer:'fixture',subject:'bob'}],autoPoll:false});`,
  'direct JSON store': `const {openStore}=await import(${JSON.stringify(moduleUrl('./store.mjs'))}); await openStore('ledger.json');`,
  'direct SQLite repository': `const {openAccounts}=await import(${JSON.stringify(moduleUrl('./accounts.mjs'))}); openAccounts('ledger.sqlite');`,
};

for (const [name, code] of Object.entries(attempts)) {
  test(`production boundary rejects ${name} before disk or HTTP`, {timeout:10000}, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'stocks-boundary-'));
    // Keep unexpected artifacts on failure for diagnosis; never erase a ledger.
    t.after(async () => { if (!(await readdir(dir)).length) await rmdir(dir); });
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !/^(STOCKS_|DATABASE_URL$|DIRECT_URL$|NODE_OPTIONS$|JWT_SECRET$)/.test(key)));
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
      cwd:dir, env:{...env,NODE_ENV:'production'}, windowsHide:true,
    });
    let stderr = '';
    child.stderr.on('data', data => stderr += data);
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(Error('BOUNDARY_DID_NOT_EXIT')); }, 5000);
      child.once('error', reject);
      child.once('exit', code => { clearTimeout(timer); resolve(code); });
    });
    t.after(() => child.kill());
    assert.notEqual(result, 0);
    assert.match(stderr, /STOCKS_RELEASE_PG_AUTHORITY_REQUIRED|STOCKS_LEGACY_STORAGE_UNSUPPORTED/);
    assert.deepEqual(await readdir(dir), []);
  });
}
