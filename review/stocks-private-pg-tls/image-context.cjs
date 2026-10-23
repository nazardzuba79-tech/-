'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
function excluded(file) { return /(^|\/)(__tests__|__mocks__|review|docs|\.git)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$|\.md$/.test(file); }
function stage(source, output) {
  assert.ok(!fs.existsSync(output)); fs.mkdirSync(output);
  const files = {};
  function copy(relative) {
    if (excluded(relative)) return;
    const from = path.join(source, relative), to = path.join(output, relative), stat = fs.lstatSync(from);
    assert.ok(!stat.isSymbolicLink(), 'NO_CONTEXT_SYMLINKS');
    if (stat.isDirectory()) { fs.mkdirSync(to, { recursive: true }); for (const child of fs.readdirSync(from)) copy(relative + '/' + child); }
    else { fs.mkdirSync(path.dirname(to), { recursive: true }); const bytes = fs.readFileSync(from); fs.writeFileSync(to, bytes); files[relative] = crypto.createHash('sha256').update(bytes).digest('hex'); }
  }
  for (const file of ['package.json','package-lock.json','tsconfig.json','src','services/stocks-global',
    'services/stocks-simulator/engine.mjs','prisma/schema.prisma','stocks-release-migrations',
    'scripts/qa/stocks-runtime-closure.cjs','scripts/qa/stocks-migration-review.cjs','scripts/qa/stocks-release-package.cjs']) copy(file);
  assert.ok(files['src/api/middleware/stocksAuthorityIngress.ts']);
  return files;
}
module.exports = { stage, excluded };
