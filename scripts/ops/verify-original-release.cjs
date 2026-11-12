'use strict';
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
process.chdir(root);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-706-'));
const before = path.join(work, 'before');
const ai = path.join(work, 'ai');
const out = path.join(work, 'candidate');
const inputs = require('./original-release-inputs.json');
const expected = require('./original-release-manifest.json');
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
const revisions = {
  'dist/services/testMarkets/testMarketSimulation.js': '41a755a9e163d278e786202be61627697149eb2a',
  'dist/services/listings/ownerAllocation.js': '6f082a98d0c97c28215e6c5c8056b786d6fa6c99',
  'dist/services/testMarkets/nrxSpot.js': '85f6122b7ac0aa3ce72a2af9ac9aac13d814e44d',
  'dist/services/WalletPortfolioService.js': 'b7503b6f7929920f61c961df807ec5c4c630e65a',
};

try {
  cp.execFileSync(process.execPath, ['scripts/ops/build-ai-listing-overlay.cjs'], {
    env: { ...process.env, AI_RELEASE_OUT: ai }, stdio: 'inherit',
  });
  for (const [name, expectedHash] of Object.entries(inputs)) {
    const sourcePath = name.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts');
    const rev = revisions[name];
    let bytes;
    if (rev) {
      const src = cp.execFileSync('git', ['show', rev + ':' + sourcePath], { encoding: 'utf8' });
      bytes = Buffer.from(ts.transpileModule(src, {
        fileName: path.basename(sourcePath),
        compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS,
          esModuleInterop: true, sourceMap: true, newLine: ts.NewLineKind.LineFeed },
      }).outputText);
    } else {
      bytes = fs.readFileSync(path.join(ai, name.replace(/^dist\//, 'api/')));
    }
    assert.equal(hash(bytes), expectedHash, name + ' differs from production');
    const dest = path.join(before, name);
    fs.mkdirSync(path.dirname(dest), {recursive:true});
    fs.writeFileSync(dest, bytes);
  }
  cp.execFileSync(process.execPath, ['scripts/ops/build-original-release.cjs', before, out, 'scripts/ops/original-release-inputs.json'], { stdio:'inherit' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out,'manifest.json'))), expected);
  const recovery = path.join(work,'recovery');
  cp.execFileSync(process.execPath, ['scripts/ops/build-original-recovery.cjs', before, out, recovery], {stdio:'inherit'});
  cp.execFileSync(process.execPath, ['scripts/ops/test-original-recovery.cjs', before, out, recovery], {stdio:'inherit'});
  console.log('PASS all sealed API and Worker inputs and outputs match the release manifest');
} finally {
  fs.rmSync(work, {recursive:true, force:true});
}
