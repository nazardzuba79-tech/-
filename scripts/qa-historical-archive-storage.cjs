#!/usr/bin/env node
/** Real Chromium + IndexedDB corruption regressions. Isolated synthetic CSV only.
 * No production URL, credentials, database, market data or financial operations.
 * Run: node scripts/qa-historical-archive-storage.cjs
 * The .test origin is fulfilled entirely in memory; no listener or network access.
 * QA_PLAYWRIGHT_MODULE may point at the existing CI browser installation.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const output = path.resolve(process.env.QA_OUTPUT || 'output/historical-archive-storage');
const report = { scope: 'Real Chromium / IndexedDB, isolated synthetic fixtures; no production or financial writes', checks: [], errors: [], outbound: [] };
const modules = new Map();
for (const name of ['historicalArchiveStore', 'listingHistoricalImport']) {
  const filename = path.join(root, 'frontend/src/pages/admin', name + '.ts');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename, compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace("'./listingHistoricalImport'", "'./listingHistoricalImport.js'");
  modules.set('/' + name + '.js', compiled);
}
let browser;
async function run() {
  try {
    const origin = 'https://voltex-archive-fixture.test';
    browser = await chromium.launch({ ...(process.env.QA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.QA_CHROMIUM_EXECUTABLE } : {}) });
    const context = await browser.newContext();
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) {
        const source = modules.get(url.pathname);
        return route.fulfill({ status: 200, contentType: source ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
          body: source || '<!doctype html><meta charset="utf-8"><title>Isolated historical archive QA</title>' });
      }
      report.outbound.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(origin);
    const result = await page.evaluate(async () => {
      const m = await import('/historicalArchiveStore.js');
      const importer = await import('/listingHistoricalImport.js');
      const checks = [];
      function check(ok, label) { if (!ok) throw new Error(label); checks.push(label); }
      async function rejects(action, pattern, label) {
        let error;
        try { await action(); } catch (e) { error = e; }
        check(error instanceof Error && pattern.test(error.message), label);
      }
      // Inject damaged data into THIS disposable browser only; never a user's DB.
      async function replaceRows(rows) {
        const db = await new Promise((resolve, reject) => {
          const req = indexedDB.open('voltex.admin.historical-movements.v2', 1);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        await new Promise((resolve, reject) => {
          const tx = db.transaction('archives', 'readwrite'), store = tx.objectStore('archives');
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onabort = tx.onerror = () => { db.close(); reject(new Error('Fixture write failed')); };
          store.clear();
          for (const row of rows) store.put(row);
        });
      }
      const csv = Array.from({ length: 48 }, (_, i) => [1514764800 + i * 3600, 100, 101, 99, 100, 500, 12].join(',')).join('\n');
      const btc = await m.prepareHistoricalArchive(csv, 'BTC/USDT', 'synthetic-btc.csv');
      const eth = await m.prepareHistoricalArchive(csv, 'ETH/USDT', 'synthetic-eth.csv');
      check((await m.listHistoricalArchives()).length === 0, 'Empty IndexedDB returns an empty verified catalogue');
      await m.saveHistoricalArchive(eth);
      await m.saveHistoricalArchive(btc);
      const valid = await m.listHistoricalArchives();
      check(valid.length === 2 && valid[0].source === 'BTC/USDT' && valid[1].source === 'ETH/USDT', 'Valid archives remain sorted and usable');
      check(JSON.stringify(valid[0]) === JSON.stringify(btc), 'Listing does not alter movement data or source metadata');
      const expected = importer.importHistoricalCsv(csv, 'BTC/USDT', { hours: 24 });
      check(JSON.stringify(m.archiveSelection(valid[0], { hours: 24 })) === JSON.stringify(expected), 'Reused movement selection matches direct import exactly');
      const tampered = structuredClone(btc);
      tampered.movements[0][2] = 1;
      await replaceRows([tampered]);
      await rejects(() => m.listHistoricalArchives(), /Контрольная сумма/, 'Catalogue rejects tampered movements before offering a preset');
      await rejects(() => m.loadHistoricalArchive(btc.id), /Контрольная сумма/, 'Direct archive loading still rejects the same corruption');
      await replaceRows([btc, { ...eth, source: null }]);
      await rejects(() => m.listHistoricalArchives(), /повреждён/, 'Invalid source is rejected before sorting, without an uncaught IDB callback');
      await replaceRows([{ ...btc, firstHour: null }]);
      await rejects(() => m.listHistoricalArchives(), /повреждён/, 'Invalid date is rejected before the React catalogue receives it');
      await replaceRows([{ ...btc, name: { unexpected: 'object' } }]);
      await rejects(() => m.listHistoricalArchives(), /повреждён/, 'Non-text filename cannot reach React as an invalid child');
      await replaceRows([{ ...btc, name: 'x'.repeat(121) }]);
      await rejects(() => m.listHistoricalArchives(), /повреждён/, 'Stored filename retains the importer length bound');
      await replaceRows([btc]);
      const beforeBadSave = JSON.stringify(await m.listHistoricalArchives());
      await rejects(() => m.saveHistoricalArchive(tampered), /Контрольная сумма/, 'Rejected save does not replace a valid archive');
      check(JSON.stringify(await m.listHistoricalArchives()) === beforeBadSave, 'Failed verification leaves previously saved data unchanged');
      check(m.HISTORICAL_PRESETS.every(p => p.hours === 2160 && p.label.includes('90 дней с ' + p.startDateUtc + ' (UTC)')), 'All preset labels describe exact 90-day UTC windows');
      return { checks, expected, btcId: btc.id };
    });
    report.checks.push(...result.checks);
    await page.reload();
    const reopened = await page.evaluate(async ({ id }) => {
      const m = await import('/historicalArchiveStore.js');
      const archive = await m.loadHistoricalArchive(id);
      return { count: (await m.listHistoricalArchives()).length, clip: m.archiveSelection(archive, { hours: 24 }) };
    }, { id: result.btcId });
    assert.equal(reopened.count, 1);
    assert.deepEqual(reopened.clip, result.expected);
    report.checks.push('Reload preserves exactly the same selected movements');
    await page.evaluate(async id => {
      const m = await import('/historicalArchiveStore.js');
      await m.deleteHistoricalArchive(id);
      if ((await m.listHistoricalArchives()).length !== 0) throw new Error('Delete did not clear fixture');
    }, result.btcId);
    report.checks.push('Explicit archive deletion still works');
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.outbound, []);
    report.checks.push('Zero uncaught browser errors and zero external requests');
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.failure = error instanceof Error ? error.message : String(error);
    console.error(report.failure);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
}
void run();
