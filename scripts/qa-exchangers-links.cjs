#!/usr/bin/env node
/*
 * Issue #694 — re-check the BestChange direction pages /exchangers may link to
 * without server data (src/shared/exchangers/verifiedDirections.ts).
 *
 *   node scripts/qa-exchangers-links.cjs            every listed direction must answer 200
 *   node scripts/qa-exchangers-links.cjs --discover also probe catalogue directions that are NOT listed
 *
 * HEAD requests only: the status code is the whole check (an unknown direction
 * answers 301 to the home page). No page content is requested, read or parsed,
 * nothing is stored, and the requests are paced. Not part of CI: CI never
 * depends on an external site. Run it by hand before a release.
 */
require('ts-node/register/transpile-only');
const { VERIFIED_DIRECTIONS } = require('../src/shared/exchangers/verifiedDirections');
const { RUB_METHODS, RECEIVE_PAIRS } = require('../src/shared/exchangers/catalog');
const { buildDirectionUrl, isDirectionUrl } = require('../src/shared/exchangers/links');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function status(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { method: 'HEAD', redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (compatible; VOLTEX-link-check/1.0)' }, signal: AbortSignal.timeout(20_000) });
    if (res.status !== 429) return res.status;
    await sleep(20_000);
  }
  return 429;
}

(async () => {
  const discover = process.argv.includes('--discover');
  const listed = Object.entries(VERIFIED_DIRECTIONS).flatMap(([from, tos]) => tos.map((to) => [from, to]));
  const candidates = discover
    ? RUB_METHODS.flatMap((m) => [...new Set(RECEIVE_PAIRS.flatMap((p) => p.match.urlnames))].map((to) => [m.urlname, to])).filter(([f, t]) => !listed.some(([a, b]) => a === f && b === t))
    : [];
  const bad = [], found = [];
  for (const [from, to] of [...listed, ...candidates]) {
    const url = buildDirectionUrl(from, to);
    if (!url || !isDirectionUrl(url)) { bad.push(`${from}-to-${to}: not a valid direction link`); continue; }
    const code = await status(url);
    const isListed = listed.some(([a, b]) => a === from && b === to);
    if (isListed && code !== 200) bad.push(`${from}-to-${to}: HTTP ${code}`);
    if (!isListed && code === 200) found.push(`${from}-to-${to}`);
    await sleep(4_000);
  }
  console.log(JSON.stringify({ listed: listed.length, failed: bad, ...(discover ? { answering200ButNotListed: found } : {}) }, null, 2));
  if (bad.length) process.exitCode = 1;
})().catch((error) => { console.error(`link check failed: ${error.message}`); process.exitCode = 1; });
