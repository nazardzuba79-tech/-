#!/usr/bin/env node
// Unattended daily run for Windows Task Scheduler (no window, no pause).
// 1. Runs "paper_trade.js update" (the same command as update.cmd).
// 2. If, and only if, the update succeeded and the paper files changed, saves them to git
//    (ledger.csv, run_log.csv, STATUS_UA.md) and pushes. Never forces, never rewrites history.
// 3. Appends everything to auto_update.log next to this file (not tracked by git).
// Exit code: 0 = fine; 1 = the update itself failed (nothing saved to git); 2 = update fine, git step failed.
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DIR = __dirname;
const LOG = path.join(DIR, 'auto_update.log');
const BRANCH = 'claude/intelligent-mendel-mlpslf';
const FILES = ['ledger.csv', 'run_log.csv', 'STATUS_UA.md'];
const MAX_LOG_BYTES = 2 * 1024 * 1024;

const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
function log(text) {
  try {
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > MAX_LOG_BYTES) fs.renameSync(LOG, LOG + '.old');
    fs.appendFileSync(LOG, text.endsWith('\n') ? text : text + '\n', 'utf8');
  } catch (e) { /* logging must never break the run */ }
}
function run(cmd, args, timeoutMs) {
  const r = spawnSync(cmd, args, {
    cwd: DIR, encoding: 'utf8', timeout: timeoutMs, windowsHide: true,
    // never wait for a password or a dialog in an unattended run
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: 'echo' },
  });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  return { code: r.error ? -1 : r.status, out: r.error ? `${out}\n${r.error.message}`.trim() : out };
}
const git = (args, timeoutMs = 60000) => run('git', args, timeoutMs);

log(`\n===== ${stamp()} автоматичне оновлення =====`);

// ---- 1. update ----
const up = run(process.execPath, [path.join(DIR, 'paper_trade.js'), 'update'], 180000);
log(up.out);
if (up.code !== 0) {
  log(`ПОМИЛКА: оновлення завершилося з кодом ${up.code}. У git нічого не збережено.`);
  process.exit(1);
}

// ---- 2. save to git ----
function saveToGit() {
  const inside = git(['rev-parse', '--is-inside-work-tree']);
  if (inside.code !== 0 || inside.out.trim() !== 'true') return 'Ця папка не є копією репозиторію git. Журнал оновлено, але в git не збережено.';
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch.code !== 0 || branch.out.trim() !== BRANCH) return `Поточна гілка «${branch.out.trim()}», а не «${BRANCH}». Журнал оновлено, але в git не збережено.`;
  // other staged work must not be swept into the automatic commit
  const staged = git(['diff', '--cached', '--name-only']);
  if (staged.code !== 0) return `git diff не спрацював: ${staged.out}`;
  if (staged.out.trim() !== '') return 'У репозиторії вже є підготовлені до збереження чужі зміни. Автоматичне збереження пропущено, щоб їх не зачепити.';
  const changed = git(['status', '--porcelain', '--', ...FILES]);
  if (changed.code !== 0) return `git status не спрацював: ${changed.out}`;
  if (changed.out.trim() === '') {
    // nothing new locally; still try to deliver an earlier commit that could not be pushed
    const ahead = git(['rev-list', '--count', '@{u}..HEAD']);
    if (ahead.code === 0 && ahead.out.trim() === '0') return null;
  } else {
    const add = git(['add', '--', ...FILES]);
    if (add.code !== 0) return `git add не спрацював: ${add.out}`;
    const last = (fs.readFileSync(path.join(DIR, 'ledger.csv'), 'utf8').trim().split('\n').pop() || '').split(',')[1] || 'без рядків';
    const commit = git(['commit', '--only', '-m', `Paper trading: automatic ledger update (last closed day ${last})`, '--', ...FILES]);
    if (commit.code !== 0) return `git commit не спрацював: ${commit.out}`;
    log(commit.out);
  }
  let push = git(['push', 'origin', BRANCH], 120000);
  if (push.code !== 0 && /rejected|non-fast-forward|fetch first/i.test(push.out)) {
    // the branch moved on the server (another session pushed): replay our commit on top, never force
    const pull = git(['pull', '--rebase', '--autostash', 'origin', BRANCH], 120000);
    log(pull.out);
    if (pull.code !== 0) { git(['rebase', '--abort']); return `Гілка на сервері змінилася, і автоматично поєднати не вдалося. Запис збережено локально; на сервер не надіслано.`; }
    push = git(['push', 'origin', BRANCH], 120000);
  }
  if (push.code !== 0) return `Запис збережено локально, але надіслати на сервер не вдалося: ${push.out.split('\n').slice(-2).join(' ')}`;
  log(push.out);
  return null;
}

let problem = null;
try { problem = saveToGit(); } catch (e) { problem = `Несподівана помилка під час збереження в git: ${e.message}`; }
if (problem) { log(`УВАГА: ${problem}`); process.exit(2); }
log('Готово: журнал оновлено, зміни (якщо були) збережено в git.');
process.exit(0);
