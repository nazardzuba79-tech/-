#!/usr/bin/env node
// Unattended daily run for Windows Task Scheduler (no window, no pause). One run serves BOTH paper ledgers.
// 1. Runs "paper_trade.js update" (the main ledger, the same command as update.cmd), then
//    "../paper_da/paper_da.js update" (the second ledger, rule BTC DA). A failure of one does not stop the other.
// 2. For every ledger whose update succeeded, and only for those, saves its files to git
//    (ledger.csv, run_log.csv, STATUS_UA.md) in one commit and pushes. Never forces, never rewrites history.
//    A ledger is published only when its plan, its frozen rule file and its program are already in git:
//    the public history must never show rows of a ledger before the plan they are judged by.
// 3. Appends everything to auto_update.log next to this file (not tracked by git).
// Exit code: 0 = both fine; 1 = an update failed (the files of a failed ledger are not saved to git);
//            2 = both updates fine, git step failed (or a ledger was held back because its plan is not in git yet).
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DIR = __dirname;
const LOG = path.join(DIR, 'auto_update.log');
const BRANCH = 'claude/intelligent-mendel-mlpslf';
const SAVED = ['ledger.csv', 'run_log.csv', 'STATUS_UA.md'];
const MAX_LOG_BYTES = 2 * 1024 * 1024;
// The order matters: the main ledger is updated first, exactly as before.
const LEDGERS = [
  { name: 'основний журнал', dir: DIR, script: 'paper_trade.js', label: '', plan: path.join(DIR, '..', 'PREREGISTRATION_PAPER.md') },
  { name: 'другий журнал, правило BTC DA', dir: path.join(DIR, '..', 'paper_da'), script: 'paper_da.js', label: 'DA ledger: ', plan: path.join(DIR, '..', 'PREREGISTRATION_PAPER_DA.md') },
];

const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
function log(text) {
  try {
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > MAX_LOG_BYTES) fs.renameSync(LOG, LOG + '.old');
    fs.appendFileSync(LOG, text.endsWith('\n') ? text : text + '\n', 'utf8');
  } catch (e) { /* logging must never break the run */ }
}
function exec(cmd, args, timeoutMs) {
  const r = spawnSync(cmd, args, {
    cwd: DIR, encoding: 'utf8', timeout: timeoutMs, windowsHide: true,
    // never wait for a password or a dialog in an unattended run
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: 'echo' },
  });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  return { code: r.error ? -1 : r.status, out: r.error ? `${out}\n${r.error.message}`.trim() : out };
}

// Paths of the saved files of the given ledgers, as git pathspecs relative to this folder.
const gitPath = (base, file) => path.relative(base, file).split(path.sep).join('/');
const savedFiles = (ledgers, base) => ledgers.flatMap((l) => SAVED.map((f) => gitPath(base, path.join(l.dir, f))));
// What must already be in the last commit before a ledger may be published: its plan, its frozen rule, its program.
const requiredFiles = (ledger, base) => [ledger.plan, path.join(ledger.dir, 'frozen_rule.json'), path.join(ledger.dir, ledger.script)].map((f) => gitPath(base, f));

function lastClosedDay(ledger) {
  const rows = fs.readFileSync(path.join(ledger.dir, 'ledger.csv'), 'utf8').trim().split('\n');
  return rows.length > 1 ? rows[rows.length - 1].split(',')[1] : 'no rows yet';
}

