#!/usr/bin/env node
/**
 * The Futures pro terminal, in a real browser.
 *
 * LOCAL PRESENTATION QA ONLY. Fixture data, reads only. Every write route
 * 404s, including the close route — which is the point of the Close All
 * assertion below: the run proves the confirmation is required and proves
 * that a refused close is REPORTED as refused rather than rounded up.
 *
 *   node scripts/qa-futures-pro-terminal.cjs [--dist path] [--label after]
 *
 * The quote endpoint the calculator reads is served by the REAL engine
 * math (`src/private-trading/math.ts`, through ts-node), not by canned
 * numbers. A calculator screenshot showing figures a fixture invented
 * would prove nothing about the calculator.
 *
 * QA_MEASURE_ONLY=1 captures and measures without asserting.
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DIST = path.resolve(arg('--dist', path.join(ROOT, 'frontend', 'dist')));
const PORT = Number(arg('--port', '4361'));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'docs', 'qa', 'futures-pro-terminal')));
const LABEL = arg('--label', 'after');
const MEASURE_ONLY = process.env.QA_MEASURE_ONLY === '1';
/** The three the brief names. */
const VIEWPORTS = (arg('--viewports', '1920x1080,1440x900,1366x768')).split(',')
  .map((v) => { const [width, height] = v.split('x').map(Number); return { width, height }; });

const express = require('express');
const { chromium } = require(process.env.PRIVATE_CARD_QA_PLAYWRIGHT || 'playwright');

// The engine's own arithmetic, so the quote the calculator renders is the
// quote the server would give. ts-node transpile-only: this is a QA
// harness, and the types are checked by `tsc` in the ordinary run.
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs' } });
const math = require(path.join(ROOT, 'src', 'private-trading', 'math.ts'));

const RULES = {
  symbol: 'BTCUSDT', tickSize: '0.1', qtyStep: '0.001', minOrderQty: '0.001',
  maxOrderQty: '100', maxMarketOrderQty: '50', minNotionalValue: '5',
  minLeverage: '1', maxLeverage: '100', leverageStep: '1',
};

const PROFILE = {
  pricingModelVersion: 'qa', feeModelVersion: 'qa', riskModelVersion: 'qa',
  takerFeeRate: '0.00055', makerFeeRate: '0.0002', liquidationFeeRate: '0.005', slippageBps: '0',
  riskTiers: [
    { maxNotional: '50000', maintenanceRate: '0.005', deduction: '0', maxLeverage: '100' },
    { maxNotional: '250000', maintenanceRate: '0.01', deduction: '250', maxLeverage: '50' },
  ],
  assumptions: [],
};

/**
 * Two positions, and the second one is the interesting one.
 *
 * `qa-pos-2` has NO liquidation price — `null`, which is the engine saying
 * none is reachable with the account's current collateral. The chart must
 * draw three lines for it and not a fourth, and the table must print a dash.
 */
const POSITIONS = [
  {
    id: 'qa-pos-1', symbol: 'BTC/USDT', side: 'LONG', size: '0.250',
    entryPrice: '77260.40', leverage: 10, marginType: 'CROSS',
    initialMargin: '1931.51', liquidationPrice: '70118.20', markPrice: '77840.10',
    unrealizedPnl: '144.93', realizedPnl: '0', roe: '7.50',
    openedAt: new Date().toISOString(),
    protection: {
      takeProfit: { id: 'tp1', kind: 'TAKE_PROFIT', triggerPrice: '83500.00', status: 'PENDING', lastError: null, attempts: 0, revision: 1 },
      stopLoss: { id: 'sl1', kind: 'STOP_LOSS', triggerPrice: '73900.00', status: 'PENDING', lastError: null, attempts: 0, revision: 1 },
    },
  },
  {
    id: 'qa-pos-2', symbol: 'BTC/USDT', side: 'SHORT', size: '0.100',
    entryPrice: '78900.00', leverage: 5, marginType: 'ISOLATED',
    initialMargin: '1578.00', liquidationPrice: null, markPrice: '77840.10',
    unrealizedPnl: '105.99', realizedPnl: '0', roe: '6.72',
    openedAt: new Date().toISOString(),
    protection: { takeProfit: null, stopLoss: null },
  },
];

