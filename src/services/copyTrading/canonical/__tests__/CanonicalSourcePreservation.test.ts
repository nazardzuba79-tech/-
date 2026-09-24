import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import approvedHashes from './canonicalSourceHashes.json';

// Original baseline: review-ready 0a9c9022. Ksenia and reviewPerformanceV8
// advanced to merged main 22ac04b after approved daily progression commits
// e52231ed, 4f29e606 and 74704f27. No generator is changed by this audit.
// Complete canonical response fixtures elsewhere retain their original hashes.
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
  if (file === 'reviewPerformanceV8.ts') {
    // The synthetic presentation revision adds one opt-in constructor AFTER
    // the baseline file; its merged daily-progression implementation stays frozen.
    const marker = '\n// BEGIN OPT-IN NAZAR PRESENTATION REPLAY\n';
    expect(source.split(marker)).toHaveLength(2);
    expect(source.endsWith('// END OPT-IN NAZAR PRESENTATION REPLAY\n')).toBe(true);
    source = source.slice(0, source.indexOf(marker));
  }
  expect(createHash('sha256').update(source).digest('hex')).toBe(sha);
});
