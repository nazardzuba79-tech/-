/** Original mounted Wallet focus-loss reproduction. Generated fixtures are
 * removed in finally. Simple mouse selection is measured, not assumed broken. */
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs'), cp = require('node:child_process'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const base = '08e4af19594d16421ad9814608916dd0e1c368a5';
const files = ['baseline-deposit.tsx', 'baseline-preview.tsx', 'baseline.html'].map(f => path.join(root, 'frontend/qa', f));
const report = { base, results: [] };
(async () => {
  let browser;
  try {
    let source = cp.execFileSync('git', ['show', base + ':frontend/src/pages/wallet-v3/DepositModal.tsx'], { cwd: root, encoding: 'utf8' });
    source = source.replaceAll('../../lib/', '../src/lib/').replaceAll("'./ui'", "'../src/pages/wallet-v3/ui'").replaceAll("'./format'", "'../src/pages/wallet-v3/format'");
    fs.writeFileSync(files[0], source);
    fs.writeFileSync(files[1], fs.readFileSync(path.join(root, 'frontend/qa/deposit-preview.tsx'), 'utf8').replace('../src/pages/wallet-v3/DepositModal', './baseline-deposit'));
    fs.writeFileSync(files[2], fs.readFileSync(path.join(root, 'frontend/qa/deposit-preview.html'), 'utf8').replace('deposit-preview.tsx', 'baseline-preview.tsx'));
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? {channel:'msedge'} : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const origin = process.env.QA_ORIGIN || 'http://127.0.0.1:4262';
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(origin + '/qa/baseline.html');
    await page.getByRole('button', { name: 'Wallet Deposit', exact: true }).click();
    await page.locator('#deposit-asset').click(); await page.getByRole('option', { name: 'USDT', exact: true }).click();
    assert.equal((await page.locator('#deposit-asset').innerText()).trim(), 'USDT');
    report.results.push({ scenario: 'BTC→USDT single mouse click', result: 'PASS (reported mouse issue not reproduced)' });
    await page.locator('#deposit-asset').click(); await page.getByRole('option', { name: 'BTC', exact: true }).click();
    await page.locator('#deposit-asset').click(); const usdt = page.getByRole('option', { name: 'USDT', exact: true });
    await usdt.focus(); assert.ok(await usdt.evaluate(el => document.activeElement === el));
    await page.evaluate(() => dispatchEvent(new Event('qa-parent-render'))); await page.waitForTimeout(100);
    const focusLost = !(await usdt.evaluate(el => document.activeElement === el));
    await page.keyboard.press('Enter'); const selected = (await page.locator('#deposit-asset').innerText()).trim();
    assert.ok(focusLost && selected === 'BTC', 'Original modal must reproduce focus loss before Enter');
    report.results.push({ scenario: 'focus USDT → parent render → Enter', result: 'REPRODUCED FAILURE', focusLost, expected: 'USDT', actual: selected });
    const out = path.join(root, 'docs/qa/deposit-ui'); fs.mkdirSync(out, {recursive:true});
    await page.screenshot({ path: path.join(out, 'baseline-focus-loss.png') });
    fs.writeFileSync(path.join(out, 'baseline-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { await browser?.close(); for (const file of files) fs.rmSync(file, {force:true}); }
})().catch(e => { console.error(e); process.exitCode = 1; });
