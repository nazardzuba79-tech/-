#!/usr/bin/env node
/*
 * Issue #699 — release kit for the narrow API overlay. No network, no database,
 * no secrets, nothing written outside the directory you name.
 *
 *   manifest <headDist> <baseDist> [outFile]
 *       Compare two complete builds (the base that production runs and the head
 *       to release). Fails unless the ONLY compiled differences are the release
 *       modules below. Writes SHA-256 before/after and the SHA-256 of every
 *       local module those three import ("must already be installed").
 *
 *   verify <installedDist> <manifest.json> before|after
 *       before — run against the dist/ of the image that is installed now:
 *                the changed modules still equal the recorded base build, the
 *                added module is absent and every imported module matches.
 *                Any mismatch = drift = STOP, do not overlay.
 *       after  — run against the dist/ of the built overlay image: the three
 *                release modules equal the recorded head build and every
 *                imported module still matches.
 *
 *   smoke <dist>
 *       Load the three modules from <dist> with the network blocked and check
 *       the behaviour that matters (classification, signed event, digest).
 *
 * Hashes are taken over LF-normalised text so a build made on another OS
 * compares equal when its content is equal.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const CHANGED = ['services/deposits/DepositWatchService.js', 'services/TelegramNotifications.js'];
const ADDED = ['services/deposits/depositNoticePolicy.js'];
const RELEASE = [...CHANGED, ...ADDED];

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
const walk = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full, base) : [path.relative(base, full).split(path.sep).join('/')];
});
/** Local modules a compiled file requires, as dist-relative .js paths. */
function localImports(dist, rel) {
  const text = fs.readFileSync(path.join(dist, rel), 'utf8');
  const found = new Set();
  for (const match of text.matchAll(/require\("(\.{1,2}\/[^"]+)"\)/g)) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), match[1]));
    const file = fs.existsSync(path.join(dist, `${target}.js`)) ? `${target}.js` : `${target}/index.js`;
    assert(fs.existsSync(path.join(dist, file)), `unresolved import ${match[1]} in ${rel}`);
    found.add(file);
  }
  return [...found].sort();
}

function manifest(headDist, baseDist, outFile) {
  const head = walk(headDist).filter((f) => f.endsWith('.js')), base = walk(baseDist).filter((f) => f.endsWith('.js'));
  const added = head.filter((f) => !base.includes(f)).sort(), removed = base.filter((f) => !head.includes(f)).sort();
  const changed = head.filter((f) => base.includes(f) && sha(path.join(headDist, f)) !== sha(path.join(baseDist, f))).sort();
  // The whole point: nothing but the release modules may differ.
  assert.deepEqual(changed, [...CHANGED].sort(), 'compiled modules changed outside the release scope');
  assert.deepEqual(added, [...ADDED].sort(), 'compiled modules added outside the release scope');
  assert.deepEqual(removed, [], 'a compiled module disappeared');
  const dependencies = [...new Set(RELEASE.flatMap((f) => localImports(headDist, f)))].filter((f) => !RELEASE.includes(f)).sort();
  for (const dep of dependencies) assert.equal(sha(path.join(headDist, dep)), sha(path.join(baseDist, dep)), `dependency ${dep} differs between base and head`);
  const result = {
    issue: 699, compiledModulesInBuild: head.length, compiledModulesCompared: base.length,
    changed: CHANGED.map((f) => ({ file: f, before: sha(path.join(baseDist, f)), after: sha(path.join(headDist, f)) })),
    added: ADDED.map((f) => ({ file: f, after: sha(path.join(headDist, f)) })),
    removed: [],
    mustAlreadyBeInstalledUnchanged: dependencies.map((f) => ({ file: f, sha256: sha(path.join(headDist, f)) })),
    note: 'SHA-256 over LF-normalised file text. Source maps (.js.map) of the three modules change with them and are not listed.',
  };
  const text = JSON.stringify(result, null, 2);
  if (outFile) fs.writeFileSync(outFile, text + '\n');
  console.log(text);
}

function verify(dist, manifestFile, stage) {
  assert(['before', 'after'].includes(stage), 'stage must be before or after');
  const m = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const problems = [];
  const at = (f) => path.join(dist, f);
  for (const item of m.changed) {
    if (!fs.existsSync(at(item.file))) { problems.push(`${item.file}: missing`); continue; }
    const want = stage === 'before' ? item.before : item.after;
    if (sha(at(item.file)) !== want) problems.push(`${item.file}: not the recorded ${stage === 'before' ? 'base' : 'release'} build`);
  }
  for (const item of m.added) {
    if (stage === 'before') { if (fs.existsSync(at(item.file))) problems.push(`${item.file}: already present before the release`); continue; }
    if (!fs.existsSync(at(item.file))) problems.push(`${item.file}: missing`);
    else if (sha(at(item.file)) !== item.after) problems.push(`${item.file}: not the recorded release build`);
  }
  for (const item of m.mustAlreadyBeInstalledUnchanged) {
    if (!fs.existsSync(at(item.file))) problems.push(`${item.file}: required module missing`);
    else if (sha(at(item.file)) !== item.sha256) problems.push(`${item.file}: differs from the build the release was tested with`);
  }
  const installed = walk(dist).filter((f) => f.endsWith('.js')).length;
  console.log(JSON.stringify({ stage, status: problems.length ? 'STOP' : 'OK', compiledModulesInstalled: installed,
    checked: m.changed.length + m.added.length + m.mustAlreadyBeInstalledUnchanged.length, problems }, null, 2));
  if (problems.length) process.exitCode = 1;
}

