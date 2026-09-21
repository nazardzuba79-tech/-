/**
 * Browser acceptance for Banking & Earn after the rate change and the referral block.
 *
 * Runs against scripts/serve-banking-review.cjs, which esbuilds the REAL
 * BankingPage.tsx against preview fixtures — so what is measured here is the
 * shipped component, not a mock of it. Fixture data only; no account, no money.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 4181);
const OUT = process.env.QA_OUT || path.join(__dirname, '..', 'output', 'banking-referral-qa');
const VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
];

const wait = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = spawn('node', [path.join(__dirname, 'serve-banking-review.cjs')],
    { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = [];
  server.stdout.on('data', d => log.push(String(d)));
  server.stderr.on('data', d => log.push(String(d)));

  let ready = false;
  for (let i = 0; i < 60 && !ready; i += 1) {
    await wait(500);
    try { const r = await fetch(`http://127.0.0.1:${PORT}/`); ready = r.ok; } catch { /* starting */ }
  }
  if (!ready) { console.error(log.join('')); throw new Error('preview server never came up'); }

  const browser = await chromium.launch();
  const report = { scope: 'Preview fixtures against the real BankingPage component. No account, no money.', checks: [] };
  const fail = [];
  const check = (name, ok, detail) => { report.checks.push({ name, ok, detail }); if (!ok) fail.push(`${name} — ${detail}`); };

  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.banking-referral', { timeout: 15000 });
    const text = await page.evaluate(() => document.body.innerText);

    // Rates, each with its own period word. This is the whole point of the
    // 12%-monthly / 12%-annual collision.
    check(`${vp.name} program 1 reads 12% в месяц`, /12%\s*в месяц/.test(text), text.match(/.{0,30}12%.{0,20}/)?.[0] ?? 'not found');
    check(`${vp.name} program 2 reads 17% в месяц`, /17%\s*в месяц/.test(text), text.match(/.{0,30}17%.{0,20}/)?.[0] ?? 'not found');
    check(`${vp.name} card yield reads 12% годовых`, /12%\s*годовых/.test(text), 'card block');
    check(`${vp.name} no bare 21% anywhere`, !/\b21%/.test(text), 'stale rate still rendered');

    // The calculator dropdown must not print a bare percentage.
    const options = await page.$$eval('.banking-form select option', els => els.map(e => e.textContent || ''));
    const programOpts = options.filter(o => /%/.test(o));
    check(`${vp.name} every program option names its period`, programOpts.length > 0 && programOpts.every(o => /в месяц/.test(o)), JSON.stringify(programOpts));

    // Referral block, real figures only.
    check(`${vp.name} referral heading present`, /Реферальная программа/.test(text), 'missing');
    check(`${vp.name} referral states 20% от прибыли`, /20%/.test(text) && /от прибыли/.test(text), 'missing');
    check(`${vp.name} referral never says от депозита`, !/от депозита|от оборота|от суммы размещения/.test(text), 'forbidden wording present');
    const link = await page.$eval('.banking-referral-link code', el => el.textContent || '');
    check(`${vp.name} referral link uses the real origin and code`, link === `http://127.0.0.1:${PORT}/PREVIEW1`, link);
    const copy = await page.$('.banking-referral-link button');
    check(`${vp.name} copy button present and enabled`, !!copy && !(await copy.isDisabled()), 'missing or disabled');
    check(`${vp.name} referred count is the real 2`, /Рефералов\s*\n?\s*2/.test(text), text.match(/Рефералов[\s\S]{0,12}/)?.[0] ?? '');
    check(`${vp.name} earned shows real per-asset totals`, /48\.00\s*USDT/.test(text) && /0\.00200000\s*BTC/.test(text), 'totals missing');

    // Layout.
    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      block: (() => { const el = document.querySelector('.banking-referral'); return el ? el.scrollWidth - el.clientWidth : -1; })(),
    }));
    check(`${vp.name} page has no horizontal scroll`, overflow.doc <= 1, `overflow ${overflow.doc}px`);
    check(`${vp.name} referral block has no inner overflow`, overflow.block <= 1, `overflow ${overflow.block}px`);

    await page.screenshot({ path: path.join(OUT, `banking-${vp.name}.png`), fullPage: true });
    await page.close();
  }

  await browser.close();
  server.kill('SIGTERM');
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  const passed = report.checks.filter(c => c.ok).length;
  console.log(`\n${passed}/${report.checks.length} checks passed across ${VIEWPORTS.length} viewports`);
  if (fail.length) { console.log('\nFAILED:'); fail.forEach(f => console.log('  ' + f)); process.exit(1); }
  console.log(`Screenshots and report: ${OUT}`);
}

main().catch(error => { console.error(error); process.exit(1); });
