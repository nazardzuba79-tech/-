'use strict';
// Checks of the unattended daily runner ../paper/auto_update.js, which updates BOTH paper ledgers.
// Loaded by paper_da.test.js (this file name is deliberately not a *.test.js name, so the checks run once).
// Offline: the command runner is replaced by a fake, so no update is run and nothing is fetched. No git
// command touches this repository: the fake answers them, and the one test that uses the real git
// works in a throw-away repository of its own. Files are written only to the OS temp directory.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RUNNER = path.join(__dirname, '..', 'paper', 'auto_update.js');
const BRANCH = 'claude/intelligent-mendel-mlpslf';

// The runner commits and pushes when started directly. It may be loaded here only if it does
// nothing on load: one process.exit, behind the "started directly" guard.
function loadRunner() {
  const source = fs.readFileSync(RUNNER, 'utf8');
  assert.match(source, /\nif \(require\.main === module\) process\.exit\(runAll\(\)\);\r?\n$/, 'the runner acts only when started directly');
  assert.equal(source.match(/process\.exit\(/g).length, 1, 'no other process.exit in the runner');
  assert.equal(source.match(/\brunAll\(/g).length, 2, 'runAll is defined once and called once, behind the guard');
  return { source, runner: require(RUNNER) };
}

const tmpDirs = [];
test.after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

// Two stand-in ledger folders and a fake command runner. `o` describes how the outside world behaves.
function world(o = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csi-auto-update-test-'));
  tmpDirs.push(root);
  const mainDir = path.join(root, 'paper'), daDir = path.join(root, 'paper_da');
  fs.mkdirSync(mainDir);
  fs.mkdirSync(daDir);
  fs.writeFileSync(path.join(mainDir, 'ledger.csv'), 'seq,date,open\n1,2026-11-26,1\n2,2026-11-27,1\n');
  fs.writeFileSync(path.join(daDir, 'ledger.csv'), o.daRows === 0 ? 'seq,date,open\n' : 'seq,date,open\n1,2026-11-27,1\n');
  const calls = [], logs = [];
  const pushes = (o.push || [{ code: 0, out: 'pushed' }]).slice();
  const exec = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'NODE') {
      assert.equal(args[1], 'update');
      assert.equal(args.length, 2, 'the update is started without any option');
      const script = path.basename(args[0]);
      return (o.update && o.update[script]) || { code: 0, out: `updated by ${script}` };
    }
    assert.equal(cmd, 'git');
    const sub = args[0] === 'rev-parse' ? args.join(' ') : args[0];
    switch (sub) {
      case 'rev-parse --is-inside-work-tree': return o.notRepo ? { code: 128, out: 'fatal: not a git repository' } : { code: 0, out: 'true' };
      case 'rev-parse --abbrev-ref HEAD': return { code: 0, out: o.branch || BRANCH };
      case 'diff': return { code: 0, out: o.staged || '' };
      case 'cat-file': { // "is this file in the last commit?" (read-only)
        assert.equal(args.length, 3);
        assert.equal(args[1], '-e');
        const missing = (o.notInGit || []).some((part) => args[2].includes(part));
        return missing ? { code: 128, out: "fatal: path does not exist in 'HEAD'" } : { code: 0, out: '' };
      }
      case 'status': return { code: 0, out: o.unchanged ? '' : ' M something' };
      case 'rev-list': return { code: 0, out: String(o.ahead || 0) };
      case 'add': return o.addFails ? { code: 1, out: 'add failed' } : { code: 0, out: '' };
      case 'commit': return o.commitFails ? { code: 1, out: 'commit failed' } : { code: 0, out: '[branch 1234567] saved' };
      case 'push': return pushes.length > 1 ? pushes.shift() : pushes[0];
      case 'pull': return o.pull || { code: 0, out: 'rebased' };
      case 'rebase': return { code: 0, out: '' };
      default: throw new Error(`unexpected git command: ${args.join(' ')}`);
    }
  };
  const ledgers = [
    { name: 'основний журнал', dir: mainDir, script: 'paper_trade.js', label: '', plan: path.join(root, 'PREREGISTRATION_PAPER.md') },
    { name: 'другий журнал, правило BTC DA', dir: daDir, script: 'paper_da.js', label: 'DA ledger: ', plan: path.join(root, 'PREREGISTRATION_PAPER_DA.md') },
  ];
  const io = { exec, log: (t) => logs.push(t), dir: mainDir, branch: BRANCH, ledgers, node: 'NODE' };
  const git = (sub) => calls.filter((c) => c[0] === 'git' && c[1] === sub).map((c) => c.slice(1));
  return { io, calls, logs, git, mainDir, daDir, text: () => logs.join('\n') };
}

