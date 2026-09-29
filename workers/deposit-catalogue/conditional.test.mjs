// If-None-Match weak comparison for the public read (RFC 9110 §13.1.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ifNoneMatchHits, parseIfNoneMatch } from './src/conditional.js';

const v = 'a'.repeat(64), other = 'b'.repeat(64), etag = `"${v}"`;

test('the same version matches whether either side is weak', () => {
  for (const header of [`"${v}"`, `W/"${v}"`, `  W/"${v}"  `]) assert.equal(ifNoneMatchHits(header, etag), true, header);
  assert.equal(ifNoneMatchHits(`"${v}"`, `W/"${v}"`), true);
});

test('lists, optional whitespace, empty elements and "*"', () => {
  assert.equal(ifNoneMatchHits(`"${other}", W/"${v}"`, etag), true);
  assert.equal(ifNoneMatchHits(`W/"${other}",W/"${v}"`, etag), true);
  assert.equal(ifNoneMatchHits(` , "${other}" ,\t, "${v}" , `, etag), true);
  assert.equal(ifNoneMatchHits('*', etag), true);
  assert.equal(ifNoneMatchHits('  *  ', etag), true);
});

test('another version, or a list without it, gets the full answer', () => {
  assert.equal(ifNoneMatchHits(`"${other}"`, etag), false);
  assert.equal(ifNoneMatchHits(`W/"${other}", "${'c'.repeat(64)}"`, etag), false);
  assert.equal(ifNoneMatchHits(null, etag), false);
  assert.equal(ifNoneMatchHits('', etag), false);
});

test('malformed values never produce a false match', () => {
  for (const header of [
    v,                        // unquoted
    `W/"${v}`,                // unterminated
    `w/"${v}"`,               // W/ is case-sensitive
    `W/ "${v}"`,              // space inside the weak prefix
    `"${v}" "${v}"`,          // missing comma
    `"${v}"x`,                // trailing garbage
    `"${v.slice(0, 10)}\u0001"`, // control character
    `*, "${v}"`,              // "*" is only valid alone
    `"${v}", *`,
    ',',                      // no tag at all
  ]) {
    assert.equal(parseIfNoneMatch(header), null, JSON.stringify(header));
    assert.equal(ifNoneMatchHits(header, etag), false, JSON.stringify(header));
  }
});
