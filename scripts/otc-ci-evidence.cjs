// Fresh evidence only. No credentials, database access or deployment.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const write = (dir, name, data) => fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2));

function init(parent, metadata) {
  fs.mkdirSync(parent, { recursive: true });
  // Never reuse/delete a previous run, even on a retry in the same runner.
  const dir = fs.mkdtempSync(path.join(parent, 'otc-cash-'));
  write(dir, 'run.json', { ...metadata, startedAt: new Date().toISOString(), status: 'RUNNING' });
  return dir;
}

function readRun(dir) {
  if (!dir) throw new Error('OTC_CI_EVIDENCE_DIR must be initialized first');
  return JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
}

async function run(dir, id, command, args) {
  readRun(dir);
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Invalid evidence step ID');
  const log = fs.createWriteStream(path.join(dir, `${id}.log`), { flags: 'wx' });
  // Register the exclusive log before spawning; duplicates fail without executing.
  await new Promise((resolve, reject) => { log.once('open', resolve); log.once('error', reject); });
  const result = { id, startedAt: new Date().toISOString(), status: 'RUNNING' };
  write(dir, `${id}.json`, result);
  if (command === 'node') command = process.execPath;
  else if (command === 'npm' && process.platform === 'win32') {
    // No shell interpolation. setup-node's npm CLI lives beside node.exe.
    args = [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), ...args];
    command = process.execPath;
  }
  const child = spawn(command, args, { cwd: root, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => { log.write(data); process.stdout.write(data); });
  child.stderr.on('data', data => { log.write(data); process.stderr.write(data); });
  let launchError;
  child.on('error', error => { launchError = error.message; log.write(error.stack + '\n'); });
  const { code, signal } = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  await new Promise(resolve => log.end(resolve));
  const exitCode = !launchError && Number.isInteger(code) && code >= 0 ? code : 1;
  write(dir, `${id}.json`, { ...result, finishedAt: new Date().toISOString(), status: exitCode === 0 ? 'PASS' : 'FAIL', exitCode, signal, launchError });
  return exitCode;
}

function finalize(dir, steps) {
  const metadata = readRun(dir);
  const outcomes = Object.values(steps).map(step => step.outcome);
  // A skipped or unfinished gate is never a successful review.
  const status = outcomes.includes('failure') ? 'FAIL'
    : outcomes.length && outcomes.every(value => value === 'success') ? 'PASS' : 'INCOMPLETE';
  write(dir, 'run.json', { ...metadata, finishedAt: new Date().toISOString(), status, steps });
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'init') {
    const checkoutSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const dir = init(process.env.RUNNER_TEMP || os.tmpdir(), {
      checkoutSha, eventSha: process.env.GITHUB_SHA || null,
      runId: process.env.GITHUB_RUN_ID || 'local', runAttempt: process.env.GITHUB_RUN_ATTEMPT || 'local',
    });
    if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV, `OTC_CI_EVIDENCE_DIR=${dir}\n`);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `directory=${dir}\n`);
    console.log(`Fresh evidence directory: ${dir}`);
  } else if (mode === 'run') process.exitCode = await run(process.env.OTC_CI_EVIDENCE_DIR, args[0], args[1], args.slice(2));
  else if (mode === 'finalize') finalize(process.env.OTC_CI_EVIDENCE_DIR, JSON.parse(process.env.OTC_CI_STEPS));
  else throw new Error('Usage: otc-ci-evidence.cjs init|run <step> <command> [args]|finalize');
}
module.exports = { init, run, finalize };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