const MAIN_FILES = ['ledger.csv', 'run_log.csv', 'STATUS_UA.md'];
const DA_FILES = ['../paper_da/ledger.csv', '../paper_da/run_log.csv', '../paper_da/STATUS_UA.md'];
// What must be in the last commit before a ledger is published: its plan, its frozen rule, its program.
const MAIN_REQUIRED = ['../PREREGISTRATION_PAPER.md', 'frozen_rule.json', 'paper_trade.js'];
const DA_REQUIRED = ['../PREREGISTRATION_PAPER_DA.md', '../paper_da/frozen_rule.json', '../paper_da/paper_da.js'];
// The same files as the runner names them to git, relative to its own folder.
const REQUIRED_IN_HEAD = ['HEAD:../PREREGISTRATION_PAPER.md', 'HEAD:./frozen_rule.json', 'HEAD:./paper_trade.js',
  'HEAD:../PREREGISTRATION_PAPER_DA.md', 'HEAD:../paper_da/frozen_rule.json', 'HEAD:../paper_da/paper_da.js'];
const filesOf = (call) => call.slice(call.indexOf('--') + 1);
// Whatever happens, the runner never rewrites history and never touches anything but its own files.
function assertHarmless(w) {
  for (const c of w.calls.filter((x) => x[0] === 'git')) {
    const args = c.slice(1);
    assert.ok(['rev-parse', 'diff', 'status', 'rev-list', 'cat-file', 'add', 'commit', 'push', 'pull', 'rebase'].includes(args[0]), args.join(' '));
    if (args[0] === 'cat-file') assert.ok(args.length === 3 && args[1] === '-e' && REQUIRED_IN_HEAD.includes(args[2]), args.join(' '));
    for (const bad of ['--force', '-f', '--force-with-lease', '--hard', '-A', '--all', '-a', '.', '--amend', '--no-verify']) assert.ok(!args.includes(bad), args.join(' '));
    if (args[0] === 'push') assert.deepEqual(args, ['push', 'origin', BRANCH]);
    if (args[0] === 'pull') assert.deepEqual(args, ['pull', '--rebase', '--autostash', 'origin', BRANCH]);
    if (args[0] === 'rebase') assert.deepEqual(args, ['rebase', '--abort']);
    if (args[0] === 'commit') assert.deepEqual(args.slice(0, 3), ['commit', '--only', '-m']);
  }
}

test('the real runner: both ledgers, main first, the right files and the right branch', () => {
  const { source, runner } = loadRunner();
  assert.equal(runner.BRANCH, BRANCH);
  assert.deepEqual(runner.SAVED, MAIN_FILES);
  assert.deepEqual(runner.LEDGERS.map((l) => l.script), ['paper_trade.js', 'paper_da.js']);
  const runnerDir = path.dirname(RUNNER);
  assert.equal(path.resolve(runner.LEDGERS[0].dir), runnerDir);
  assert.equal(path.resolve(runner.LEDGERS[1].dir), path.join(path.dirname(runnerDir), 'paper_da'));
  for (const l of runner.LEDGERS) assert.ok(fs.existsSync(path.join(l.dir, l.script)), `${l.script} exists`);
  assert.deepEqual(runner.savedFiles(runner.LEDGERS, runnerDir), [...MAIN_FILES, ...DA_FILES]);
  // Each ledger names its own plan; the plan, the rule file and the program exist on disk.
  assert.deepEqual(runner.requiredFiles(runner.LEDGERS[0], runnerDir), MAIN_REQUIRED);
  assert.deepEqual(runner.requiredFiles(runner.LEDGERS[1], runnerDir), DA_REQUIRED);
  for (const file of [...MAIN_REQUIRED, ...DA_REQUIRED]) assert.ok(fs.existsSync(path.join(runnerDir, file)), `${file} exists`);
  // The log stays next to the runner, and git never waits for a password.
  assert.match(source, /const LOG = path\.join\(DIR, 'auto_update\.log'\);/);
  assert.match(source, /GIT_TERMINAL_PROMPT: '0'/);
  assert.doesNotMatch(source, /--force|reset --hard|checkout|--no-verify/);
});