/**
 * The quote route's five kinds, answered by the engine's own functions.
 *
 * This mirrors `NativeTradingService.priceQuote` call for call. It is a
 * fixture only in that it supplies the profile and skips the instrument
 * lookup — every FIGURE comes out of src/private-trading/math.ts, so a
 * calculator screenshot shows the arithmetic the server would do and not
 * a number this harness made up.
 */
function quote(body) {
  const rates = { takerFeeRate: PROFILE.takerFeeRate, makerFeeRate: PROFILE.makerFeeRate };
  if (body.kind === 'ORDER') {
    const cost = math.quoteOrderCost({
      side: body.side, quantity: body.quantity, price: body.price,
      leverage: body.leverage, profile: PROFILE, maker: !!body.maker,
    });
    return { kind: 'ORDER', ...cost, violation: null, rules: RULES, ...rates };
  }
  if (body.kind === 'POSITION') {
    const snapshot = math.calculatePosition({
      side: body.side, quantity: body.quantity, entryPrice: body.entryPrice,
      markPrice: body.markPrice ?? body.entryPrice, leverage: body.leverage, profile: PROFILE,
      ...(body.allocatedMargin ? { allocatedMargin: body.allocatedMargin } : {}),
    });
    return { kind: 'POSITION', ...snapshot, ...rates };
  }
  if (body.kind === 'TARGET') {
    const basis = math.calculatePosition({
      side: body.side, quantity: body.quantity, entryPrice: body.entryPrice,
      markPrice: body.entryPrice, leverage: body.leverage, profile: PROFILE,
      ...(body.allocatedMargin ? { allocatedMargin: body.allocatedMargin } : {}),
    });
    const targetPnl = body.targetPnl !== undefined
      ? body.targetPnl
      : math.pnlForRoi(body.targetRoiPercent ?? '0', basis.roiMarginBasis);
    const opening = math.quoteOrderCost({
      side: body.side, quantity: body.quantity, price: body.entryPrice,
      leverage: body.leverage, profile: PROFILE, maker: !!body.maker,
    });
    return {
      kind: 'TARGET',
      exitPrice: math.targetExitPrice({
        side: body.side, quantity: body.quantity, entryPrice: body.entryPrice,
        targetPnl, basis: body.basis, openingFee: opening.openingFee, closingFeeRate: PROFILE.takerFeeRate,
      }),
      targetPnl, roiMarginBasis: basis.roiMarginBasis, openingFee: opening.openingFee,
      closingFeeRate: PROFILE.takerFeeRate, ...rates,
    };
  }
  if (body.kind === 'PNL') {
    const opening = math.quoteOrderCost({
      side: body.side, quantity: body.quantity, price: body.entryPrice,
      leverage: body.leverage, profile: PROFILE, maker: !!body.maker,
    });
    const closed = math.closePositionAllocation({
      side: body.side, quantity: body.quantity, closeQuantity: body.quantity,
      entryPrice: body.entryPrice, exitPrice: body.exitPrice,
      allocatedMargin: opening.positionMargin, openingFeesRemaining: opening.openingFee,
      feeRate: PROFILE.takerFeeRate,
    });
    const basis = math.calculatePosition({
      side: body.side, quantity: body.quantity, entryPrice: body.entryPrice,
      markPrice: body.entryPrice, leverage: body.leverage, profile: PROFILE,
    }).roiMarginBasis;
    return {
      kind: 'PNL', entryNotional: opening.entryNotional, baseInitialMargin: opening.baseInitialMargin,
      positionMargin: opening.positionMargin, openingFee: opening.openingFee, closingFee: closed.closingFee,
      grossPnl: closed.realizedGross, netPnl: closed.netRealized, roiMarginBasis: basis,
      roiPercent: math.roiPercent(closed.realizedGross, basis),
      roiPercentNet: math.roiPercent(closed.netRealized, basis), ...rates,
    };
  }
  const perInterval = math.fundingCashflow(body.side, body.quantity, body.markPrice, body.rate);
  const intervals = body.intervals ?? 1;
  return { kind: 'FUNDING', perInterval, intervals,
    total: String(Number(perInterval) * intervals), ...rates };
}

