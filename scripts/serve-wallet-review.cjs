/** Isolated interactive REVIEW of the Unified Trading Account page.
 *
 * The REAL built Wallet React page, the REAL native account model and the
 * REAL wallet-row projection, against an in-memory repository and a
 * deterministic market fixture. No production credentials, production
 * database, real account, exchange matching or withdrawal path is reachable.
 *
 * Two sessions are served so both halves of the page can be reviewed:
 *
 *   ?as=owner     — a Cross margin account: the header reads the authoritative
 *                   `/private-trading/native/wallet`, exactly as production does.
 *   ?as=ordinary  — a plain ledger: the header reads `/wallet/overview`, and
 *                   every margin figure is UNKNOWN rather than zero.
 *
 * `?unpriced=1` drops the quote for one held asset, so the "valuation is a
 * floor" path is reviewable instead of only described.
 */
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { NativeDemoService } = require('../dist/private-trading/native/service');
const { nativeDemoRoutes } = require('../dist/private-trading/native/routes');
const { emptyDemoState } = require('../dist/private-trading/native/store') || {};
const { emptyDemoState: emptyState } = require('../dist/private-trading/native/engine');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'frontend/dist');
const now = () => Date.now();

/** Deterministic marks. Nothing here is an account value — the page's figures
 *  are quantity x mark, so changing a price here moves every total. */
const MARKS = { BTCUSDT: '100000', ETHUSDT: '3000', XRPUSDT: '1.29' };

function quoteFor(symbol) {
  const mark = MARKS[symbol];
  if (!mark) throw new Error('NO_INSTRUMENT');
  return {
    provider: 'bybit', symbol,
    bids: [{ price: mark, quantity: '10' }], asks: [{ price: mark, quantity: '10' }],
    markPrice: mark, lastPrice: mark, fundingRate: '0.0001',
    nextFundingTime: (Math.floor(now() / 28800000) + 1) * 28800000,
    providerTimestamp: now(), bookGeneratedAt: now(), markProviderTimestamp: now(), fetchedAt: now(),
  };
}

const state = {
  /** The owner's DemoBalance rows. Initialization DEBITS the settle row. */
  holdings: [
    { asset: 'USDT', available: '5000000', locked: '0' },
    { asset: 'BTC', available: '271', locked: '2.5' },
    { asset: 'ETH', available: '561', locked: '0' },
    { asset: 'XRP', available: '1200000', locked: '0' },
  ],
  row: null,
  revisions: {},
  commands: {},
  unpriced: false,
};

const market = {
  async freshQuote(symbol) {
    // With `?unpriced=1` XRP has no quote at all — the same answer a provider
    // outage gives, and the one the collateral model must not read as zero.
    if (state.unpriced && symbol === 'XRPUSDT') throw new Error('NO_QUOTE');
    return quoteFor(symbol);
  },
  async instrument() { throw new Error('NOT_NEEDED'); },
};

class ReviewRepository {
  async read() { return state.row ? structuredClone(state.row) : null; }
  async available() { return state.row ? null : state.holdings.find((h) => h.asset === 'USDT').available; }
  async holdings() { return structuredClone(state.holdings); }
  async revision(_actor, revision) { return structuredClone(state.revisions[revision] ?? null); }
  async prior(_actor, key, hash) {
    const entry = state.commands[key];
    if (!entry) return null;
    if (entry.hash !== hash) throw new Error('IDEMPOTENCY_CONFLICT');
    return structuredClone(entry.row);
  }
  async initialize(_actor, key) {
    if (state.row) return structuredClone(state.row);
    const settle = state.holdings.find((h) => h.asset === 'USDT');
    const deposit = settle.available;
    settle.available = '0';
    const t = now();
    const row = { revision: 1, deposit, commands: [], snapshot: emptyState(deposit, t), createdAt: t, source: 'PREVIEW_FIXTURE' };
    state.row = row;
    state.revisions[1] = row;
    state.commands[key] = { hash: 'initialize', row };
    return structuredClone(row);
  }
  async commit(_actor, expected, next, key, hash) {
    const prior = await this.prior(null, key, hash);
    if (prior) return prior;
    const row = structuredClone({ ...next, revision: expected + 1 });
    state.row = row;
    state.revisions[row.revision] = row;
    state.commands[key] = { hash, row };
    return structuredClone(row);
  }
}

const service = new NativeDemoService(new ReviewRepository(), market);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

let mode = 'owner';
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