test('both updates fine: one commit with the files of both ledgers, one push, exit 0', () => {
  const { runner } = loadRunner();
  const w = world();
  assert.equal(runner.runAll(w.io), 0);
  // main ledger first, then the second one, then git
  assert.deepEqual(w.calls.slice(0, 2), [['NODE', path.join(w.mainDir, 'paper_trade.js'), 'update'], ['NODE', path.join(w.daDir, 'paper_da.js'), 'update']]);
  assert.ok(w.calls.slice(2).every((c) => c[0] === 'git'));
  // Before anything is added, the last commit is asked for the plan, the rule file and the program of each ledger.
  assert.deepEqual(w.git('cat-file').map((c) => c[2]), REQUIRED_IN_HEAD);
  const order = w.calls.map((c) => c[1]);
  assert.ok(order.lastIndexOf('cat-file') < order.indexOf('add'), 'checked before anything is added');
  assert.deepEqual(filesOf(w.git('status')[0]), [...MAIN_FILES, ...DA_FILES]);
  assert.deepEqual(w.git('add'), [['add', '--', ...MAIN_FILES, ...DA_FILES]]);
  assert.equal(w.git('commit').length, 1, 'one commit');
  const commit = w.git('commit')[0];
  assert.equal(commit[3], 'Paper trading: automatic ledger update (last closed day 2026-11-27; DA ledger: last closed day 2026-11-27)');
  assert.deepEqual(filesOf(commit), [...MAIN_FILES, ...DA_FILES]);
  assert.equal(w.git('push').length, 1);
  assert.equal(w.git('pull').length, 0);
  assert.match(w.text(), /updated by paper_trade\.js[\s\S]*updated by paper_da\.js/);
  assert.match(w.text(), /Готово/);
  assertHarmless(w);

  // A second ledger that has no rows yet is said so in the commit message.
  const empty = world({ daRows: 0 });
  assert.equal(runner.runAll(empty.io), 0);
  assert.equal(empty.git('commit')[0][3], 'Paper trading: automatic ledger update (last closed day 2026-11-27; DA ledger: last closed day no rows yet)');
});