function start() {
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.get('/api/v1/me', (_q, r) => r.json({ id: 'qa-user', email: 'qa@example.invalid', role: 'USER' }));
  app.get('/api/v1/private-trading/access', (_q, r) =>
    r.json({ allowed: false, mode: 'ORDINARY', nativeAvailable: false, simulationOnly: false }));
  app.get('/api/v1/futures/positions', (_q, r) => r.json(POSITIONS));
  app.get('/api/v1/futures/positions/history', (_q, r) => r.json([]));
  app.get('/api/v1/futures/orders/me', (_q, r) => r.json([]));
  app.get('/api/v1/futures/balances', (_q, r) => r.json([{ asset: 'USDT', available: '25000.00', locked: '3509.51' }]));
  app.get('/api/v1/futures/config', (_q, r) => r.json({
    symbols: ['BTC/USDT', 'ETH/USDT'], minLeverage: 1, maxLeverage: 100,
    highLeverageWarningThreshold: 50,
    leverageTiers: [
      { notionalCap: 50000, maxLeverage: 100, maintenanceMarginRate: 0.005 },
      { notionalCap: null, maxLeverage: 50, maintenanceMarginRate: 0.01 },
    ],
  }));
  app.get('/api/v1/futures/mark-price/:symbol', (_q, r) => r.json({ markPrice: '77840.10', indexPrice: '77835.42' }));
  app.get('/api/v1/futures/funding-rate/:symbol', (_q, r) => r.json([{ rate: '0.00003', settledAt: new Date().toISOString() }]));
  app.get('/api/v1/futures/open-interest/:symbol', (_q, r) => r.json({ available: false, reason: 'qa' }));
  app.post('/api/v1/private-trading/native/quote', (req, r) => {
    try { r.json(quote(req.body)); }
    catch (e) { r.status(400).json({ error: 'quote refused', code: e && e.code ? e.code : 'INVALID_QUANTITY' }); }
  });
  app.get(['/api/v1/balances', '/api/v1/orders', '/api/v1/orders/me'], (_q, r) => r.json([]));
  app.get('/api/v1/market/external/rankings', (_q, r) => r.json({ source: 'LOCAL TEST FIXTURE', rankings: [] }));
  app.get('/api/v1/support/conversations/mine', (_q, r) => r.json({ conversation: null, messages: [] }));
  app.get('/api/v1/deposit-chains', (_q, r) => r.json([]));
  app.get('/api/v1/market/assets/icons', (req, r) => {
    const symbols = String(req.query.symbols || '').split(',').filter(Boolean);
    r.json({ assets: Object.fromEntries(symbols.map((s) => [s, { id: `qa:${s.toLowerCase()}`, name: s, logoUrl: null }])) });
  });
  app.all('/api/*', (req, res) => res.status(404).json({ error: 'Outside QA scope', path: req.path }));
  app.use(express.static(DIST, { index: false, redirect: false }));
  app.get('*', (_q, r) => r.sendFile(path.join(DIST, 'index.html')));
  return app.listen(PORT, '127.0.0.1');
}

const waitForServer = () => new Promise((resolve, reject) => {
  const deadline = Date.now() + 20000;
  const attempt = () => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/' }, (res) => { res.resume(); resolve(); });
    req.on('error', () => (Date.now() > deadline ? reject(new Error('no harness')) : setTimeout(attempt, 150)));
  };
  attempt();
});

