#!/usr/bin/env node
// READ ONLY: GET the existing admin resolver, or convert a complete DOM export
// from that same authenticated legacy admin page. Never loads .env / Prisma,
// calls a blockchain, seeds a Worker, or sends any mutation.
const { readFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { DEPOSIT_RAILS } = require('../dist/services/depositCatalogue/registry');
const { documentSchema } = require('../dist/services/depositCatalogue/schema');
const chains = ['bitcoin', 'tron', 'ethereum', 'bsc', 'solana', 'ton'];
const names = { bitcoin: 'Bitcoin Network', tron: 'TRON', ethereum: 'Ethereum', bsc: 'BNB Smart Chain', solana: 'Solana', ton: 'TON' };

function convertRows(rows) {
  return rows.map(row => {
    const rail = DEPOSIT_RAILS.find(r => r.asset === row.asset && r.networkName === row.networkName && r.standard === row.standard);
    if (!rail) throw new Error(`Unmapped legacy rail: ${row.asset}/${row.networkName}/${row.standard}; review required, nothing omitted`);
    // Copy destinations verbatim. Validation may reject, never silently repair.
    if (typeof row.address !== 'string' || row.address !== row.address.trim()) throw new Error('Invalid or padded address; owner review required');
    return { assetId: rail.assetId, networkId: rail.networkId, address: row.address, enabled: !!row.address, memo: '', memoLabel: '' };
  });
}
function fromAdminWallets(wallets) {
  if (!Array.isArray(wallets) || wallets.length !== chains.length || new Set(wallets.map(w => w.chain)).size !== chains.length ||
    chains.some(c => !wallets.some(w => w.chain === c))) throw new Error('Incomplete legacy chain inventory');
  const rows = [], unconfigured = [];
  for (const w of wallets) {
    if (typeof w.envConfigured !== 'boolean' || !Array.isArray(w.tokens)) throw new Error('Invalid legacy chain response');
    if (!w.envConfigured) {
      if (w.address) throw new Error(`Unconfigured chain ${w.chain} has an override; review required`);
      unconfigured.push(w.chain); continue;
    }
    if (typeof w.nativeDepositsSupported !== 'boolean' || typeof w.nativeAsset !== 'string') throw new Error('Missing legacy asset support');
    const assets = [...(w.nativeDepositsSupported ? [w.nativeAsset] : []), ...w.tokens];
    if (new Set(assets).size !== assets.length) throw new Error('Duplicate legacy asset');
    for (const asset of assets) rows.push({ asset, networkName: names[w.chain], address: w.address ?? '',
      standard: asset === w.nativeAsset ? 'Native' : ({ ethereum: 'ERC-20', bsc: 'BEP-20', tron: 'TRC-20', solana: 'SPL', ton: 'Jetton' })[w.chain] });
  }
  return { entries: convertRows(rows), unconfigured };
}
function fromUiSnapshot(snapshot) {
  const url = new URL(snapshot.sourceUrl);
  if (url.protocol !== 'https:' || url.pathname !== '/admin/wallets' || !Array.isArray(snapshot.rows) ||
    snapshot.totalRails !== snapshot.rows.length) throw new Error('Incomplete authenticated admin DOM snapshot');
  const missingNote = snapshot.notes.find(n => n.startsWith('Не настроены на backend: '));
  const missing = missingNote ? missingNote.slice('Не настроены на backend: '.length).split('. Поддерживаемые')[0].split(', ') : [];
  const unconfigured = missing.map(n => {
    const chain = chains.find(c => names[c] === n); if (!chain) throw new Error('Unknown unconfigured chain'); return chain;
  });
  const entries = convertRows(snapshot.rows);
  const configured = new Set(entries.map(e => e.networkId));
  if (configured.size !== snapshot.totalNetworks || unconfigured.some(c => configured.has(c)) ||
    chains.some(c => !configured.has(c) && !unconfigured.includes(c))) throw new Error('UI inventory does not cover all legacy chains');
  if (snapshot.rows.some(r => !['Адрес задан', 'Не задан'].includes(r.status))) throw new Error('Unknown address status');
  return { entries, unconfigured };
}
async function fetchAdminWallets(base, token, transport = fetch) {
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !token) throw new Error('Expected HTTPS API base and admin credential in environment');
  const response = await transport(`${url.href.replace(/\/$/, '')}/admin/wallets`, {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(8000), cache: 'no-store', headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Read-only export refused (HTTP ${response.status})`);
  return response.json();
}
function buildReview(source, inventory, capturedAt) {
  const document = documentSchema.parse({ schemaVersion: 1, baseline: inventory.entries, overrides: [] });
  return { purpose: 'OWNER REVIEW ONLY — NOT SEEDED OR ACTIVATED', source, capturedAt,
    verified: 'Resolved configuration captured; address ownership and activation require owner review',
    unconfiguredChains: inventory.unconfigured, rails: document.baseline.length,
    sha256: createHash('sha256').update(JSON.stringify(document)).digest('hex'), document };
}
async function main(args) {
  const value = flag => args[args.indexOf(flag) + 1];
  if (!args.includes('--out') || args.includes('--ui-snapshot') === args.includes('--api-base')) throw new Error('Use --out FILE and exactly one of --api-base HTTPS_URL or --ui-snapshot FILE');
  let inventory, source, capturedAt;
  if (args.includes('--ui-snapshot')) {
    const snapshot = JSON.parse(readFileSync(value('--ui-snapshot'), 'utf8').replace(/^\uFEFF/, ''));
    inventory = fromUiSnapshot(snapshot); source = { mode: 'authenticated legacy admin DOM (backend-resolved)', url: snapshot.sourceUrl };
    capturedAt = snapshot.capturedAt;
  } else {
    inventory = fromAdminWallets(await fetchAdminWallets(value('--api-base'), process.env.VOLTEX_BASELINE_ADMIN_TOKEN));
    source = { mode: 'GET legacy admin resolver', url: `${value('--api-base')}/admin/wallets` }; capturedAt = new Date().toISOString();
  }
  const review = buildReview(source, inventory, capturedAt);
  // Exclusive creation protects a previous reviewed snapshot from replacement.
  writeFileSync(value('--out'), JSON.stringify(review, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`READ-ONLY baseline written: ${value('--out')} (${review.rails} rails; owner review pending). No remote writes.`);
}
module.exports = { fromAdminWallets, fromUiSnapshot, fetchAdminWallets, buildReview };
if (require.main === module) main(process.argv.slice(2)).catch(error => {
  // Do not print transport errors, raw response bodies or credential values.
  console.error(error instanceof TypeError ? 'Export failed; check connection/configuration. No baseline written.' : error.message);
  process.exitCode = 1;
});