test('a failure of one ledger does not prevent saving the other; exit 1', () => {
  const { runner } = loadRunner();
  // The second ledger fails: the main ledger is saved exactly as before the second ledger existed.
  let w = world({ update: { 'paper_da.js': { code: 1, out: 'ПОМИЛКА [E_GAP]: ...' } } });
  assert.equal(runner.runAll(w.io), 1);
  assert.deepEqual(w.git('add'), [['add', '--', ...MAIN_FILES]]);
  assert.deepEqual(w.git('commit')[0], ['commit', '--only', '-m', 'Paper trading: automatic ledger update (last closed day 2026-11-27)', '--', ...MAIN_FILES]);
  assert.equal(w.git('push').length, 1);
  assert.ok(w.calls.filter((c) => c[0] === 'git').every((c) => !c.some((a) => String(a).includes('paper_da'))), 'no git command names a file of the failed ledger');
  assert.match(w.text(), /ПОМИЛКА \[E_GAP\]/);
  assert.match(w.text(), /ПОМИЛКА: оновлення \(другий журнал, правило BTC DA\) завершилося з кодом 1/);
  assert.match(w.text(), /Підсумок: не оновлено: другий журнал, правило BTC DA\. Оновлено: основний журнал/);
  assert.doesNotMatch(w.text(), /Готово/);
  assertHarmless(w);

  // The main ledger fails: the second one is still updated and saved, and only its files.
  w = world({ update: { 'paper_trade.js': { code: 1, out: 'ПОМИЛКА [E_FETCH]: ...' } } });
  assert.equal(runner.runAll(w.io), 1);
  assert.deepEqual(w.calls[1], ['NODE', path.join(w.daDir, 'paper_da.js'), 'update'], 'the second update still runs');
  assert.deepEqual(w.git('add'), [['add', '--', ...DA_FILES]]);
  assert.deepEqual(w.git('commit')[0], ['commit', '--only', '-m', 'Paper trading: automatic ledger update (DA ledger: last closed day 2026-11-27)', '--', ...DA_FILES]);
  assert.deepEqual(filesOf(w.git('status')[0]), DA_FILES);
  assert.equal(w.git('push').length, 1);
  assertHarmless(w);

  // A crash of an update (code 2) or a timeout (code -1) counts as a failure too.
  for (const code of [2, 3, -1, null]) {
    w = world({ update: { 'paper_da.js': { code, out: 'boom' } } });
    assert.equal(runner.runAll(w.io), 1, `code ${code}`);
    assert.deepEqual(w.git('add'), [['add', '--', ...MAIN_FILES]]);
  }

  // Both fail: git is not touched at all.
  w = world({ update: { 'paper_trade.js': { code: 1, out: 'x' }, 'paper_da.js': { code: 1, out: 'y' } } });
  assert.equal(runner.runAll(w.io), 1);
  assert.equal(w.calls.filter((c) => c[0] === 'git').length, 0);
  assert.match(w.text(), /жодне оновлення не вдалося\. У git нічого не збережено/);

  // An update failed AND the git step failed: still exit 1, both problems are in the log.
  w = world({ update: { 'paper_da.js': { code: 1, out: 'y' } }, branch: 'main' });
  assert.equal(runner.runAll(w.io), 1);
  assert.match(w.text(), /УВАГА: Поточна гілка «main»/);
  assert.match(w.text(), /зберегти в git не вдалося/);
});

test('the safety rules of the git step are unchanged; a git problem alone is exit 2', () => {
  const { runner } = loadRunner();
  const nothingSaved = (w) => { for (const sub of ['add', 'commit', 'push', 'pull']) assert.equal(w.git(sub).length, 0, sub); assertHarmless(w); };

  // Not a git repository.
  let w = world({ notRepo: true });
  assert.equal(runner.runAll(w.io), 2);
  assert.match(w.text(), /не є копією репозиторію git/);
  nothingSaved(w);
  // Another branch is checked out: nothing is committed or pushed.
  w = world({ branch: 'main' });
  assert.equal(runner.runAll(w.io), 2);
  assert.match(w.text(), /Поточна гілка «main», а не «claude\/intelligent-mendel-mlpslf»/);
  nothingSaved(w);
  // Somebody's staged work: skip, so that it is not swept into the automatic commit.
  w = world({ staged: 'src/other.js' });
  assert.equal(runner.runAll(w.io), 2);
  assert.match(w.text(), /чужі зміни/);
  nothingSaved(w);
  // Nothing changed and nothing waits to be pushed: no commit, no push, exit 0.
  w = world({ unchanged: true, ahead: 0 });
  assert.equal(runner.runAll(w.io), 0);
  nothingSaved(w);
  // Nothing changed, but an earlier commit was never delivered: push only.
  w = world({ unchanged: true, ahead: 1 });
  assert.equal(runner.runAll(w.io), 0);
  assert.equal(w.git('commit').length, 0);
  assert.equal(w.git('push').length, 1);
  assertHarmless(w);
  // add or commit fails.
  w = world({ addFails: true });
  assert.equal(runner.runAll(w.io), 2);
  assert.equal(w.git('commit').length + w.git('push').length, 0);
  w = world({ commitFails: true });
  assert.equal(runner.runAll(w.io), 2);
  assert.equal(w.git('push').length, 0);

  // The branch moved on the server: rebase once, push again, never force.
  w = world({ push: [{ code: 1, out: ' ! [rejected] (fetch first)' }, { code: 0, out: 'pushed' }] });
  assert.equal(runner.runAll(w.io), 0);
  assert.equal(w.git('pull').length, 1);
  assert.equal(w.git('push').length, 2);
  assertHarmless(w);
  // Still rejected after the one rebase: give up, exit 2, no third push.
  w = world({ push: [{ code: 1, out: ' ! [rejected] (non-fast-forward)' }] });
  assert.equal(runner.runAll(w.io), 2);
  assert.equal(w.git('pull').length, 1);
  assert.equal(w.git('push').length, 2);
  assert.match(w.text(), /надіслати на сервер не вдалося/);
  assertHarmless(w);
  // The rebase itself fails: abort it, keep the commit locally, exit 2.
  w = world({ push: [{ code: 1, out: ' ! [rejected] (fetch first)' }], pull: { code: 1, out: 'CONFLICT' } });
  assert.equal(runner.runAll(w.io), 2);
  assert.deepEqual(w.git('rebase'), [['rebase', '--abort']]);
  assert.equal(w.git('push').length, 1);
  assert.match(w.text(), /автоматично поєднати не вдалося/);
  assertHarmless(w);
  // A push that fails for another reason (no network) is not followed by a rebase.
  w = world({ push: [{ code: 128, out: 'fatal: unable to access' }] });
  assert.equal(runner.runAll(w.io), 2);
  assert.equal(w.git('pull').length, 0);
  assert.equal(w.git('push').length, 1);
});