/** What the terminal is showing, as numbers rather than impressions. */
const measure = (page) => page.evaluate(() => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  };
  const text = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
  const tickerItems = [...document.querySelectorAll('.futures-ticker-bar .ticker-item')];
  const infoRows = [...document.querySelectorAll('.fo-infoBox .fo-infoRow')];
  const statusBar = document.querySelector('.fts-bar');
  return {
    ticker: {
      count: tickerItems.length,
      labels: tickerItems.map((i) => i.querySelector('.label')?.textContent?.trim() ?? '(price block)'),
      calculatorButton: box(document.querySelector('[data-open-calculator]')),
      // Named by a data hook rather than by its label, so the assertion is
      // not an assertion about which language the terminal is in.
      /**
       * Does the strip actually FIT?
       *
       * A metric pushed past the right edge is not a metric: the cell still
       * exists in the DOM and still measures, so only its position against
       * the bar's own box can tell. `overflowPx` is how far the last cell
       * (or the calculator trigger, whichever ends furthest right) runs past
       * the bar, and the strip's own inner scroll is measured beside it.
       */
      fit: (() => {
        const bar = document.querySelector('.futures-ticker-bar');
        if (!bar) return null;
        const barRight = bar.getBoundingClientRect().right;
        const last = tickerItems[tickerItems.length - 1];
        const calc = document.querySelector('[data-open-calculator]');
        const rightOf = (el) => (el ? Math.round(el.getBoundingClientRect().right) : null);
        return {
          barRight: Math.round(barRight),
          lastCellRight: rightOf(last),
          calculatorRight: rightOf(calc),
          innerScrollPx: Math.max(0, bar.scrollWidth - bar.clientWidth),
          // Whether the trigger sits on top of the last metric's TEXT.
          // Its BOX may legitimately run under the trigger as reserved
          // padding; a covered word may not — a clipped label reads as a
          // broken layout in a way a figure one scroll away does not.
          coveredByTriggerPx: (() => {
            if (!calc || !last) return 0;
            const c = calc.getBoundingClientRect();
            const ink = [...last.querySelectorAll('.label, .value')]
              .map((el) => el.getBoundingClientRect())
              .filter((r) => r.width > 0);
            if (!ink.length) return 0;
            return Math.max(0, ...ink.map((r) =>
              Math.round(Math.min(r.right, c.right) - Math.max(r.left, c.left))));
          })(),
          overflowPx: Math.max(
            0,
            Math.round(Math.max(rightOf(last) ?? 0, rightOf(calc) ?? 0) - barRight),
          ),
        };
      })(),
      indexCell: (() => {
        const cell = document.querySelector('[data-metric="index"]');
        return cell ? { box: box(cell), value: cell.textContent.trim(), label: cell.getAttribute('aria-label') } : null;
      })(),
    },
    orderTicket: {
      rows: infoRows.map((row) => ({
        label: row.firstElementChild?.textContent?.trim() ?? null,
        value: row.lastElementChild?.textContent?.trim() ?? null,
      })),
      // No control may exist for a capability the engine does not have.
      forbiddenControls: ['Stop Limit', 'Post Only', 'Time in force', 'Trigger']
        .filter((label) => document.body.innerText.includes(label)),
    },
    status: statusBar ? {
      box: box(statusBar),
      state: statusBar.getAttribute('data-terminal-status'),
      text: statusBar.textContent.trim(),
      feedAge: document.querySelector('[data-feed-age]')?.getAttribute('data-feed-age') ?? null,
      // There is no latency figure anywhere in it, by design.
      mentionsLatency: /\b\d+\s?ms\b/i.test(statusBar.textContent),
    } : null,
    positions: {
      rows: document.querySelectorAll('.futures-positions-table tbody tr').length,
      closeAllButton: box(document.querySelector('[data-close-all]')),
      confirmOpen: !!document.querySelector('[data-close-all-confirm]'),
      report: text('[data-close-all-report]'),
    },
    calculator: (() => {
      const panel = document.querySelector('[data-futures-calculator]');
      if (!panel) return null;
      return {
        box: box(panel),
        readOnlyBadge: text('[data-calculator-readonly]'),
        headline: text('.fc-headlineValue'),
        rows: [...panel.querySelectorAll('.fc-row')].map((r) => ({
          label: r.firstElementChild?.textContent?.trim() ?? null,
          value: r.lastElementChild?.textContent?.trim() ?? null,
        })),
      };
    })(),
    /**
     * Figures that are not figures.
     *
     * `NaN`, `undefined` and `Infinity` reaching the screen mean a number
     * was computed from something that was not there — the exact failure
     * this terminal's "unknown is a dash, never a zero" rule exists to
     * prevent. Collected as the lines they appear on, so a failure names
     * the row rather than the page.
     */
    brokenFigures: [...document.querySelectorAll('.futures-terminal *')]
      .filter((el) => el.children.length === 0)
      .filter((el) => /\bNaN\b|\bundefined\b|\bInfinity\b/.test(el.textContent.trim()))
      .map((el) => {
        const where = [];
        for (let n = el; n && n !== document.body; n = n.parentElement) {
          where.unshift(n.className && typeof n.className === 'string'
            ? `${n.tagName.toLowerCase()}.${n.className.split(' ').filter(Boolean).join('.')}`
            : n.tagName.toLowerCase());
        }
        return `${where.slice(-4).join(' > ')} :: ${el.textContent.trim().slice(0, 40)}`;
      })
      .slice(0, 12),
    // A page that scrolls sideways at a named viewport is a layout failure,
    // not a preference.
    horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
  };
});

