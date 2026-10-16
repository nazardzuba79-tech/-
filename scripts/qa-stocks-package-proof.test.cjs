'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { closure, sha } = require('./qa-stocks-package-builder.cjs');
const { assertTraderPolicyClosure } = require('./qa-stocks-package-proof.cjs');
const root = path.resolve(__dirname, '..');
const policy = 'services/stocks-global/trader-policy.mjs';

test('actual AST runtime closure retains the exact current two-trader policy bytes', () => {
  const manifest = closure(root);
  assert.equal(assertTraderPolicyClosure(manifest), true);
  const retained = manifest.files.find(file => file.path === policy), bytes = fs.readFileSync(path.join(root, policy));
  assert.equal(retained.bytes, bytes.length);
  assert.equal(retained.sha256, sha(bytes));
});

test('missing, detached, duplicated or unhashed admission policy cannot pass package proof', () => {
  const manifest = closure(root), retained = manifest.files.find(file => file.path === policy);
  assert.throws(() => assertTraderPolicyClosure({ ...manifest, files: manifest.files.filter(file => file.path !== policy) }), /exactly one two-trader policy/);
  assert.throws(() => assertTraderPolicyClosure({ ...manifest, edges: manifest.edges.filter(edge => edge.to !== policy) }), /server admission imports/);
  assert.throws(() => assertTraderPolicyClosure({ ...manifest, files: [...manifest.files, retained] }), /exactly one two-trader policy/);
  assert.throws(() => assertTraderPolicyClosure({ ...manifest, files: manifest.files.map(file => file.path === policy ? { ...file, sha256: null } : file) }), /byte\/hash provenance/);
});