test('a ledger is published only when its plan, frozen rule and program are already in git', () => {
  const { runner } = loadRunner();
  const noDaFile = (w) => assert.ok(w.calls.filter((c) => c[0] === 'git' && c[1] !== 'cat-file').every((c) => !c.some((a) => String(a).includes('paper_da'))), 'no git command but the read-only check names a file of the held ledger');

  // Today's state before the owner's commit: the whole paper_da folder and its plan are not in git.
  // The main ledger is saved exactly as usual; the second one stays on this computer; exit 2 so it is noticed.
  let w = world({ notInGit: ['paper_da/', 'PREREGISTRATION_PAPER_DA'] });
  assert.equal(runner.runAll(w.io), 2);
  assert.deepEqual(w.calls.slice(0, 2).map((c) => path.basename(c[1])), ['paper_trade.js', 'paper_da.js'], 'both updates still run');
  assert.deepEqual(filesOf(w.git('status')[0]), MAIN_FILES);
  assert.deepEqual(w.git('add'), [['add', '--', ...MAIN_FILES]]);
  assert.deepEqual(w.git('commit')[0], ['commit', '--only', '-m', 'Paper trading: automatic ledger update (last closed day 2026-11-27)', '--', ...MAIN_FILES]);
  assert.equal(w.git('push').length, 1);
  noDaFile(w);
  assert.match(w.text(), /УВАГА: Файли журналу «другий журнал, правило BTC DA» у git не збережено і на сервер не надіслано/);
  assert.ok(w.text().includes('ще немає: ../PREREGISTRATION_PAPER_DA.md, ../paper_da/frozen_rule.json, ../paper_da/paper_da.js.'), 'the missing files are named');
  assert.match(w.text(), /Сам журнал на цьому комп’ютері оновлено правильно/);
  assert.match(w.text(), /Підсумок: оновлено \(основний журнал; другий журнал, правило BTC DA\), але в git збережено не все/);
  assert.doesNotMatch(w.text(), /Готово/);
  assertHarmless(w);

  // Any one of the three missing is enough to hold the ledger back.
  for (const [part, named] of [['PREREGISTRATION_PAPER_DA', '../PREREGISTRATION_PAPER_DA.md'], ['paper_da/frozen_rule.json', '../paper_da/frozen_rule.json'], ['paper_da/paper_da.js', '../paper_da/paper_da.js']]) {
    w = world({ notInGit: [part] });
    assert.equal(runner.runAll(w.io), 2, part);
    assert.deepEqual(w.git('add'), [['add', '--', ...MAIN_FILES]], part);
    assert.ok(w.text().includes('ще немає: ' + named + '.'), part);
    noDaFile(w);
  }
  // The same rule holds for the main ledger.
  w = world({ notInGit: ['HEAD:./frozen_rule.json'] });
  assert.equal(runner.runAll(w.io), 2);
  assert.deepEqual(w.git('add'), [['add', '--', ...DA_FILES]]);
  assert.match(w.text(), /Файли журналу «основний журнал» у git не збережено/);
  // Nothing may be published at all: no add, no commit, no push.
  w = world({ notInGit: ['HEAD:'] });
  assert.equal(runner.runAll(w.io), 2);
  for (const sub of ['status', 'add', 'commit', 'push', 'pull']) assert.equal(w.git(sub).length, 0, sub);
  assertHarmless(w);
  // Held back AND another git problem: both are in the log.
  w = world({ notInGit: ['paper_da/'], push: [{ code: 128, out: 'fatal: unable to access' }] });
  assert.equal(runner.runAll(w.io), 2);
  assert.match(w.text(), /надіслати на сервер не вдалося/);
  assert.match(w.text(), /Файли журналу «другий журнал, правило BTC DA» у git не збережено/);
  // Held back while nothing else changed: still exit 2, nothing added.
  w = world({ notInGit: ['paper_da/'], unchanged: true, ahead: 0 });
  assert.equal(runner.runAll(w.io), 2);
  assert.equal(w.git('add').length + w.git('push').length, 0);
  // The main update failed and the second ledger is held back: exit 1, git is only asked, nothing is saved.
  w = world({ notInGit: ['paper_da/'], update: { 'paper_trade.js': { code: 1, out: 'x' } } });
  assert.equal(runner.runAll(w.io), 1);
  for (const sub of ['status', 'add', 'commit', 'push']) assert.equal(w.git(sub).length, 0, sub);
  assert.match(w.text(), /у git не збережено/);
});