async function shot(page, name) {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${LABEL}-${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

(async () => {
  const server = start();
  await waitForServer();
  const browser = await chromium.launch();
  const report = { label: LABEL, takenAt: new Date().toISOString(), viewports: {} };
  const shots = [];
  try {
    for (const viewport of VIEWPORTS) {
      const name = `${viewport.width}x${viewport.height}`;
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
      const page = await context.newPage();
      page.on('console', (m) => { if (m.type() === 'error') console.error(`  [console:${name}]`, m.text()); });
      // The terminal is an authenticated screen. A QA token is enough: the
      // harness answers /me itself and 404s every write.
      await page.addInitScript(() => {
        localStorage.setItem('exchange_token', 'qa-token');
        localStorage.setItem('exchange_lang', 'ru');
      });
      await page.goto(`http://127.0.0.1:${PORT}/futures`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.futures-positions-table tbody tr', { timeout: 15000 });
      await page.waitForTimeout(600);

      const terminal = await measure(page);
      shots.push(await shot(page, `terminal-${name}`));

      // ── The calculator, opened from the strip it is reached from ──
      await page.click('[data-open-calculator]');
      await page.waitForSelector('[data-futures-calculator]', { timeout: 10000 });
      // Entry and quantity are seeded from the live terminal; the EXIT price
      // is the question the trader is asking, so nothing can seed it and the
      // panel correctly shows dashes until it is typed. Type it, so the
      // screenshot shows an answer rather than an empty form.
      // The entry price seeds itself from the live tape in production. This
      // sandbox has no outbound market connection — the status line says so
      // — so it is typed here, and the figures beside it are then the
      // engine's answer to a question with all of its inputs present.
      await page.fill('[id$="-entry"]', '77260.40');
      await page.fill('[id$="-exit"]', '83500');
      await page.fill('[id$="-qty"]', '0.25');
      await page.waitForTimeout(900);
      const calculator = await measure(page);
      shots.push(await shot(page, `calculator-${name}`));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);

      // ── Close All asks before it acts ──
      await page.click('[data-close-all]');
      await page.waitForSelector('[data-close-all-confirm]', { timeout: 5000 });
      await page.waitForTimeout(250);
      const confirming = await measure(page);
      shots.push(await shot(page, `close-all-confirm-${name}`));

      // The close route 404s in this harness, so confirming here proves the
      // REPORT: two attempts, two refusals, and a panel that says so.
      await page.click('[data-close-all-confirmed]');
      await page.waitForSelector('[data-close-all-report]', { timeout: 15000 });
      await page.waitForTimeout(300);
      const reported = await measure(page);
      shots.push(await shot(page, `close-all-report-${name}`));

      report.viewports[name] = { terminal, calculator, confirming, reported };
      await context.close();
    }

    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `${LABEL}.json`), JSON.stringify(report, null, 2));

    for (const [name, v] of Object.entries(report.viewports)) {
      console.log(`\n${name}`);
      console.log('  ticker cells      ', v.terminal.ticker.count, v.terminal.ticker.labels.join(' | '));
      console.log('  calculator button ', v.terminal.ticker.calculatorButton ? 'present' : 'ABSENT');
      console.log('  ticket rows       ', v.terminal.orderTicket.rows.map((r) => r.label).join(' | '));
      console.log('  status            ', v.terminal.status ? `${v.terminal.status.state} · ${v.terminal.status.text}` : 'ABSENT');
      console.log('  calculator        ', v.calculator.calculator
        ? `${v.calculator.calculator.readOnlyBadge} · ${v.calculator.calculator.headline}` : 'ABSENT');
      console.log('  close all report  ', v.reported.positions.report);
      console.log('  h-overflow        ', v.terminal.horizontalOverflow);
      console.log('  strip fit         ', JSON.stringify(v.terminal.ticker.fit));
      console.log('  broken figures    ', v.terminal.brokenFigures.length ? v.terminal.brokenFigures.join(' / ') : 'none');
    }

    if (!MEASURE_ONLY) {
      for (const [name, v] of Object.entries(report.viewports)) {
        const where = (what) => `${name}: ${what}`;
        // §7 — every metric the strip promises, and the index among them.
        // Seven cells: the price block (last, mark and index) plus 24h
        // change, high, low, turnover, open interest and funding.
        assert.equal(v.terminal.ticker.count, 7, where(`the ticker has ${v.terminal.ticker.count} cells, not 7`));
        assert.ok(v.terminal.ticker.indexCell, where('no index price figure'));
        assert.ok(/\d/.test(v.terminal.ticker.indexCell.value ?? ''), where('the index figure is not a figure'));
        assert.ok(v.terminal.ticker.indexCell.label, where('the index figure has no accessible name'));
        // And the strip FITS. A metric past the right edge is not a metric,
        // and the calculator trigger — the only way into the calculator —
        // is pinned, so it is inside the bar at every width.
        assert.ok(v.terminal.ticker.fit, where('no ticker bar'));
        assert.ok(v.terminal.ticker.fit.calculatorRight <= v.terminal.ticker.fit.barRight,
          where('the calculator trigger sits outside the bar'));
        assert.ok(v.terminal.ticker.fit.overflowPx <= 8,
          where(`the strip overflows its bar by ${v.terminal.ticker.fit.overflowPx}px`));
        // §1 — the calculator is reachable, and says what it is.
        assert.ok(v.terminal.ticker.calculatorButton, where('no calculator trigger on the strip'));
        assert.ok(v.calculator.calculator, where('the calculator did not open'));
        assert.ok(v.calculator.calculator.readOnlyBadge, where('the calculator does not declare itself read-only'));
        assert.ok(v.calculator.calculator.rows.length > 0, where('the calculator answered nothing'));
        // §2 — the ticket states margin and value as different things.
        const labels = v.terminal.orderTicket.rows.map((r) => r.label).join(' | ');
        assert.ok(v.terminal.orderTicket.rows.length >= 3, where(`too few ticket rows: ${labels}`));
        // §6 — nothing the engine cannot do.
        assert.deepEqual(v.terminal.orderTicket.forbiddenControls, [], where('a control exists for a capability the engine lacks'));
        // §9 — a status line that measures rather than guesses.
        assert.ok(v.terminal.status, where('no status line'));
        assert.equal(v.terminal.status.mentionsLatency, false, where('the status line printed a latency it never measured'));
        // §6 — Close All asks, and reports honestly when the closes fail.
        assert.equal(v.confirming.positions.confirmOpen, true, where('Close All did not ask'));
        assert.ok(/closeAllPartial|не удалось|failed/i.test(v.reported.positions.report ?? ''),
          where(`two refused closes were not reported as refused: ${v.reported.positions.report}`));
        // Layout.
        assert.ok(v.terminal.horizontalOverflow <= 1, where(`page scrolls sideways by ${v.terminal.horizontalOverflow}px`));
        assert.deepEqual(v.terminal.brokenFigures, [], where('a figure rendered as NaN/undefined/Infinity'));
      }
      console.log('\nAll pro-terminal assertions passed at', VIEWPORTS.map((v) => `${v.width}x${v.height}`).join(', '));
    }
    console.log('\nScreenshots:');
    for (const file of shots) console.log('  ' + path.relative(ROOT, file));
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => { console.error(err); process.exit(1); });
