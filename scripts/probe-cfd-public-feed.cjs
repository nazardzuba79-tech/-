'use strict';
// Seven credential-free HTTP requests, fixed public endpoints only. No production
// backend, user account, database, keys or financial operations are accessed.
const { mkdirSync, writeFileSync } = require('node:fs');
const { PublicReferenceFeed } = require('../dist/services/marketData/cfd/PublicReferenceFeed');
(async () => {
  const feed = new PublicReferenceFeed({ enabled: true });
  await feed.refreshDue();
  const references = feed.snapshot();
  const report = { checkedAt: new Date().toISOString(), revision: process.env.GITHUB_SHA ?? null,
    executionAllowed: false, statement: 'Daily/indicative reference coverage, NOT double-live CFD coverage',
    count: references.length, diagnostics: feed.diagnostics(), references };
  mkdirSync('docs/qa/cfd-multi-provider', { recursive: true });
  writeFileSync('docs/qa/cfd-multi-provider/public-feed.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (references.length !== 13 || report.diagnostics.some(t => t.error !== null)) process.exitCode = 1;
})().catch(() => { console.error('Public feed probe failed; no execution or deployment performed.'); process.exitCode = 1; });
