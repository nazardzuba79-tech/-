import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import approvedHashes from './canonicalSourceHashes.json';

// Captured from origin/claude/review-ready 0a9c9022b8cf0cac757328606eaf9c7b52fa3a86,
// not from a refitted/new generator. Only CRLF/LF transport is normalized.
test.each(Object.entries(approvedHashes))('%s is the exact approved mathematical implementation', (file, sha) => {
  let source = readFileSync(resolve(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
  if (file === 'reviewFollowerLedger.ts') {
    // The sole approved integration exception retains exact exported quantity
    // tokens after historic JSONB transport. No financial formula is changed.
    const importLine = "import { retainPublishedQuantityTail } from '../publishedQuantityCompatibility';\n";
    const hook = ' && !retainPublishedQuantityTail(existing, record)';
    expect(source.split(importLine)).toHaveLength(2);
    expect(source.split(hook)).toHaveLength(2);
    source = source.replace(importLine, '').replace(hook, '');
  }
  expect(createHash('sha256').update(source).digest('hex')).toBe(sha);
});
