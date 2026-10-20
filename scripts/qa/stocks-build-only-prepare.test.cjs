'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { exactBytes, hash, validateManifest, MANIFEST_SHA } = require('./stocks-build-only-prepare.cjs');

const row = bytes => ({ migration_name: '20260101000000_example', bytes: bytes.length, sha256: hash(bytes) });
test('raw equality needs BOTH bytes and SHA; preserves the input bytes', () => {
  const bytes = Buffer.from('SELECT 1;\r\n');
  const result = exactBytes(bytes, row(bytes));
  assert.equal(result.result.status, 'RAW_MATCH');
  assert.equal(result.bytes, bytes);
  assert.throws(() => exactBytes(bytes, { ...row(bytes), bytes: bytes.length + 1 }), /SQL_BYTE_MISMATCH.*20260101000000_example/);
});
test('only LF insertion may derive exact attested bytes, without mutating source', () => {
  const input = Buffer.from('SELECT 1;\nSELECT 2;\r\n'), copy = Buffer.from(input);
  const expected = Buffer.from('SELECT 1;\r\nSELECT 2;\r\n');
  const result = exactBytes(input, row(expected));
  assert.equal(result.result.status, 'EXACT_BYTES_DERIVED_AND_HASH_VERIFIED');
  assert.deepEqual(result.bytes, expected);
  assert.deepEqual(input, copy);
});
test('same-length changed SQL is a fatal mismatch with exact file/hash evidence', () => {
  const expected = Buffer.from('SELECT 1;\r\n');
  assert.throws(() => exactBytes(Buffer.from('SELECT 2;\n'), row(expected)),
    error => /SQL_BYTE_MISMATCH/.test(error.message) && error.message.includes(hash(expected)) &&
      error.message.includes('20260101000000_example'));
});
test('bare CR is not silently normalized', () => {
  assert.throws(() => exactBytes(Buffer.from('SELECT 1;\r'), row(Buffer.from('SELECT 1;\r\n'))), /SQL_BYTE_MISMATCH/);
});
test('attested manifest stays exactly pinned, has 44 unique safe names and integer lengths', () => {
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/stocks-production-files-20261020.json'));
  assert.equal(hash(bytes), MANIFEST_SHA);
  const rows = JSON.parse(bytes);
  validateManifest(rows);
  assert.throws(() => validateManifest(rows.slice(1)), /INVALID_ATTESTED/);
  assert.throws(() => validateManifest([rows[0], ...rows.slice(0, 43)]), /INVALID_ATTESTED/);
  assert.throws(() => validateManifest([{ ...rows[0], migration_name: '../escape' }, ...rows.slice(1)]), /INVALID_ATTESTED/);
  assert.throws(() => validateManifest([{ ...rows[0], bytes: 1.5 }, ...rows.slice(1)]), /INVALID_ATTESTED/);
});
