/** Local production-build QA. Real routes/strategy calculations; in-memory DB.
 * No production credentials, databases, provider calls, or deployment.
 * QA_PLAYWRIGHT_MODULE=<playwright path> node scripts/qa-copy-loading.cjs before|after <output dir>
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const { performance } = require('node:perf_hooks');
process.env.JWT_SECRET = randomBytes(32).toString('hex');
delete process.env.DATABASE_URL;
const express = require('express');
const jwt = require('jsonwebtoken');
const { CopyPerformanceService } = require('../dist/services/copyTrading/CopyPerformanceService');
const { copyPerformanceRouter } = require('../dist/api/routes/copyPerformance');
const { portfolioRouter } = require('../dist/api/routes/portfolio');
const phase = process.argv[2] || 'after';
const output = path.resolve(process.argv[3] || 'node_modules/.cache/copy-loading');
fs.mkdirSync(output, { recursive: true });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function database() {
  const rows = new Map();
  const reads = { scenario: 0, identity: 0, session: 0, portfolio: 0 };
  const db = {
    copyPerformanceScenario: {
      async findUnique({ where }) { reads.scenario++; return rows.get(where.id) || null; },
      async create({ data }) { const row = { ...data, revision: 0 }; rows.set(data.id, row); return row; },
      async updateMany({ where, data }) {
        const row = rows.get(where.id);
        if (!row || row.revision !== where.revision) return { count: 0 };
        rows.set(where.id, { ...row, ...data, revision: row.revision + 1 }); return { count: 1 };
      },
    },
    copyStrategyOwner: { async findUnique({ where }) {
      reads.identity++;
      if (scenario === 'identities-fail') throw Error('Injected identity failure');
      return { publicName: where.traderId === 'VX-001' ? 'Nazar' : 'Ksenia', ownerUserId: null, premium: true };
    } },
    user: { async findUnique() { return null; } },
    session: { async findUnique() { reads.session++; return { id: 'qa', userId: 'qa', revokedAt: null, lastSeenAt: new Date() }; } },
    portfolioSnapshot: { async findMany() { reads.portfolio++; return [{ createdAt: new Date(), totalValueUsd: '9999.99' }]; } },
  };
  return { db, reads, rows };
}
let scenario = 'normal';
(async () => {
  const fixture = database();
  let service = new CopyPerformanceService(fixture.db, () => new Date('2026-09-08T12:00:00Z'));
  const wrapped = { async get(strategy) {
    if (scenario === 'slow-all' || (scenario === 'slow-ksenia' && strategy === 'ksenia')) await wait(2000);
    if (scenario === 'all-fail' || scenario === strategy + '-fail') throw Error('Injected performance failure');
    return service.get(strategy);
  } };
  const app = express();
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.sendStatus(405);
    if (req.path.endsWith('/marketplace') && scenario === '500') return res.status(500).json({ error: 'Injected 500' });
    if (req.path.endsWith('/marketplace') && scenario === 'malformed') return res.json({ nazar: { analytics: {} }, ksenia: [], identities: 'invalid' });
    next();
  });
  app.use('/api/v1', copyPerformanceRouter(fixture.db, wrapped));
  app.use('/api/v1', portfolioRouter(fixture.db));
  app.get('/api/v1/me', (_req, res) => res.json({ id: 'qa', email: 'qa@example.invalid', displayName: 'QA', avatarUrl: null, isAdmin: false, kycStatus: 'NOT_STARTED' }));
  app.get('/api/v1/market/snapshot', (_req, res) => res.json({ tickers: { available: true, value: [], stale: false, fetchedAt: Date.now(), source: 'qa' }, overview: { available: false, reason: 'qa' }, sentiment: { available: false, reason: 'qa' } }));
  app.get('/api/v1/market/external/tickers', (_req, res) => res.json({ tickers: [] }));
  app.get('/api/v1/support/conversations/mine', (_req, res) => res.json({ conversation: null }));
  app.get(['/api/v1/balances', '/api/v1/futures/balances'], (_req, res) => res.json([]));
  app.use('/api', (_req, res) => res.json({}));
  const dist = path.resolve(phase === 'before' ? 'baseline-dist' : 'frontend/dist');
  app.get('/qa/:scenario', (req, res) => {
    const allowed=['normal','slow-all','slow-ksenia','nazar-fail','ksenia-fail','identities-fail','all-fail','500','malformed'];
    if (!allowed.includes(req.params.scenario)) return res.sendStatus(400);
    scenario=req.params.scenario; res.redirect('/copy-trading');
  });
  app.use(express.static(dist,{index:false}));
  app.get('*', (_req,res)=>{
    let html=fs.readFileSync(path.join(dist,'index.html'),'utf8');
    if(process.env.QA_SERVE_ONLY) html=html.replace('<head>',`<head><script>
      localStorage.setItem('exchange_token',${JSON.stringify(token)});
      const qa={first:null,nazarAt:null,kseniaAt:null,roster:[],changes:0,shifts:0,requests:[],errors:[]};
      const readBoxes=cards=>cards.map(c=>{const r=c.getBoundingClientRect();return {id:c.dataset.traderId,x:r.x,y:r.y,width:r.width,height:r.height};});
      new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)qa.shifts+=e.value;}).observe({type:'layout-shift',buffered:true});
      const originalFetch=window.fetch;window.fetch=(...args)=>{const url=String(args[0]);if(/copy-trading\\/|portfolio-history/.test(url))qa.requests.push(url);return originalFetch(...args);};
      window.addEventListener('error',e=>qa.errors.push(e.message));
      function inspect(){const cards=[...document.querySelectorAll('.trader-card')];if(!cards.length)return;
        const roster=cards.map(c=>c.dataset.traderId);
        if(!qa.first){qa.first=performance.now();qa.initialRoster=roster;qa.initialBoxes=readBoxes(cards);}
        else if(qa.roster.join()!==roster.join())qa.changes++;
        qa.roster=roster;qa.finalBoxes=readBoxes(cards);qa.overflow=document.documentElement.scrollWidth>innerWidth;
        for(const key of ['nazar','ksenia']){const card=cards.find(c=>c.dataset.traderId===(key==='nazar'?'VX-001':'VX-KSENIA'));if(card&&card.querySelector('.card-roi-copy strong').textContent!=='—'&&!qa[key+'At'])qa[key+'At']=performance.now();}
        document.documentElement.setAttribute('data-qa-metrics',JSON.stringify(qa));
      }
      new MutationObserver(inspect).observe(document,{childList:true,characterData:true,subtree:true});setInterval(inspect,250);
    </script>`);
    res.type('html').send(html);
  });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const token = jwt.sign({ sub: 'qa', sid: 'qa' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const headers = { Authorization: `Bearer ${token}` };
  const report = { phase, clock: '2026-09-08', database: 'in-memory; real DB/network latency unmeasured', endpoints: {}, browsers: [] };
  let browser;
  try {
    for (const endpoint of ['copy-trading/nazar', 'copy-trading/ksenia', 'copy-trading/identities', 'wallet/portfolio-history?range=90d', ...(phase === 'after' ? ['copy-trading/marketplace'] : [])]) {
      const timings = [];
      for (let i = 0; i < 3; i++) {
        const start = performance.now(); const response = await fetch(origin + '/api/v1/' + endpoint, { headers }); const body = await response.text();
        assert.equal(response.status, 200);
        timings.push({ ms: +(performance.now() - start).toFixed(2), bytes: Buffer.byteLength(body) });
        if (i === 0 && /\/(nazar|ksenia)$/.test(endpoint)) fs.writeFileSync(path.join(output, endpoint.split('/')[1] + '.json'), body);
      }
      report.endpoints[endpoint] = timings;
    }
    if (phase === 'after') {
      // Fresh process cache against already-persisted canonical rows. Keep this
      // separate from both first-ever bootstrap and warm serialization timings.
      service = new CopyPerformanceService(fixture.db, () => new Date('2026-09-08T12:00:00Z'));
      const coldStart = performance.now();
      const coldResponse = await fetch(origin + '/api/v1/copy-trading/marketplace', { headers });
      const coldBody = await coldResponse.arrayBuffer();
      assert.equal(coldResponse.status, 200);
      report.aggregateColdCache = { ms: +(performance.now() - coldStart).toFixed(2), bytes: coldBody.byteLength, database: 'persisted canonical rows in memory' };
      service = new CopyPerformanceService(fixture.db, () => new Date('2026-09-08T12:00:00Z'));
      const initialReads = fixture.reads.scenario; const start = performance.now();
      const statuses = await Promise.all(Array.from({ length: 100 }, async () => {
        const response = await fetch(origin + '/api/v1/copy-trading/marketplace', { headers }); await response.arrayBuffer(); return response.status;
      }));
      report.concurrency = { requests: 100, ms: +(performance.now() - start).toFixed(2), scenarioReads: fixture.reads.scenario - initialReads, statuses: [...new Set(statuses)] };
      assert.equal(report.concurrency.scenarioReads, 2); assert.deepEqual(report.concurrency.statuses, [200]);
    }
    if (process.env.QA_MEASURE_ONLY) {
      fs.writeFileSync(path.join(output, phase + '-measurements.json'), JSON.stringify(report, null, 2));
      return;
    }
    if(process.env.QA_SERVE_ONLY) {
      fs.writeFileSync(path.join(output,phase+'-measurements.json'),JSON.stringify(report,null,2));
      console.log('QA server '+origin+' — /qa/normal, /qa/slow-all, /qa/slow-ksenia, /qa/ksenia-fail, /qa/identities-fail');
      await new Promise(()=>{});
    }
    const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
    browser = process.env.QA_CDP_URL ? await chromium.connectOverCDP(process.env.QA_CDP_URL)
      : await chromium.launch({ headless: true, ...(process.env.QA_BROWSER_EXE ? { executablePath: process.env.QA_BROWSER_EXE } : {}) });
    const cases = phase === 'before' ? [[1440, 'normal'], [1440, 'slow-ksenia']] : [
      ...[1920,1440,1366,1280,1024,768,430,390].map(w => [w, 'normal']),
      ...['slow-ksenia','slow-all','ksenia-fail','nazar-fail','identities-fail','all-fail','500','malformed','repeat'].map(s => [1440,s]),
    ];
    for (const [width, name] of cases) {
      scenario = name;
      const context = await browser.newContext({ viewport: { width, height: 1100 } });
      await context.addInitScript(({ token }) => {
        localStorage.setItem('exchange_token', token);
        window.__copyQA = { first: null, nazarAt: null, kseniaAt: null, roster: [], changes: 0, shifts: 0 };
        new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__copyQA.shifts += entry.value; }).observe({ type: 'layout-shift', buffered: true });
        function inspect() {
          const cards = [...document.querySelectorAll('.trader-card')];
          if (!cards.length) return;
          const qa = window.__copyQA; const roster = cards.map(c => c.dataset.traderId);
          if (!qa.first) { qa.first = performance.now(); qa.initialRoster = roster; qa.initialBoxes = cards.map(c => { const r = c.getBoundingClientRect(); return { id: c.dataset.traderId, x:r.x,y:r.y,width:r.width,height:r.height }; }); }
          else if (qa.roster.join() !== roster.join()) qa.changes++;
          qa.roster = roster;
          for (const key of ['nazar','ksenia']) {
            const card = cards.find(c => c.dataset.traderId === (key === 'nazar' ? 'VX-001' : 'VX-KSENIA'));
            if (card && card.querySelector('.card-roi-copy strong')?.textContent !== '—' && !qa[key + 'At']) qa[key + 'At'] = performance.now();
          }
        }
        new MutationObserver(inspect).observe(document, { subtree:true, childList:true, characterData:true, attributes:true });
      }, { token });
      const page = await context.newPage(); const errors = []; const requests = [];
      page.on('pageerror', e => errors.push(String(e)));
      page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
      page.on('request', req => { if (/\/copy-trading\/|\/portfolio-history/.test(req.url())) requests.push(new URL(req.url()).pathname); });
      // External fonts are unrelated to API loading and unavailable in offline QA.
      await page.route(/https:\/\/(fonts\.googleapis|fonts\.gstatic)\.com\//, route => route.fulfill({ status:200, body:'' }));
      await page.goto(origin + '/copy-trading', { waitUntil:'domcontentloaded' });
      await page.locator('.trader-card').first().waitFor();
      if (phase === 'after' && name === 'slow-all') await page.screenshot({ path: path.join(output, 'copy-loading-initial-1440.png'), fullPage:true });
      await page.waitForTimeout(name.startsWith('slow') ? 3300 : 900);
      if (name === 'repeat') {
        await page.locator('a[href="/wallet"]').first().click();
        scenario = '500';
        await page.locator('a[href="/copy-trading"]').first().click();
        await page.locator('.trader-card').first().waitFor();
        await page.waitForTimeout(400);
      }
      const state = await page.evaluate(() => ({ ...window.__copyQA,
        overflow:document.documentElement.scrollWidth > innerWidth,
        finalBoxes:[...document.querySelectorAll('.trader-card')].map(c => { const r=c.getBoundingClientRect(); return { id:c.dataset.traderId,x:r.x,y:r.y,width:r.width,height:r.height }; }),
        featured:[...document.querySelectorAll('.trader-card')].filter(c => ['VX-001','VX-KSENIA'].includes(c.dataset.traderId)).map(c=>({id:c.dataset.traderId,roi:c.querySelector('.card-roi-copy strong')?.textContent,text:c.textContent})),
      }));
      report.browsers.push({ width, scenario:name, requests, errors, ...state });
      fs.writeFileSync(path.join(output, phase + '-measurements.json'), JSON.stringify(report,null,2));
      if (phase === 'after') {
        assert.deepEqual(state.initialRoster.slice(0,2), ['VX-001','VX-KSENIA'], `${width}/${name}: first roster`);
        if (name !== 'repeat') {
          assert.equal(state.changes,0, `${width}/${name}: roster movement`);
          assert.deepEqual(state.finalBoxes,state.initialBoxes, `${width}/${name}: card geometry`);
        }
        assert.equal(state.overflow,false, `${width}/${name}: overflow`);
        assert.equal(errors.filter(e=>!e.includes('Failed to load resource')).length,0, `${width}/${name}: JS errors`);
        if (name === 'repeat') assert.ok(state.featured.every(c=>c.roi !== '—'), 'last-good return data');
        if (name === 'normal' && width === 1440) await page.screenshot({ path:path.join(output,'copy-loading-loaded-1440.png'),fullPage:true });
        if (name === 'normal' && width === 390) await page.screenshot({ path:path.join(output,'copy-loading-390.png'),fullPage:true });
      }
      console.log(`${phase}: ${width}/${name} structure=${state.first?.toFixed(0)}ms Nazar=${state.nazarAt?.toFixed(0)}ms Ksenia=${state.kseniaAt?.toFixed(0)}ms changes=${state.changes} overflow=${state.overflow}`);
      await context.close();
    }
    fs.writeFileSync(path.join(output, phase + '-measurements.json'), JSON.stringify(report,null,2));
  } finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{ console.error(error); process.exitCode=1; });
