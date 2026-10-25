/**
 * Deterministic, read-only release gate for the LOCAL xStocks candidate catalogue.
 * Does not connect to Solana, xStocks, DEX Screener or GeckoTerminal.
 * Passing provenance/structural checks NEVER authorizes a production release.
 * Run: node scripts/stocks-onchain-release-gate.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filename = p => path.join(repoRoot, p);
const addressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function readCatalogueSource(source) {
  const key = 'Object.freeze(';
  const from = source.indexOf(key);
  if (from < 0) throw Error('MISSING_CANDIDATE_ARRAY');
  const start = source.indexOf('[', from + key.length);
  const end = source.lastIndexOf(']');
  if (start < 0 || end <= start) throw Error('BAD_CANDIDATE_ARRAY');
  return JSON.parse(source.slice(start, end + 1));
}

export function readVerifiedSource(source) {
  const regex = /\{ticker:'([^']+)', name:'([^']+)', mint:'([^']+)', pool:'([^']+)'\}/g;
  const matches = [...source.matchAll(regex)];
  if (!matches.length) throw Error('MISSING_VERIFIED_POOL_SOURCE');
  return matches.map(([, ticker, name, mint, pool]) => ({ ticker, name, mint, pool }));
}

export function auditCatalog({ discovered, directOnchain, gecko }) {
  if (!Array.isArray(discovered) || !Array.isArray(directOnchain) || !Array.isArray(gecko?.markets)) {
    throw Error('INVALID_CATALOGUE_STRUCTURE');
  }
  const problems = [];
  const seenTickers = new Set(), seenMints = new Set();
  const byTicker = new Map();
  function checkAddress(value, id) {
    if (typeof value !== 'string' || !addressPattern.test(value)) problems.push('INVALID_ADDRESS:' + id);
  }
  for (const entry of discovered) {
    const { ticker, mint, pool, verifiedOnChain, tx24hReported, liquidityUSD } = entry;
    if (typeof ticker !== 'string' || !ticker) { problems.push('BAD_TICKER'); continue; }
    if (seenTickers.has(ticker)) problems.push('DUPLICATE_TICKER:' + ticker);
    if (seenMints.has(mint)) problems.push('DUPLICATE_ISSUER_MINT:' + mint);
    seenTickers.add(ticker); seenMints.add(mint); byTicker.set(ticker, entry);
    checkAddress(mint, 'MINT:' + ticker);
    checkAddress(pool, 'POOL:' + ticker);
    if (verifiedOnChain !== false) problems.push('UNPROVEN_ONCHAIN_FLAG:' + ticker);
    if (!Number.isFinite(liquidityUSD) || liquidityUSD < 0 ||
        !Number.isFinite(tx24hReported) || tx24hReported < 0) problems.push('INVALID_SNAPSHOT:' + ticker);
  }
  const directTickers = new Set();
  for (const row of directOnchain) {
    if (directTickers.has(row.ticker)) problems.push('DUPLICATE_DIRECT_PROOF:' + row.ticker);
    directTickers.add(row.ticker);
    const issuer = byTicker.get(row.ticker);
    if (!issuer || issuer.mint !== row.mint) problems.push('DIRECT_ISSUER_MINT_MISMATCH:' + row.ticker);
    checkAddress(row.pool, 'DIRECT_POOL:' + row.ticker);
  }
  const geckoTickers = new Set();
  for (const row of gecko.markets) {
    if (geckoTickers.has(row.ticker)) problems.push('DUPLICATE_GECKO_TICKER:' + row.ticker);
    geckoTickers.add(row.ticker);
    const issuer = byTicker.get(row.ticker);
    if (!issuer || issuer.mint !== row.mint) problems.push('GECKO_ISSUER_MINT_MISMATCH:' + row.ticker);
    checkAddress(row.pool, 'GECKO_POOL:' + row.ticker);
    if (row.geckoIndexed !== true) problems.push('NO_GECKO_API_MATCH:' + row.ticker);
  }
  const provenance = gecko.provenance;
  if (!provenance || typeof provenance.generatedAtUtc !== 'string' ||
      !Number.isFinite(Date.parse(provenance.generatedAtUtc))) problems.push('MISSING_SOURCE_TIMESTAMP');
  if (provenance?.rightsToRedistribute !== false ||
      provenance?.productionReady !== false ||
      provenance?.iframeRuntimeChecked !== false) problems.push('UNSAFE_RELEASE_METADATA');
  const either = new Set([...directTickers, ...geckoTickers]);
  const snapshotActive = discovered.filter(row => row.tx24hReported >= 10 && row.liquidityUSD >= 2000);
  const counts = Object.freeze({
    candidates: discovered.length,
    snapshotActivityCandidates: snapshotActive.length,
    directOnchainCheckedTickers: directTickers.size,
    geckoApiIndexedTickers: geckoTickers.size,
    withEitherExtraEvidence: either.size,
    unverifiedTickers: discovered.length - either.size,
  });
  return {
    evidenceDate: provenance?.generatedAtUtc ?? null,
    structuralStatus: problems.length ? 'FAIL' : 'PASS',
    productionDecision: 'NO_GO',
    reasons: [
      'Applicable commercial securities-chart display rights are not established.',
      'API pool indexing, iframe HTTP 200 and Canvas do not prove audited OHLCV or historical completeness.',
      'Most Solana pool owners, vault mint pairs and executed swaps are not independently verified.',
      'Stocks BUY/SELL must remain disabled for all users.',
      'Research preview must remain Vite DEV + 127.0.0.1 + opt-in flag only.',
    ],
    counts, problems,
    caveat: 'Counts are proof-level counts from historical source files, not live tradability, liquidity or production readiness.',
  };
}

export function readCurrentAudit() {
  return auditCatalog({
    discovered: readCatalogueSource(fs.readFileSync(filename('frontend/src/pages/stocks/onchainDiscoveredCandidates.ts'), 'utf8')),
    directOnchain: readVerifiedSource(fs.readFileSync(filename('frontend/src/pages/stocks/onchainEmbedPreviewData.ts'), 'utf8')),
    gecko: JSON.parse(fs.readFileSync(filename('frontend/src/pages/stocks/onchainXStocksCatalogue.generated.json'), 'utf8')),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = readCurrentAudit();
  process.stdout.write('STOCKS_RELEASE_GATE ' + JSON.stringify(report, null, 2) + '\n');
  if (process.env.STOCKS_RELEASE_GATE_OUTPUT) {
    fs.mkdirSync(path.dirname(process.env.STOCKS_RELEASE_GATE_OUTPUT), { recursive: true });
    fs.writeFileSync(process.env.STOCKS_RELEASE_GATE_OUTPUT, JSON.stringify(report, null, 2) + '\n');
  }
  if (report.structuralStatus !== 'PASS' || report.counts.candidates !== 58 ||
      report.counts.directOnchainCheckedTickers !== 7 || report.counts.geckoApiIndexedTickers !== 19) process.exitCode = 1;
}