app.get('/health', (_req, res) => res.json({ status: 'ok', kind: 'isolated-wallet-review', mode }));
app.get('/__mode/:value', asyncRoute(async (req, res) => {
  mode = req.params.value === 'ordinary' ? 'ordinary' : 'owner';
  state.unpriced = req.query.unpriced === '1';
  if (req.query.opened === '0') {
    // Back to the state before the margin account exists: the settle row is
    // in the wallet again and nothing has been moved into the ledger.
    state.row = null; state.revisions = {}; state.commands = {};
    state.holdings.find((h) => h.asset === 'USDT').available = '5000000';
  }
  if (req.query.opened === '1' && !state.row) {
    await service.initialize({ userId: 'review-owner', sessionId: 'review', expiresAt: now() + 3600000 }, 'review-open-account');
  }
  res.json({ mode, unpriced: state.unpriced, opened: Boolean(state.row) });
}));

app.use('/api/v1/private-trading', (_req, res, next) => {
  // An ordinary account has no margin account at all, which is exactly the
  // 403 the production gate returns for everyone but the pinned owner.
  if (mode !== 'owner') return res.status(403).json({ error: 'Режим недоступен' });
  res.locals.actor = { userId: 'review-owner', sessionId: 'review', expiresAt: now() + 3600000 };
  next();
});
app.get('/api/v1/private-trading/access', (_req, res) =>
  res.json({ allowed: true, nativeAvailable: true, simulationOnly: true, mode: 'PRIVATE_SIMULATION' }));
app.use('/api/v1/private-trading/native', nativeDemoRoutes(service, (res) => res.locals.actor));

/** The ordinary ledger, in the shape `/wallet/overview` returns. */
app.get('/api/v1/wallet/overview', (_req, res) => {
  const spot = [
    { asset: 'USDT', available: '250', locked: '0', priceUsd: 1, valueUsd: 250 },
    { asset: 'BTC', available: '0.00412', locked: '0', priceUsd: 100000, valueUsd: 412 },
    ...(state.unpriced ? [{ asset: 'EUR', available: '700000', locked: '0', priceUsd: null, valueUsd: null }] : []),
  ];
  const spotValueUsd = spot.reduce((sum, b) => sum + (b.valueUsd ?? 0), 0);
  res.json({
    real: { spot, futures: [], spotValueUsd, futuresValueUsd: 0, totalValueUsd: spotValueUsd },
    valuationComplete: !state.unpriced,
    unpricedAssets: state.unpriced ? ['EUR'] : [],
    btcPriceUsd: 100000,
  });
});
app.get('/api/v1/wallet/performance', (_req, res) =>
  res.json({ periods: {}, ageDays: 0, startedOn: null }));
app.post('/api/v1/wallet/portfolio-snapshot', (_req, res) => res.json({ recorded: false }));
app.get('/api/v1/market/external/rankings', (_req, res) => res.json({ rankings: [
  { symbol: 'BTC', name: 'Bitcoin', price: 100000, changePercent24h: 1.24 },
  { symbol: 'ETH', name: 'Ethereum', price: 3000, changePercent24h: -0.8 },
  { symbol: 'XRP', name: 'XRP', price: 1.29, changePercent24h: 2.4 },
  { symbol: 'USDT', name: 'Tether', price: 1, changePercent24h: 0 },
] }));
app.get('/api/v1/deposits/me', (_req, res) => res.json([]));
app.get('/api/v1/withdrawals/me', (_req, res) => res.json([]));
app.get('/api/v1/trades/me', (_req, res) => res.json([]));
app.get('/api/v1/balances', (_req, res) => res.json([{ asset: 'USDT', available: '250', locked: '0' }]));
app.get('/api/v1/futures/balances', (_req, res) => res.json([]));
app.get('/api/v1/me', (_req, res) => res.json({
  id: 'review-only', email: 'review.invalid', displayName: 'Wallet Review', phone: null,
  country: null, avatarUrl: null, isAdmin: mode === 'owner', role: mode === 'owner' ? 'ADMIN' : 'USER',
  kycStatus: 'NOT_STARTED', twoFactorEnabled: false, createdAt: new Date().toISOString(),
}));
app.use('/api', (_req, res) => res.status(403).json({ error: 'Endpoint unavailable in isolated preview' }));

app.use(express.static(dist, { index: false, maxAge: 0 }));
app.get('*', (_req, res) => {
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8').replace(
    '<head>',
    '<head><script>localStorage.setItem("exchange_token","review-token");localStorage.setItem("exchange_lang","ru");</script>',
  );
  res.type('html').send(html);
});
app.use((e, _req, res, _next) => {
  console.error('[wallet-review] request failed:', e && e.stack ? e.stack : e);
  res.status(e?.status || 503).json({ error: e?.code || e?.message || 'unavailable' });
});
app.listen(Number(process.env.PORT || 4179), '0.0.0.0', () => console.log('Wallet review ready (isolated preview only)'));
