'use strict';
// Builds a review artifact only. No Docker, API, DB, flag or deployment writes.
const fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const assert = require('node:assert/strict'), ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const API_BASE = '210aefacb319374194392624d75b312b87b42e94';
const BASE_IMAGE = 'sha256:07a4c3e07ff36d17eb611e4d7a5a86bbbd1c2e36eaf7b1c9f041ef774b9d2a77';
const SOURCE = 'ad5bd1a7b9b537b9af92af6674686b663a79d5f5';
const PAGES_BASE = '6118e18e49edd226a6b250154d3893773b4522e2';
const PAGES_SOURCE = '6f6b0189feedadcd331f6733111992ce3fe5c3b6';
const runtime = ['src/api/routes/walletActivity.ts', 'src/index.ts', 'src/services/WalletConversionService.ts', 'src/services/WalletPortfolioService.ts'];
const git = (...args) => cp.execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trimEnd();
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
function main() {
  assert.equal(process.version, 'v22.23.3', 'Use the exact production Node version');
  assert.equal(git('status', '--porcelain', '--', ...runtime), '', 'Commit the exact runtime candidate before packaging it');
  cp.execFileSync('git', ['merge-base', '--is-ancestor', API_BASE, 'HEAD'], { cwd: root });
  const changedRuntime = git('diff', '--name-only', API_BASE, '--', 'src').split('\n').filter(x => x && !x.includes('/__tests__/'));
  assert.deepEqual(changedRuntime.sort(), [...runtime].sort(), 'Runtime release expanded beyond the reviewed four modules');
  for (const file of ['package.json', 'package-lock.json', 'prisma/schema.prisma']) {
    assert.equal(hash(fs.readFileSync(path.join(root, file))), hash(cp.execFileSync('git', ['show', API_BASE + ':' + file], { cwd: root })), file + ' must remain the production version');
  }
  for (const file of ['src/api/routes/walletActivity.ts', 'src/services/WalletConversionService.ts']) {
    assert.equal(fs.readFileSync(path.join(root, file), 'utf8').trimEnd(), git('show', SOURCE + ':' + file), 'Do not rewrite the merged conversion implementation');
  }
  const front = path.resolve(process.env.WALLET_RELEASE_FRONTEND_ROOT || path.join(root, '../voltex-wallet-pages'));
  const frontGit = (...args) => cp.execFileSync('git', args, { cwd: front, encoding: 'utf8' }).trimEnd();
  assert.equal(frontGit('rev-parse', 'HEAD'), PAGES_SOURCE, 'Unexpected frontend candidate');
  const frontendPaths = git('diff', '--name-only', SOURCE + '^1', SOURCE, '--', 'frontend').split('\n');
  assert.deepEqual(frontGit('diff', '--name-only', PAGES_BASE, 'HEAD').split('\n').sort(), [...frontendPaths, 'docs/AI_HANDOFF.md'].sort(), 'Frontend release expanded beyond conversion');
  for (const file of frontendPaths) assert.equal(fs.readFileSync(path.join(front, file), 'utf8').trimEnd(), git('show', SOURCE + ':' + file), 'Frontend conversion differs from the reviewed source: ' + file);
  const oldScript = git('show', API_BASE + ':ops/listings/nrx_alias_guard_api_release.py');
  const oldHashes = JSON.parse(oldScript.match(/^OLD_HASHES = (\{.*\})$/m)[1].replaceAll("'", '"'));
  const nrxPayload = JSON.parse(git('show', API_BASE + ':ops/listings/nrx-alias-guard-api/payload-sha256.json'));
  oldHashes['dist/shared/nrxRetirement.js'] = nrxPayload['dist/shared/nrxRetirement.js'];
  const parsed = ts.parseJsonConfigFileContent(ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile).config, ts.sys, root).options;
  for (const file of ['src/index.ts', 'src/services/WalletPortfolioService.ts']) {
    oldHashes[file.replace(/^src\//, 'dist/').replace(/\.ts$/, '.js')] = hash(ts.transpileModule(git('show', API_BASE + ':' + file) + '\n', { compilerOptions: parsed, fileName: file }).outputText);
  }
  // These two fingerprints were observed READ ONLY in the real running API.
  assert.equal(oldHashes['dist/index.js'], '3899fef5ecaa9c92378a50aed7e1f04d86c1f6ab939755147edf0ecd0c7934f8');
  assert.equal(oldHashes['dist/services/WalletPortfolioService.js'], '527ff48d7303860d05f73b1c9786584db6fb3b1c91f8ed27de2c2b33827242fb');
  const out = path.join(root, 'output/wallet-conversion-release');
  fs.mkdirSync(out, { recursive: true });
  const files = {};
  for (const file of runtime) {
    const compiled = file.replace(/^src\//, 'dist/').replace(/\.ts$/, '.js');
    for (const name of [compiled, compiled + '.map']) {
      const data = fs.readFileSync(path.join(root, name));
      fs.mkdirSync(path.dirname(path.join(out, name)), { recursive: true });
      fs.writeFileSync(path.join(out, name), data); files[name] = hash(data);
    }
  }
  const dockerfile = `FROM ${BASE_IMAGE}\nCOPY --chown=node:node dist/ /app/dist/\n`;
  fs.writeFileSync(path.join(out, 'Dockerfile'), dockerfile); files.Dockerfile = hash(dockerfile);
  const manifest = {
    status: 'PREPARED_NOT_DEPLOYED', apiSource: git('rev-parse', 'HEAD'), reviewedConversion: SOURCE,
    productionBase: { source: API_BASE, image: BASE_IMAGE, runtimeHashes: oldHashes },
    pages: { base: PAGES_BASE, candidate: PAGES_SOURCE, runtimePaths: frontendPaths.filter(x => !x.includes('/__tests__/')) },
    node: process.version, runtimeSourcePaths: runtime, files,
    dependenciesChanged: false, schemaChanged: false, migrationsRequired: false,
    flags: { WALLET_CONVERSION_ENABLED: 'unchanged OFF', VITE_WALLET_CONVERSION_ENABLED: 'OFF except isolated QA', WALLET_CONVERSION_RESERVES: 'must remain empty' },
    excluded: ['DB and financial writes', 'new liquidity allocations', 'listing or timer changes', 'other images/modules', 'main deployment'],
    rollback: { image: BASE_IMAGE, service: 'api-production', composeProject: 'voltex-cutover', databaseRestore: false },
  };
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  // Ship the tested default-OFF frontend itself, not just screenshots of the ON fixture.
  const frontendDist = path.join(root, 'output/wallet591-off-dist');
  assert(fs.existsSync(path.join(frontendDist, 'index.html')), 'Build the default-OFF Pages artifact first');
  const frontendFiles = {};
  const collect = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      assert(!entry.isSymbolicLink(), 'No symlinks in the frontend release');
      if (entry.isDirectory()) collect(file);
      else frontendFiles[path.relative(frontendDist, file).split(path.sep).join('/')] = hash(fs.readFileSync(file));
    }
  };
  collect(frontendDist);
  fs.writeFileSync(path.join(out, 'frontend-manifest.json'), JSON.stringify({
    status: 'PREPARED_NOT_DEPLOYED', source: PAGES_SOURCE, base: PAGES_BASE,
    flag: 'VITE_WALLET_CONVERSION_ENABLED=false', files: frontendFiles,
  }, null, 2) + '\n');
  console.log(JSON.stringify({ status: manifest.status, apiSource: manifest.apiSource, pagesSource: PAGES_SOURCE, payloadFiles: Object.keys(files).length, protectedRuntimeFingerprints: Object.keys(oldHashes).length }));
}
main();
