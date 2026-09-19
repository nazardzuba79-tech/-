/**
 * Browser QA for issue #144: what a customer actually reads when the API
 * misbehaves, on the real production bundle.
 *
 * The three states the audit names, on /futures, /wallet, /copy-trading,
 * /trade and /settings:
 *
 *   normal   — every request answered, so the page is in its ordinary shape
 *              and the vocabulary check runs against a full screen;
 *   failing  — every request answered 500 with an HTML error page, a stack
 *              and an engine code in the body, which is the exact payload
 *              that used to be rendered verbatim;
 *   partial  — requests answered, but with nulls where a price or a figure
 *              would be, which is where "unknown" must not become "0".
 *
 * There is no backend here on purpose. Every `/api/` call is answered by
 * this harness, so the failing state is produced rather than waited for,
 * and the assertion is about the SCREEN, not about the network.
 */
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const DIST = path.resolve(__dirname, '../frontend/dist');
const OUT = process.env.QA_OUT || '/tmp/qa-customer-error-wording';
fs.mkdirSync(OUT, { recursive: true });

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail.slice(0, 200) : ''}`);
};

/** The payload a broken route really sends: a page, a stack, and a code. */
const HTML_ERROR_BODY = [
  '<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>',
  '<h1>502 Bad Gateway</h1><pre>Error: connect ECONNREFUSED 10.0.0.7:5432',
  '    at TCPConnectWrap.afterConnect (node:net:1595:16)',
  '    at PrismaClient._request (/srv/node_modules/@prisma/client/runtime/library.js:121:15)</pre>',
  '<p>DATABASE_URL=postgres://voltex:hunter2@db.internal:5432/voltex</p>',
  '<p>INTERNAL_ENGINE_FAULT_V2</p></body></html>',
].join('\n');

/**
 * Vocabulary that must never be on screen, whatever went wrong.
 *
 * Each entry is something a customer cannot act on and should never have
 * been shown: a transport detail, a file position, a connection string, an
 * engine identifier, or the markup of somebody else's error page.
 */
const BANNED = [
  ['an HTTP status line', /\bHTTP\/\d\.\d\b|\b502 Bad Gateway\b|\b500 Internal Server Error\b/],
  ['a stack frame', /\bat [A-Za-z_$][\w$.]* \(|node:net:\d+|:\d+:\d+\)/],
  ['a source location', /\.(?:ts|tsx|js|cjs|mjs):\d+/],
  ['a connection string or env var', /DATABASE_URL|postgres:\/\/|process\.env/i],
  ['a socket failure', /\bECONNREFUSED\b|\bENOTFOUND\b|\bETIMEDOUT\b|\bEAI_AGAIN\b/],
  ['an engine or machine code', /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+){2,}\b/],
  ['transport plumbing', /\bwebsocket\b|\bendpoint\b|\bbackend\b|\bprisma\b|\bapi error\b/i],
  ['the transport’s own boilerplate', /Request failed \(\d+\)/i],
  ['a runtime fault', /is not a function|Cannot read propert|undefined is not/i],
  ['a schema report', /String must contain|Expected \w+, received/],
];

/** Wording that would claim something the server never confirmed. */
const FALSE_CLAIM = /успешно выполнен|операция завершена|заявка принята сервером/i;

const ROUTES = [
  { path: '/futures', label: 'futures' },
  { path: '/wallet', label: 'wallet' },
  { path: '/copy-trading', label: 'copy-trading' },
  { path: '/trade', label: 'trade' },
  { path: '/settings', label: 'settings' },
];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(DIST, url);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/**
 * What each state answers an API call with.
 *
 * The fixtures are shaped like the real routes, because a page that falls
 * to its error boundary proves nothing about wording: the boundary's own
 * text would be all that was ever checked. `normal` therefore renders the
 * real screens, `partial` answers 200 with every figure null — the request
 * WORKED and the number is unknown, which is where a zero would be a lie —
 * and `failing` answers 502 with the payload that used to be shown
 * verbatim.
 */
const TICKER = (pair) => ({
  pair, lastPrice: '65000.00', bidPrice: '64999.00', askPrice: '65001.00',
  high24h: '66000.00', low24h: '64000.00', volume24h: '1200.5', quoteVolume24h: '78000000',
  changePercent24h: '2.10',
});
const PAIRS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT'];

const gateway = (value, available) =>
  available ? { available: true, value, source: 'qa', fetchedAt: Date.now(), stale: false }
            : { available: false, reason: 'provider_unavailable', detail: 'Данные не получены.' };

function fixture(pathname, nulls) {
  const on = !nulls;
  // `/orders/me`, `/deposits/me` and `/withdrawals/me` also end in `/me`,
  // so the account itself is matched exactly.
  if (/\/api\/v\d+\/me$/.test(pathname)) return {
    id: 'qa-user', email: 'trader@example.com', displayName: 'QA Trader', phone: null, country: 'SG',
    avatarUrl: null, role: 'USER', isAdmin: false, kycStatus: 'NONE', twoFactorEnabled: false,
    createdAt: '2025-01-01T00:00:00.000Z',
  };
  if (pathname.endsWith('/balances')) return [
    { asset: 'BTC', available: '0.50000000', locked: '0' },
    { asset: 'USDT', available: '1000.00', locked: '0' },
  ];
  if (pathname.endsWith('/market/snapshot')) return {
    tickers: gateway(PAIRS.map(TICKER), on),
    overview: gateway({ totalMarketCapUsd: 2.4e12, totalVolume24hUsd: 9.1e10, btcDominancePercent: 54.2, ethDominancePercent: 17.1, marketCapChangePercent24h: 1.2 }, on),
    sentiment: gateway({ value: 62, classification: 'Greed', updatedAt: Date.now() }, on),
  };
  if (pathname.endsWith('/market/universe')) return on
    ? { available: true, fetchedAt: Date.now(), stale: false, value: { counts: { spot: 2, linearPerpetual: 2, linearFutures: 0, inverse: 0 },
        instruments: PAIRS.map((p) => ({ symbol: p.replace('/', ''), marketType: 'linear_perpetual', quoteAsset: 'USDT', settleAsset: 'USDT', status: 'Trading' })) } }
    : { available: false, reason: 'provider_unavailable', detail: 'Список рынков ещё не загружен.' };
  if (pathname.endsWith('/market/assets/icons')) return { assets: Object.fromEntries(PAIRS.map((p) => [p.split('/')[0], { id: p.split('/')[0].toLowerCase(), name: p.split('/')[0], logoUrl: null }])) };
  if (pathname.includes('/market/derivatives/')) return gateway({ openInterest: on ? '1200.5' : null, fundingRate: on ? '0.0001' : null }, on);
  if (pathname.includes('/market/external/candles/')) return { candles: Array.from({ length: 60 }, (_, i) => ({
    time: Math.floor(Date.now() / 1000) - (60 - i) * 60, open: 64900, high: 65100, low: 64800, close: 65000, volume: 12.5 })) };
  if (pathname.includes('/market/external/orderbook/')) return {
    bids: Array.from({ length: 15 }, (_, i) => [String(65000 - i), '0.5']),
    asks: Array.from({ length: 15 }, (_, i) => [String(65001 + i), '0.5']),
  };
  if (pathname.endsWith('/cfd/tickers')) return { source: 'qa', configured: true, tickers: [] };
  if (pathname.endsWith('/futures/config')) return {
    symbols: PAIRS, minLeverage: 1, maxLeverage: 100, fundingIntervalHours: 8, highLeverageWarningThreshold: 20,
    leverageTiers: [{ notionalCap: 50000, maxLeverage: 100, maintenanceMarginRate: 0.005, maintenanceAmount: 0 }],
  };
  if (pathname.endsWith('/private-trading/candles')) return { candles: [] };
  if (pathname.endsWith('/copy-trading/marketplace')) return { strategies: [], traders: [] };
  if (pathname.endsWith('/wallet/overview')) return {
    real: {
      spot: [
        { asset: 'BTC', available: '0.50000000', locked: '0', priceUsd: on ? '65000.00' : null, valueUsd: on ? '32500.00' : null },
        // The whole point of `partial`: a holding whose price is unknown.
        // It must read as unknown, never as a holding worth nothing.
        { asset: 'EUR', available: '250.00', locked: '0', priceUsd: on ? '1.08' : null, valueUsd: on ? '270.00' : null },
      ],
      futures: [{ asset: 'USDT', available: '50.00', locked: '0', priceUsd: '1.00', valueUsd: '50.00' }],
      spotValueUsd: on ? 32770 : 32500, futuresValueUsd: 50, totalValueUsd: on ? 32820 : 32550,
    },
    valuationComplete: on, unpricedAssets: on ? [] : ['EUR'], btcPriceUsd: on ? '65000.00' : null,
  };
  if (pathname.endsWith('/wallet/performance')) return {
    // No history yet is an honest answer, and the one this account has.
    periods: Object.fromEntries(['7d', '30d', '90d', '1y', 'all'].map((period) => [period, {
      period, available: false, startDate: null, endDate: null, startEquity: null, endEquity: null,
      absolutePnl: null, percent: null, points: [],
    }])),
    ageDays: 0, startedOn: null,
  };
  if (pathname.endsWith('/wallet/portfolio-history')) return { points: [] };
  if (pathname.endsWith('/market/external/rankings')) return { rankings: [] };
  if (pathname.endsWith('/private-trading/native/wallet')) {
    const priced = on;
    return {
      initialized: true,
      account: {
        settleBalance: '1000.00', walletCollateral: priced ? '32500.00' : '0', collateral: priced ? '33500.00' : '1000.00',
        unrealizedPnl: '0', equity: priced ? '33500.00' : '1000.00', initialMargin: '0', orderReserve: '0',
        maintenanceMargin: '0', available: priced ? '33500.00' : '1000.00',
        initialMarginRatio: null, maintenanceRatio: null, liquidatable: null,
        collateralComplete: priced, unpricedAssets: priced ? [] : ['EUR'], collateralAsOf: Date.now(),
      },
      ledger: { entries: [], openingBalance: '1000.00', closingBalance: '1000.00',
        totals: { realizedPnl: '0', fees: '0', funding: '0', net: '0' }, walletBalance: '1000.00', reconciled: true },
      collateral: { settleAsset: 'USDT', lines: [
        { asset: 'BTC', available: '0.5', locked: '0', quantity: '0.5', price: priced ? '65000.00' : null, value: priced ? '32500.00' : null, collateralEnabled: true, status: priced ? 'PRICED' : 'UNPRICED', source: 'qa', asOf: Date.now() },
        { asset: 'EUR', available: '250.00', locked: '0', quantity: '250.00', price: priced ? '1.08' : null, value: priced ? '270.00' : null, collateralEnabled: true, status: priced ? 'PRICED' : 'UNPRICED', source: 'qa', asOf: Date.now() },
      ], priced: priced ? '32770.00' : '0', collateralPriced: priced ? '32770.00' : '0',
        unpriced: priced ? [] : ['EUR'], collateralUnpriced: priced ? [] : ['EUR'], complete: priced, asOf: Date.now() },
      rows: [
        { asset: 'BTC', walletQuantity: '0.5', tradingBalance: '0', total: '0.5', inUse: '0', available: '0.5',
          price: priced ? '65000.00' : null, value: priced ? '32500.00' : null, status: priced ? 'PRICED' : 'UNPRICED', asOf: Date.now(), collateralEnabled: true, collateralToggleable: true },
        { asset: 'EUR', walletQuantity: '250.00', tradingBalance: '0', total: '250.00', inUse: '0', available: '250.00',
          price: priced ? '1.08' : null, value: priced ? '270.00' : null, status: priced ? 'PRICED' : 'UNPRICED', asOf: Date.now(), collateralEnabled: true, collateralToggleable: true },
      ],
      assetsValue: priced ? '32770.00' : '0', assetsEquityValue: priced ? '32770.00' : '0',
      assetsComplete: priced, unpricedAssets: priced ? [] : ['EUR'],
    };
  }
  if (/\/(deposits|withdrawals)\/me$/.test(pathname)) return [];
  if (pathname.includes('/futures/mark-price/')) return { symbol: 'BTCUSDT', markPrice: on ? '65000.00' : null, indexPrice: on ? '65000.00' : null };
  if (pathname.includes('/futures/funding-rate/')) return { symbol: 'BTCUSDT', fundingRate: on ? '0.0001' : null, nextFundingTime: Date.now() + 3600_000 };
  if (pathname.endsWith('/private-trading/access')) return { allowed: false };
  if (pathname.endsWith('/support/conversations/mine')) return null;
  if (pathname.endsWith('/account/security-log')) return { entries: [] };
  if (/\/(orders|positions|trades|history|sessions|api-keys|entries|candles)(\/me)?$/.test(pathname)) return [];
  return {};
}

function answer(state, url) {
  if (state === 'failing') {
    return { status: 502, contentType: 'text/html; charset=utf-8', body: HTML_ERROR_BODY };
  }
  const pathname = new URL(url).pathname;
  const body = fixture(pathname, state === 'partial');
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) };
}

async function run() {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    for (const state of ['normal', 'failing', 'partial']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
      await context.addInitScript(() => {
        // A signed-in session, so the authenticated screens actually render.
        localStorage.setItem('exchange_token', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJxYSIsInNpZCI6InFhIn0.qa');
        localStorage.setItem('exchange_language', 'ru');
      });
      await context.route('**/api/**', (route) => {
        if (process.env.QA_TRACE) console.log('  REQ', new URL(route.request().url()).pathname);
        route.fulfill(answer(state, route.request().url()));
      });
      const page = await context.newPage();

      for (const target of ROUTES) {
        const console_errors = [];
        page.on('pageerror', (err) => console_errors.push(String(err)));
        // React's boundary catches a render fault before `pageerror` sees
        // it, so the console is where the cause actually is.
        page.on('console', (msg) => { if (msg.type() === 'error' && /Unhandled render error/.test(msg.text())) console_errors.push(msg.text()); });
        await page.goto(base + target.path, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2500);
        // A refresh while the API is in this state: last-good, or an honest
        // note — never the server's own words.
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2500);

        const text = await page.evaluate(() => document.body.innerText);
        const tag = `${target.label} · ${state}`;
        await page.screenshot({ path: path.join(OUT, `${target.label}-${state}.png`), fullPage: false });

        // A page that fell to the error boundary proves nothing about
        // wording, so this is a real check and not a length threshold.
        check(`${tag}: the real screen rendered, not the error boundary`, !text.includes('Что-то пошло не так') && text.trim().length > 300, `${text.trim().length} chars`);
        for (const [why, shape] of BANNED) {
          const hit = text.match(shape);
          check(`${tag}: shows no ${why}`, !hit, hit ? hit[0] : '');
        }
        check(`${tag}: claims no success the server did not give`, !FALSE_CLAIM.test(text));
        if (process.env.QA_DUMP) console.log('---- ' + tag + '\n' + text + '\n----');
        if (state === 'partial') {
          // An unpriced holding must read as unknown, not as nothing.
          const zeroed = /BTC[^\n]*\$?0[.,]00/.test(text);
          check(`${tag}: an unknown value is not printed as zero`, !zeroed, zeroed ? text.match(/BTC[^\n]*/)[0] : '');
        }
        check(`${tag}: no uncaught page error`, console_errors.length === 0, console_errors[0] || '');
        page.removeAllListeners('pageerror');
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  const failed = checks.filter((c) => !c.pass);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(checks, null, 2));
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) {
    console.log('\nFailures:');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ' — ' + f.detail.slice(0, 200) : ''}`);
  }
  process.exit(failed.length ? 1 : 0);
}

run().catch((err) => { console.error(err); process.exit(1); });
