'use strict';
// Preparation/verification ONLY. Never deploys and never reads credentials.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const profiles = require('../frontend/wallet591-profiles.json');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const scopeBase = '6f6b0189feedadcd331f6733111992ce3fe5c3b6';
const allowed = ['frontend/vite.config.ts','frontend/wallet591-profiles.json','scripts/wallet591-frontend-artifact.cjs','scripts/qa-wallet591-release.cjs','scripts/test-wallet591-artifact.cjs','.github/workflows/wallet-conversion-release-qa.yml','docs/WALLET591_FRONTEND_INCIDENT_FIX.md','docs/AI_HANDOFF.md'];
function scope() {
  git('merge-base','--is-ancestor',scopeBase,'HEAD');
  const changed=git('diff','--name-only',scopeBase,'HEAD').split('\n').filter(Boolean);
  assert(changed.length && changed.every(f=>allowed.includes(f)), 'Candidate exceeds approved release mechanism scope');
  assert.equal(git('status','--porcelain','--untracked-files=no'),'','Candidate has uncommitted tracked changes');
  return changed;
}
function releaseEnv(env, profile) {
  assert(profiles[profile], 'Unknown release profile');
  for(const [key,value] of Object.entries(env))if(key.startsWith('VITE_'))assert.equal(value,profiles[profile].env[key],`Conflicting or unreviewed inherited ${key}`);
  return {...env,...profiles[profile].env};
}
function files(dir) {
  const result = {};
  function walk(at) {
    for (const name of fs.readdirSync(at).sort()) {
      const file = path.join(at, name), stat = fs.lstatSync(file);
      assert(!stat.isSymbolicLink(), 'Artifact may not contain symlinks');
      if (stat.isDirectory()) walk(file);
      else result[path.relative(dir, file).replaceAll('\\', '/')] = hash(fs.readFileSync(file));
    }
  }
  walk(dir); return result;
}
function validateProof(proof, result) {
  assert.equal(proof.status, 'PASS'); assert.equal(proof.assetDigest, result.assetDigest);
  assert.equal(proof.source, result.source); assert.equal(proof.profile, result.profile);
  assert.deepEqual(proof.widths, [1440, 390]);
  assert.equal(proof.evidenceScope, 'ISOLATED_BROWSER_SYNTHETIC_RESPONSES');
  assert.equal(proof.productionAuthenticatedQA, 'NOT_RUN');
  assert(proof.negativeControl && proof.noConversionRequests && proof.noExternalRequests);
  const names=['Admin','Spot','Wallet','Banking','Futures','KYC','Spot-balances-open-orders-503',
    'Admin-401','Admin-403','Admin-503','Admin-network','Guest-authentication',
    ...['en','ru','zh','es','hi','ja','ko'].map(lang=>`Wallet-locale-${lang}`)];
  assert.equal(proof.cases.length,names.length*2,'Incomplete browser coverage');
  for(const width of [1440,390])for(const name of names)
    assert.equal(proof.cases.filter(c=>c.name===name&&c.width===width&&c.status==='PASS').length,1,`Missing browser case ${name}/${width}`);
}
function audit(dir, profile) {
  const config = profiles[profile]; assert(config, 'Unknown release profile');
  const all = files(dir); assert(all['index.html']);
  const chunks = Object.keys(all).filter(f => f.endsWith('.js'));
  const js = chunks.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  // Inspect emitted application bytes, not a claimed flag or a .env file.
  for (const key of ['VITE_API_URL', 'VITE_MARKET_EDGE_URL', 'VITE_KYC_EDGE_URL', 'VITE_DEPOSIT_CATALOGUE_URL']) {
    assert(js.includes(JSON.stringify(config.env[key])), `Compiled JS missing ${key} for ${profile}`);
  }
  // Terminal dependencies contain relative defaults subsequently configured by
  // the application. Check the executed request origins in browser QA instead
  // of rejecting unused defaults (or trusting a matching string alone).
  assert(!/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/api/.test(js), 'Loopback API in release');
  const other = profiles[profile === 'production' ? 'ru' : 'production'];
  assert(!js.includes(JSON.stringify(other.env.VITE_API_URL)), 'Other region API compiled into release');
  const receipt = JSON.parse(fs.readFileSync(path.join(dir, 'release-build.json')));
  assert.equal(receipt.profile, profile); assert.deepEqual(receipt.env, config.env);
  assert.equal(receipt.source, git('rev-parse', 'HEAD'));
  const graph=JSON.parse(fs.readFileSync(path.join(dir,'.vite','manifest.json')));
  assert(Object.keys(graph).length>0,'Empty Vite asset graph');
  for(const item of Object.values(graph)) {
    for(const asset of [item.file,...(item.css||[]),...(item.assets||[])])assert(all[asset],`Missing graph asset ${asset}`);
    for(const ref of [...(item.imports||[]),...(item.dynamicImports||[])])assert(graph[ref],`Missing graph import ${ref}`);
  }
  // Each local HTML asset reference must exist. Browser QA also loads route chunks.
  for (const file of Object.keys(all).filter(f => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const [, asset] of html.matchAll(/(?:src|href)=["'](\/assets\/[^"'?#]+)/g)) assert(all[asset.slice(1)], `Missing asset ${asset}`);
  }
  return { profile, source: receipt.source, env: receipt.env, files: all, assetDigest: hash(JSON.stringify(all)) };
}
async function main() {
  const [command, profile = 'production'] = process.argv.slice(2);
  assert(profiles[profile], 'Specify production or ru');
  const dist = path.join(root, 'output', `wallet591-${profile}-dist`);
  if (command === 'build') {
    const env = releaseEnv(process.env,profile);
    Object.assign(process.env, env, { VOLTEX_RELEASE_PROFILE: profile, VOLTEX_RELEASE_SOURCE: git('rev-parse', 'HEAD') });
    const { build } = await import('../frontend/node_modules/vite/dist/node/index.js');
    await build({ root: path.join(root, 'frontend'), envDir: false, build: { outDir: dist, emptyOutDir: true, manifest:true } });
    const result = audit(dist, profile);
    console.log(JSON.stringify({ profile, assets: Object.keys(result.files).length, assetDigest: result.assetDigest }));
  } else if (command === 'audit') {
    console.log(JSON.stringify(audit(process.argv[4] ? path.resolve(process.argv[4]) : dist, profile)));
  } else if (command === 'seal') {
    const changed=scope();
    const result = audit(dist, profile);
    const proof = JSON.parse(fs.readFileSync(path.join(root, 'output', `wallet591-${profile}-qa`, 'report.json')));
    validateProof(proof,result);
    assert.equal(git('status', '--porcelain', '--untracked-files=no'), '', 'Commit reviewed changes before sealing');
    const manifest = { ...result, status: 'TESTED_CANDIDATE_NOT_DEPLOYED', flag: false,
      scopeBase, changed,
      productionLease: { deployment: '95010b1c-b13f-4c52-b08c-a90ffa7d5d60', source: '6118e18e49edd226a6b250154d3893773b4522e2' },
      browserProof: hash(JSON.stringify(proof)), productionAuthenticatedQA: 'NOT_RUN', deploymentAuthorization: 'REQUIRED' };
    fs.writeFileSync(path.join(root, 'output', `wallet591-${profile}-manifest.json`), JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify({ status: manifest.status, source: result.source, assetDigest: result.assetDigest }));
  } else if(command==='verify') {
    scope();
    const result=audit(dist,profile);
    const manifest=JSON.parse(fs.readFileSync(path.join(root,'output',`wallet591-${profile}-manifest.json`)));
    const proof=JSON.parse(fs.readFileSync(path.join(root,'output',`wallet591-${profile}-qa`,'report.json')));
    validateProof(proof,result);
    assert.deepEqual(result.files,manifest.files,'Sealed assets were modified');
    assert.equal(result.source,manifest.source);assert.equal(result.assetDigest,manifest.assetDigest);
    assert.equal(hash(JSON.stringify(proof)),manifest.browserProof,'Browser proof changed');
    assert.equal(manifest.flag,false);assert.equal(manifest.status,'TESTED_CANDIDATE_NOT_DEPLOYED');
    console.log(JSON.stringify({status:'VERIFIED_NOT_DEPLOYED',source:result.source,profile,assets:Object.keys(result.files).length,assetDigest:result.assetDigest}));
  } else if(command==='scope')console.log(JSON.stringify({scopeBase,changed:scope()}));
  else throw Error('Expected build, audit, seal, verify or scope');
}
module.exports = { audit, files, hash, profiles, root, releaseEnv, validateProof };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
