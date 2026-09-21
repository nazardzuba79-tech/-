/**
 * Acceptance for the intermittent blank futures chart.
 *
 * Drives the REAL Futures page through scripts/serve-native-demo-review.cjs
 * (isolated fixture market, no production anything) and measures, per cold
 * load, how long it takes for the chart to actually show candles — read off
 * `data-chart-state`, which the component derives from the same state that
 * drives its own overlays.
 *
 * A "blank outcome" here means the load finished and the chart was still
 * showing neither candles nor an error. That is the failure this is watching
 * for, and the count must be zero.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 4188);
const OUT = process.env.QA_OUT || path.join(__dirname, '..', 'output', 'futures-chart-cold-open');
const LOADS = Number(process.env.QA_LOADS || 6);
const BUDGET_MS = Number(process.env.QA_BUDGET_MS || 20000);

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '390x844', width: 390, height: 844 },
];
const SCENARIOS = [
  { name: 'BTCUSDT-1h', symbol: 'BTCUSDT', interval: '1h' },
  { name: 'BTCUSDT-15m', symbol: 'BTCUSDT', interval: '15m' },
  { name: 'ETHUSDT-1h', symbol: 'ETHUSDT', interval: '1h' },
];

const wait = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = spawn(process.execPath, [path.join(__dirname, 'serve-native-demo-review.cjs')], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), NATIVE_PREVIEW_FIXTURE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = [];
  server.stdout.on('data', d => log.push(String(d)));
  server.stderr.on('data', d => log.push(String(d)));

  let ready = false;
  for (let i = 0; i < 80 && !ready; i += 1) {
    await wait(500);
    try { const r = await fetch(`http://127.0.0.1:${PORT}/health`); const h = await r.json(); ready = r.ok && h.fixtureMarket === true; } catch { /* starting */ }
  }
  if (!ready) { console.error(log.join('')); throw new Error('review server did not become healthy'); }

  const browser = await chromium.launch();
  const report = {
    scope: 'Isolated fixture market against the real Futures page. Not production.',
    loadsPerScenario: LOADS, budgetMs: BUDGET_MS, runs: [], blankOutcomes: [],
  };

  for (const vp of VIEWPORTS) {
    for (const scenario of SCENARIOS) {
      const timings = [];
      for (let i = 0; i < LOADS; i += 1) {
        // A genuinely cold load every time: new context, so no bfcache, no
        // warm module graph, no carried-over chart state.
        const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
        const page = await context.newPage();
        const url = `http://127.0.0.1:${PORT}/futures?symbol=${scenario.symbol}&interval=${scenario.interval}`;
        const started = Date.now();
        let state = 'none';
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        try {
          await page.waitForFunction(
            () => document.querySelector('[data-chart-state]')?.getAttribute('data-chart-state') === 'candles',
            { timeout: BUDGET_MS });
          state = 'candles';
        } catch {
          state = await page.evaluate(() => document.querySelector('[data-chart-state]')?.getAttribute('data-chart-state') ?? 'none');
        }
        const elapsed = Date.now() - started;
        timings.push({ attempt: i + 1, ms: elapsed, state });
        if (state !== 'candles') {
          report.blankOutcomes.push({ viewport: vp.name, scenario: scenario.name, attempt: i + 1, state, ms: elapsed });
          await page.screenshot({ path: path.join(OUT, `BLANK-${vp.name}-${scenario.name}-${i + 1}.png`), fullPage: false });
        } else if (i === 0) {
          await page.screenshot({ path: path.join(OUT, `${vp.name}-${scenario.name}.png`), fullPage: false });
        }
        await context.close();
      }
      const ok = timings.filter(t => t.state === 'candles').map(t => t.ms).sort((a, b) => a - b);
      report.runs.push({
        viewport: vp.name, scenario: scenario.name, attempts: timings,
        visible: ok.length, of: LOADS,
        firstCandleMs: ok.length ? { min: ok[0], median: ok[Math.floor(ok.length / 2)], max: ok[ok.length - 1] } : null,
      });
      console.log(`${vp.name} ${scenario.name}: candles ${ok.length}/${LOADS}` +
        (ok.length ? `  first-candle ms min/med/max ${ok[0]}/${ok[Math.floor(ok.length / 2)]}/${ok[ok.length - 1]}` : ''));
    }
  }

  /**
   * The discriminating case.
   *
   * The repeated cold loads above prove there is no regression and give real
   * timings, but in an isolated fixture the candle response lands in ~200ms,
   * so the race that produces the production blank never gets a chance to
   * show. What separates fixed from unfixed is what happens when the request
   * does NOT arrive: before, a silent blank canvas; now, words and a button.
   */
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    let failing = true;
    await page.route('**/candles**', route => failing ? route.abort('failed') : route.continue());
    await page.goto(`http://127.0.0.1:${PORT}/futures?symbol=BTCUSDT&interval=1h`, { waitUntil: 'domcontentloaded' });
    let errorShown = false, retryLabel = null;
    try {
      await page.waitForFunction(
        () => document.querySelector('[data-chart-state]')?.getAttribute('data-chart-state') === 'error',
        { timeout: BUDGET_MS });
      errorShown = true;
      retryLabel = await page.evaluate(() => {
        const host = document.querySelector('[data-chart-state]');
        const button = host && [...host.querySelectorAll('button')].find(b => /Повторить|Retry|重试|Reintentar|再試行|다시|पुनः/.test(b.textContent || ''));
        return button ? (button.textContent || '').trim() : null;
      });
    } catch { /* recorded below as a failure */ }
    await page.screenshot({ path: path.join(OUT, 'candle-failure-error-state.png') });

    let recovered = false;
    if (retryLabel) {
      failing = false;
      await page.evaluate(() => {
        const host = document.querySelector('[data-chart-state]');
        const button = host && [...host.querySelectorAll('button')].find(b => /Повторить|Retry|重试|Reintentar|再試行|다시|पुनः/.test(b.textContent || ''));
        button?.click();
      });
      try {
        await page.waitForFunction(
          () => document.querySelector('[data-chart-state]')?.getAttribute('data-chart-state') === 'candles',
          { timeout: BUDGET_MS });
        recovered = true;
      } catch { /* recorded below */ }
      await page.screenshot({ path: path.join(OUT, 'candle-failure-after-retry.png') });
    }
    report.candleFailure = { errorShown, retryLabel, recovered };
    console.log(`\ncandle request failing: error state shown = ${errorShown}, retry button = ${JSON.stringify(retryLabel)}, recovered after retry = ${recovered}`);
    if (!errorShown || !retryLabel || !recovered) report.blankOutcomes.push({ scenario: 'candle-failure', errorShown, retryLabel, recovered });
    await context.close();
  }

  await browser.close();
  server.kill('SIGTERM');
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  const total = report.runs.reduce((n, r) => n + r.of, 0);
  const visible = report.runs.reduce((n, r) => n + r.visible, 0);
  console.log(`\n${visible}/${total} cold loads ended with visible candles; blank outcomes: ${report.blankOutcomes.length}`);
  console.log(`Report and screenshots: ${OUT}`);
  if (report.blankOutcomes.length) process.exit(1);
}

main().catch(error => { console.error(error); process.exit(1); });
