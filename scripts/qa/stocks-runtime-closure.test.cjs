'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyClosure } = require('./stocks-runtime-closure.cjs');
const root = path.resolve(__dirname, '../..');
test('real gateway transitive closure is included in both image stages', () => {
  const result = verifyClosure(root);
  assert.ok(result.modules.includes('services/stocks-simulator/engine.mjs'));
  assert.ok(result.modules.includes('services/stocks-global/account-worker-runtime.mjs'));
  assert.ok(result.modules.includes('services/stocks-global/authority-adapter.mjs'));
  assert.deepEqual(result.packages, ['ws']);
});
test('external dependency cannot pass without the locked node_modules runtime copy', () => {
  const recipe = fs.readFileSync(path.join(root, 'services/stocks-global/Dockerfile.release'), 'utf8');
  assert.throws(() => verifyClosure(root, recipe.replace(/^COPY --from=build \/app\/node_modules \.\/node_modules\r?\n/m, '')),
    /RUNTIME_EXTERNAL_IMPORT_UNPACKAGED .*ws/);
});
test('original missing simulator COPY and either single-stage omission fail', () => {
  const recipe = fs.readFileSync(path.join(root, 'services/stocks-global/Dockerfile.release'), 'utf8');
  const lines = recipe.split(/\r?\n/);
  const indices = lines.flatMap((line, i) => line.startsWith('COPY ') && line.includes('stocks-simulator') ? [i] : []);
  assert.equal(indices.length, 2);
  for (const remove of [indices, [indices[0]], [indices[1]]]) {
    assert.throws(() => verifyClosure(root, lines.filter((_, i) => !remove.includes(i)).join('\n')),
      /RUNTIME_MODULE_NOT_PACKAGED .*stocks-simulator\/engine.mjs/);
  }
});
test('closure follows dynamic imports, reexports and workers; missing and computed imports fail', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocks-closure-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const services = path.join(dir, 'services/stocks-global');
  fs.mkdirSync(services, { recursive: true });
  const recipe = 'FROM node AS build\nCOPY services/stocks-global ./services/stocks-global\nFROM node AS runtime\nCOPY --from=build /app/services/stocks-global ./services/stocks-global\n';
  const entry = path.join(services, 'release-entrypoint.mjs');
  for (const expression of ["import('./missing.mjs')", "export * from './missing.mjs'", "new Worker(new URL('./missing.mjs',import.meta.url))"]) {
    fs.writeFileSync(entry, expression);
    assert.throws(() => verifyClosure(dir, recipe), /RUNTIME_MODULE_MISSING/);
  }
  fs.writeFileSync(entry, 'import(variable)');
  assert.throws(() => verifyClosure(dir, recipe), /RUNTIME_DYNAMIC_IMPORT_UNREVIEWED/);
});