async function smoke(dist) {
  // Offline: any network attempt is a failure. No PrismaClient is constructed.
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); throw new Error('network is blocked in the smoke test'); };
  process.env.JWT_SECRET = 'release-smoke-only-not-a-production-secret-0123456789';
  const policyModule = require(path.resolve(dist, 'services/deposits/depositNoticePolicy.js'));
  const notifications = require(path.resolve(dist, 'services/TelegramNotifications.js'));
  const watcher = require(path.resolve(dist, 'services/deposits/DepositWatchService.js'));
  const policy = policyModule.noticePolicyFromEnv({});
  const now = Date.now(), HOUR = 3_600_000;
  const row = (asset, amount, ageMs) => ({ asset, amount: { toString: () => amount }, createdAt: new Date(now), blockTimestamp: ageMs === null ? null : new Date(now - ageMs) });
  assert.equal(policyModule.classifyNotice(row('TRX', '0.000001', 14 * HOUR), policy, now), 'MICRO');
  assert.equal(policyModule.classifyNotice(row('USDT', '0.5', HOUR), policy, now), 'MICRO');
  assert.equal(policyModule.classifyNotice(row('TRX', '250', 14 * HOUR), policy, now), 'FRESH');
  assert.equal(policyModule.classifyNotice(row('USDT', '700', 6 * 24 * HOUR), policy, now), 'HISTORICAL');
  assert.equal(policyModule.classifyNotice(row('USDT', '700', null), policy, now), 'TIME_UNKNOWN');
  assert.match(policyModule.digestIdFor('tron', now, policy), /^deposit-digest:tron:\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof watcher.DepositWatchService, 'function');
  assert.equal(watcher.WATCH.initialBackfillMs, 7 * 24 * HOUR, 'backfill window unchanged');
  assert.deepEqual(watcher.WATCH.schedule.slotMinutes, [720, 960, 1200], 'scan slots unchanged (12:00, 16:00, 20:00)');
  assert.equal(watcher.WATCH.schedule.dayStartMinutes, 420); assert.equal(watcher.WATCH.schedule.nightStartMinutes, 1320);
  // The signed deposit event carries the chain time; the request is built and signed locally.
  const bodies = [];
  const capture = async (url, init) => { bodies.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers }); return Response.json({ status: 'SENT' }); };
  const transfer = { id: 'smoke-deposit', amount: { toString: () => '250' }, createdAt: new Date(now), blockTimestamp: new Date(now - HOUR), asset: 'TRX', chain: 'tron',
    txHash: 'ab'.repeat(32), confirmations: 25, requiredConfirmations: 19, finalized: true, verifiedAt: new Date(now), verifyError: null };
  assert.equal(await notifications.notifyDeposit(transfer, capture), 'SENT');
  assert.equal(bodies[0].url, 'https://notify.voltextech.net/v1/deposit');
  assert.equal(bodies[0].body.blockTime, now - HOUR); assert.equal(bodies[0].body.timestamp, now);
  assert.match(bodies[0].headers['x-voltex-signature'], /^[A-Za-z0-9_-]{86}$/);
  assert.equal(await notifications.notifyDeposit({ ...transfer, blockTimestamp: null }, capture), null, 'no chain time, no alert');
  const digest = { id: policyModule.digestIdFor('tron', now, policy), createdAt: new Date(now), groups: policyModule.digestGroups([{ row: row('TRX', '0.000003', 14 * HOUR), kind: 'MICRO' }], policy, now) };
  assert.equal(await notifications.notifyDepositDigest(digest, capture), 'SENT');
  assert.equal(bodies[1].url, 'https://notify.voltextech.net/v1/deposit-digest'); assert.equal(bodies[1].body.groups[0].count, 1);
  assert.deepEqual(calls, [], 'no real network call');
  console.log(JSON.stringify({ smoke: 'OK', modulesLoaded: RELEASE, scheduleUnchanged: true, networkCalls: calls.length }));
}

const [mode, a, b, c] = process.argv.slice(2);
(async () => {
  if (mode === 'manifest' && a && b) manifest(a, b, c);
  else if (mode === 'verify' && a && b && c) verify(a, b, c);
  else if (mode === 'smoke' && a) await smoke(a);
  else { console.error('usage: manifest <headDist> <baseDist> [out] | verify <installedDist> <manifest.json> before|after | smoke <dist>'); process.exitCode = 2; }
})().catch((error) => { console.error(`release kit: ${error.message}`); process.exitCode = 1; });