// Commit and push the files of the ledgers that were updated. Returns null when fine, otherwise the problem in plain words.
function saveToGit(updated, io) {
  const git = (args, timeoutMs = 60000) => io.exec('git', args, timeoutMs);
  const inside = git(['rev-parse', '--is-inside-work-tree']);
  if (inside.code !== 0 || inside.out.trim() !== 'true') return 'Ця папка не є копією репозиторію git. Журнал оновлено, але в git не збережено.';
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch.code !== 0 || branch.out.trim() !== io.branch) return `Поточна гілка «${branch.out.trim()}», а не «${io.branch}». Журнал оновлено, але в git не збережено.`;
  // other staged work must not be swept into the automatic commit
  const staged = git(['diff', '--cached', '--name-only']);
  if (staged.code !== 0) return `git diff не спрацював: ${staged.out}`;
  if (staged.out.trim() !== '') return 'У репозиторії вже є підготовлені до збереження чужі зміни. Автоматичне збереження пропущено, щоб їх не зачепити.';
  // A ledger is published only on top of its own plan, frozen rule and program (read-only check of the last commit).
  const held = [], ready = [];
  for (const ledger of updated) {
    const missing = requiredFiles(ledger, io.dir).filter((f) => git(['cat-file', '-e', `HEAD:${f.startsWith('../') ? f : './' + f}`]).code !== 0);
    if (missing.length === 0) ready.push(ledger);
    else held.push(`Файли журналу «${ledger.name}» у git не збережено і на сервер не надіслано: спершу в git мають бути його план, заморожене правило і програма, а там ще немає: ${missing.join(', ')}. Сам журнал на цьому комп’ютері оновлено правильно. Збережіть ці файли в git (одним комітом, разом з усією текою журналу), і наступний запуск збереже журнал сам.`);
  }
  const heldNote = held.join(' ');
  const withHeld = (problem) => [problem, heldNote].filter(Boolean).join(' ') || null;
  if (ready.length === 0) return heldNote;
  const FILES = savedFiles(ready, io.dir);
  const changed = git(['status', '--porcelain', '--', ...FILES]);
  if (changed.code !== 0) return withHeld(`git status не спрацював: ${changed.out}`);
  if (changed.out.trim() === '') {
    // nothing new locally; still try to deliver an earlier commit that could not be pushed
    const ahead = git(['rev-list', '--count', '@{u}..HEAD']);
    if (ahead.code === 0 && ahead.out.trim() === '0') return withHeld(null);
  } else {
    const add = git(['add', '--', ...FILES]);
    if (add.code !== 0) return withHeld(`git add не спрацював: ${add.out}`);
    const days = ready.map((l) => `${l.label}last closed day ${lastClosedDay(l)}`).join('; ');
    const commit = git(['commit', '--only', '-m', `Paper trading: automatic ledger update (${days})`, '--', ...FILES]);
    if (commit.code !== 0) return withHeld(`git commit не спрацював: ${commit.out}`);
    io.log(commit.out);
  }
  let push = git(['push', 'origin', io.branch], 120000);
  if (push.code !== 0 && /rejected|non-fast-forward|fetch first/i.test(push.out)) {
    // the branch moved on the server (another session pushed): replay our commit on top, never force
    const pull = git(['pull', '--rebase', '--autostash', 'origin', io.branch], 120000);
    io.log(pull.out);
    if (pull.code !== 0) { git(['rebase', '--abort']); return withHeld(`Гілка на сервері змінилася, і автоматично поєднати не вдалося. Запис збережено локально; на сервер не надіслано.`); }
    push = git(['push', 'origin', io.branch], 120000);
  }
  if (push.code !== 0) return withHeld(`Запис збережено локально, але надіслати на сервер не вдалося: ${push.out.split('\n').slice(-2).join(' ')}`);
  io.log(push.out);
  return withHeld(null);
}

// The whole run. `io` lets the tests replace the command runner, the log and the folders; the
// scheduled task uses the real ones. Returns the exit code.
function runAll(io = {}) {
  io = { exec, log, dir: DIR, branch: BRANCH, ledgers: LEDGERS, node: process.execPath, ...io };
  io.log(`\n===== ${stamp()} автоматичне оновлення =====`);

  // ---- 1. update every ledger; one failing does not stop the other ----
  const updated = [], failed = [];
  for (const ledger of io.ledgers) {
    io.log(`--- ${ledger.name} ---`);
    let up;
    try { up = io.exec(io.node, [path.join(ledger.dir, ledger.script), 'update'], 180000); } catch (e) { up = { code: -1, out: `Не вдалося запустити оновлення: ${e.message}` }; }
    io.log(up.out);
    if (up.code === 0) updated.push(ledger);
    else {
      failed.push(ledger);
      io.log(`ПОМИЛКА: оновлення (${ledger.name}) завершилося з кодом ${up.code}. Файли цього журналу в git не зберігаються.`);
    }
  }
  if (updated.length === 0) {
    io.log('ПОМИЛКА: жодне оновлення не вдалося. У git нічого не збережено.');
    return 1;
  }

  // ---- 2. save to git: only the files of the ledgers that were updated ----
  let problem = null;
  try { problem = saveToGit(updated, io); } catch (e) { problem = `Несподівана помилка під час збереження в git: ${e.message}`; }
  if (problem) io.log(`УВАГА: ${problem}`);
  const names = (list) => list.map((l) => l.name).join('; ');
  if (failed.length) {
    io.log(`Підсумок: не оновлено: ${names(failed)}. Оновлено: ${names(updated)}${problem ? ', але зберегти в git не вдалося (див. вище).' : '; його зміни (якщо були) збережено в git.'}`);
    return 1;
  }
  if (problem) {
    io.log(`Підсумок: оновлено (${names(updated)}), але в git збережено не все (див. вище).`);
    return 2;
  }
  io.log(`Готово: оновлено (${names(updated)}), зміни (якщо були) збережено в git.`);
  return 0;
}

module.exports = { runAll, saveToGit, savedFiles, requiredFiles, LEDGERS, SAVED, BRANCH };

// Only a direct start (the scheduled task, or "node auto_update.js") does the real run.
if (require.main === module) process.exit(runAll());