// The same with the real git, in a throw-away repository with its own "server" (a bare repository
// next to it), both in the OS temp directory. Skipped when git is not installed.
test('real git, scratch repository: rows of a ledger are never pushed before its plan, rule file and program', (t) => {
  const { runner } = loadRunner();
  if (spawnSync('git', ['--version'], { encoding: 'utf8' }).status !== 0) { t.skip('git is not installed'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csi-auto-update-git-'));
  tmpDirs.push(root);
  const work = path.join(root, 'work'), tv = path.join(work, 'tv'), mainDir = path.join(tv, 'paper'), daDir = path.join(tv, 'paper_da');
  fs.mkdirSync(mainDir, { recursive: true });
  fs.mkdirSync(daDir);
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
  const git = (cwd, ...args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', env });
    assert.equal(r.status, 0, 'git ' + args.join(' ') + ': ' + r.stdout + r.stderr);
    return r.stdout.replace(/\r/g, '').trim();
  };
  const put = (dir, name, text) => fs.writeFileSync(path.join(dir, name), text);
  git(root, 'init', '--bare', '-q', 'server.git');
  git(work, 'init', '-q', '-b', BRANCH);
  git(work, 'config', 'commit.gpgsign', 'false');
  git(work, 'config', 'core.autocrlf', 'false');
  git(work, 'remote', 'add', 'origin', path.join(root, 'server.git'));
  // The main ledger with its plan, rule file and program is in git and on the server.
  put(tv, 'PREREGISTRATION_PAPER.md', 'main plan\n');
  put(mainDir, 'frozen_rule.json', '{}');
  put(mainDir, 'paper_trade.js', '// main program\n');
  put(mainDir, 'ledger.csv', 'seq,date\n1,2026-11-26\n');
  put(mainDir, 'run_log.csv', 'run\n');
  put(mainDir, 'STATUS_UA.md', 'status\n');
  git(work, 'add', '--', 'tv');
  git(work, 'commit', '-q', '-m', 'main ledger');
  git(work, 'push', '-q', '-u', 'origin', BRANCH);
  // The second ledger exists on disk only (today's state): plan, rule file, program, header-only ledger.
  put(tv, 'PREREGISTRATION_PAPER_DA.md', 'second plan\n');
  put(daDir, 'frozen_rule.json', '{}');
  put(daDir, 'paper_da.js', '// second program\n');
  put(daDir, 'ledger.csv', 'seq,date\n');
  put(daDir, 'run_log.csv', 'run\n');
  put(daDir, 'STATUS_UA.md', 'no rows yet\n');

  const logs = [];
  // The "updates": each writes one more row, as the real programs would after a day closed.
  const exec = (cmd, args, timeoutMs) => {
    if (cmd === 'NODE') {
      const dir = path.dirname(args[0]);
      const n = fs.readFileSync(path.join(dir, 'ledger.csv'), 'utf8').trim().split('\n').length;
      fs.appendFileSync(path.join(dir, 'ledger.csv'), n + ',2026-11-' + (26 + n) + '\n');
      fs.appendFileSync(path.join(dir, 'run_log.csv'), 'run\n');
      put(dir, 'STATUS_UA.md', 'rows ' + n + '\n');
      return { code: 0, out: 'updated' };
    }
    assert.equal(cmd, 'git');
    const r = spawnSync('git', args, { cwd: mainDir, encoding: 'utf8', timeout: timeoutMs, env });
    return { code: r.error ? -1 : r.status, out: ((r.stdout || '') + (r.stderr || '')).trim() };
  };
  const ledgers = [
    { name: 'основний журнал', dir: mainDir, script: 'paper_trade.js', label: '', plan: path.join(tv, 'PREREGISTRATION_PAPER.md') },
    { name: 'другий журнал, правило BTC DA', dir: daDir, script: 'paper_da.js', label: 'DA ledger: ', plan: path.join(tv, 'PREREGISTRATION_PAPER_DA.md') },
  ];
  const io = { exec, log: (x) => logs.push(x), dir: mainDir, branch: BRANCH, ledgers, node: 'NODE' };
  const onServer = () => git(root, '--git-dir', path.join(root, 'server.git'), 'ls-tree', '-r', '--name-only', BRANCH).split('\n').sort();
  const lastCommitFiles = () => git(work, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort();

  // Run 1: the first row of the second ledger is written, but nothing of that ledger reaches git.
  assert.equal(runner.runAll(io), 2, logs.join('\n'));
  assert.deepEqual(lastCommitFiles(), ['tv/paper/STATUS_UA.md', 'tv/paper/ledger.csv', 'tv/paper/run_log.csv']);
  assert.ok(onServer().every((f) => !f.includes('paper_da') && !f.includes('PAPER_DA')), 'nothing of the second ledger is on the server');
  assert.equal(git(work, 'rev-list', '--count', '@{u}..HEAD'), '0', 'the main ledger was pushed');
  assert.match(git(work, 'status', '--porcelain'), /^\?\? tv\/PREREGISTRATION_PAPER_DA\.md\n\?\? tv\/paper_da\/$/, 'the second ledger is still untouched by git');
  assert.equal(fs.readFileSync(path.join(daDir, 'ledger.csv'), 'utf8'), 'seq,date\n1,2026-11-27\n', 'the row itself is kept on disk');
  assert.match(logs.join('\n'), /Файли журналу «другий журнал, правило BTC DA» у git не збережено/);

  // The owner commits the plan, the rule file and the program (here: without the ledger files).
  git(work, 'add', '--', 'tv/PREREGISTRATION_PAPER_DA.md', 'tv/paper_da/frozen_rule.json', 'tv/paper_da/paper_da.js');
  git(work, 'commit', '-q', '-m', 'plan of the second ledger');
  // Run 2: now the second ledger is saved by the runner, in one commit with the main one, after the plan.
  logs.length = 0;
  assert.equal(runner.runAll(io), 0, logs.join('\n'));
  assert.deepEqual(lastCommitFiles(), ['tv/paper/STATUS_UA.md', 'tv/paper/ledger.csv', 'tv/paper/run_log.csv', 'tv/paper_da/STATUS_UA.md', 'tv/paper_da/ledger.csv', 'tv/paper_da/run_log.csv']);
  assert.deepEqual(git(work, 'log', '--format=%s', '-3').split('\n').map((x) => x.replace(/ \(.*$/, '')), ['Paper trading: automatic ledger update', 'plan of the second ledger', 'Paper trading: automatic ledger update']);
  assert.ok(onServer().includes('tv/paper_da/ledger.csv') && onServer().includes('tv/PREREGISTRATION_PAPER_DA.md'));
  assert.equal(git(work, 'status', '--porcelain'), '');
  assert.match(logs.join('\n'), /Готово/);
});
