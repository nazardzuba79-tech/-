// Isolated CI checkout only. Never accepts DATABASE_URL as an opt-in or contacts production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const baseline = '23709c42034b928cbba226bb31f7cbb40305f32d';
const url = new URL(process.env.VOLTEX_NRX_TEST_URL || '');
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.pathname, '/voltex_nrx_test');
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Only the disposable Actions checkout is supported');
assert.equal(process.env.RUNNER_OS, 'Linux');
const files = ['src/services/syntheticProceedsFloor.ts', 'src/services/OrderService.ts', 'src/services/WithdrawalService.ts',
  'src/services/WalletTransferService.ts', 'src/otc/OtcCashService.ts', 'src/banking/service.ts'];
const saved = new Map(files.map(file => [file, fs.readFileSync(file)]));
const out = path.resolve('output/financial630');
fs.mkdirSync(out, {recursive:true});
try {
  for (const file of files) fs.writeFileSync(file, cp.execFileSync('git', ['show', `${baseline}:${file}`]));
  const result = cp.spawnSync(process.execPath, ['node_modules/jest/bin/jest.js', '--runInBand', '--json',
    `--outputFile=${out}/baseline-pg.json`, '--runTestsByPath', 'src/services/__tests__/syntheticFloorCrossLedger.pg.test.ts'],
    {encoding:'utf8', timeout:120000, env:process.env});
  fs.writeFileSync(path.join(out, 'baseline-pg.log'), (result.stdout || '') + (result.stderr || ''));
  assert.equal(result.status, 1, 'Negative control must fail its financial assertions');
  const report = JSON.parse(fs.readFileSync(path.join(out, 'baseline-pg.json'), 'utf8'));
  assert.equal(report.numTotalTests, 13);
  assert.equal(report.numPendingTests, 0);
  assert.ok(report.numFailedTests >= 6, 'Expected missing cross-ledger guards were not reproduced');
  assert.ok(report.numPassedTests >= 4, 'Positive controls and the documented policy diagnostic must actually run');
  console.log(JSON.stringify({baseline, failed:report.numFailedTests, passed:report.numPassedTests, skipped:report.numPendingTests}));
} finally {
  for (const [file, bytes] of saved) fs.writeFileSync(file, bytes);
}
