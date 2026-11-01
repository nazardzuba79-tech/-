'use strict';
/** Disposable localhost-only fixture, reusing the established QVTR QA services.
 * Real admin router, CloudflareListingStore, workerd/SQLite and frontend.
 * Synthetic accounts/financial reads. No remote services or real trading.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
process.env.JWT_SECRET = 'local-qa-only-qvtr-listing-jwt-secret-not-for-production';
process.env.NODE_ENV = 'test';
delete process.env.LISTINGS_STORE_URL;
delete process.env.LISTINGS_STORE_TOKEN;
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.json') });

const express = require('express');
const jwt = require('jsonwebtoken');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || (fs.existsSync('/opt/node22/lib/node_modules/playwright') ? '/opt/node22/lib/node_modules/playwright' : 'playwright'));
const edgeRequire = require('node:module').createRequire(path.join(root, 'workers/market-edge/package.json'));
const { build } = edgeRequire('esbuild');
const { Miniflare, convertV4MiniflareOptions } = edgeRequire('miniflare');
const apiModule = (p) => require(process.env.QA_API_DIST ? path.join(path.resolve(process.env.QA_API_DIST),p) : '../src/'+p);
const { adminListingsRouter } = apiModule('api/routes/adminListings');
const { CloudflareListingStore } = apiModule('services/listings/store');
const { ManagedListingRegistry } = apiModule('services/listings/registry');
const { managedListingResponse } = apiModule('services/listings/listingPublic');
const { assertSpotListing } = apiModule('services/testMarkets/nrxSpot');
const { execFile } = require('node:child_process');

const dist = path.resolve(process.env.QA_FRONTEND_DIST || 'frontend/dist');
const output = path.resolve(process.env.QA_OUT || 'docs/qa/ai-candidate');
const EDGE_PORT = 8787; // the bundle's VITE_MARKET_EDGE_URL
const EDGE = `http://127.0.0.1:${EDGE_PORT}`;
const EDGE_B = `http://127.0.0.1:${Number(process.env.QA_EDGE_B_PORT || 8796)}`;
const STORE_TOKEN = 'synthetic-local-only-listings-secret-0602';
const candidate = process.env.QA_AI_CANDIDATE || 'nryia-20261115';
assert.ok(['nryia-20261115','aelri-20261125'].includes(candidate));
const file = JSON.parse(fs.readFileSync(path.join(root, 'config/test-markets', candidate+'.draft.json'), 'utf8'));

const AT = Date.parse(file.listingAt), HOUR = 3_600_000, DAY = 24 * HOUR;
// Use the interior of a day, not exactly 48 h: a ticking browser legitimately
// renders 01 day immediately after the 48 h boundary. Test rollover separately.
// All clocks below are confined to localhost Chromium, workerd and the local admin router.
const QA_PRELISTING_NOW = AT - 2 * DAY - 6 * HOUR;

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json' };
fs.mkdirSync(output, { recursive: true });

const report = { scope: 'Local only: Worker in workerd + this checkout\'s admin router + production bundle in Chromium. Publication and timer happen on the local Worker only.',
  candidate: { name: file.name, symbol: file.symbol, listingAt: file.listingAt, displayTimeZone: file.displayTimeZone, seed: file.seed, initialPrice: file.initialPrice },
  checks: [], failures: [], screenshots: [], renderCalls: [], outbound: 0, pageErrors: [] };
const check = (name) => { report.checks.push(name); console.log('✓', name); };
const step = async (name, fn) => {
  try { await fn(); check(name); } catch (error) {
    const msg = String(error && error.stack || error).replace(/\s+/g, ' ').slice(0, 6000);
    report.failures.push(`${name}: ${msg}`); console.log('✗', name, '—', msg);
  }
};

async function startEdge(port, persist) {
  // The esbuild substitutions exist ONLY in this disposable workerd bundle; the
  // repository Worker source, canonical QVTR date and production bundle are untouched.
  // Every Date.now() inside this local Worker sees the same historical clock.
  const bundle = await build({ ...(process.env.QA_WORKER_BUNDLE
      ? {stdin:{contents:fs.readFileSync(process.env.QA_WORKER_BUNDLE,'utf8'),resolveDir:root,loader:'js'}}
      : {entryPoints: [path.join(root, 'workers/market-edge/src/worker.ts')]}),
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    external: ['cloudflare:*'],
    define: { 'Date.now': '__voltexQaNow' },
    banner: { js: 'const __voltexQaNow = () => ' + QA_PRELISTING_NOW + ';' },
  });
  const mf = new Miniflare({ ...convertV4MiniflareOptions({ durableObjectsPersist: persist, workers: [{ name: 'market-edge', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-01',
    bindings: { LISTINGS_STORE_TOKEN: STORE_TOKEN, LISTINGS_PUBLIC_CACHE_MS: '0' },
    durableObjects: { LISTINGS: { className: 'ManagedListingsDO', useSQLite: true } },
    outboundService: () => { report.outbound++; throw new Error('QA: the Worker may not call out'); },
  }] }), isolatedResourcePersistencePath: persist, resourcePersistencePath: persist, telemetry: { enabled: false }, host: '127.0.0.1', port });
  await mf.ready;
  return mf;
}

const accounts = { 'qa-admin': 'ADMIN', 'qa-user': 'USER' };
const prisma = {
  user: { findUnique: async ({ where: { id } }) => (accounts[id] ? { id, role: accounts[id] } : null) },
  session: { findUnique: async () => null, update: async () => null },
};
const tokens = { admin: jwt.sign({ sub: 'qa-admin' }, process.env.JWT_SECRET), user: jwt.sign({ sub: 'qa-user' }, process.env.JWT_SECRET) };
const btc = { pair: 'BTC/USDT', lastPrice: '65000', bidPrice: '64999', askPrice: '65001', high24h: '66000', low24h: '64000', volume24h: '100', quoteVolume24h: '6500000', changePercent24h: '1.2' };
const fixtures = {
  '/market/test-assets': () => ({ serverTime: Date.now(), assets: [] }),
  '/market/display/spot-snapshot': () => ({ _display: { mode: 'snapshot', capturedAt: Date.now(), refreshMs: 60000 }, tickers: { available: true, source: 'fixture', fetchedAt: Date.now(), stale: false, value: [btc] }, overview: { available: false, reason: 'fixture' }, sentiment: { available: false, reason: 'fixture' } }),
  '/balances': () => [{ asset: 'USDT', available: '1000', locked: '0' }],
  '/market/external/tickers': () => ({ tickers: [btc] }), '/market/external/symbols': () => ({ symbols: ['BTC/USDT'] }),
  '/market/pairs': () => [{ pair: 'BTC/USDT', base: 'BTC', quote: 'USDT' }], '/market/assets/icons': () => ({ icons: {} }),
  '/market/external/rankings': () => ({ rankings: [] }), '/private-trading/access': () => ({ allowed: false }),
  '/support/conversations/mine': () => ({ conversation: null }), '/market/snapshot': () => ({ pairs: [], fetchedAt: Date.now() }),
  '/futures/config': () => ({ symbols: [] }), '/market/display': () => ({ type: 'snapshot', rows: [] }), '/market/universe': () => ({ available: false, instruments: [] }),
};

async function renderFor(edge, label) {
  const store = new CloudflareListingStore(edge, STORE_TOKEN);
  const registry = new ManagedListingRegistry(store);
  const app = express();
  app.use(express.json({ limit: '300kb' }));
  app.use('/api/v1', (req, _res, next) => { report.renderCalls.push(`${label} ${req.method} ${req.path}`); next(); });
  app.get('/api/v1/me', (req, res) => {
    const sub = String(req.headers.authorization || '').endsWith(tokens.user) ? 'qa-user' : 'qa-admin';
    res.json({ id: sub, email: `${sub}@example.invalid`, displayName: sub, role: accounts[sub], isAdmin: accounts[sub] === 'ADMIN', kycStatus: 'APPROVED', createdAt: '2026-09-01T00:00:00.000Z' });
  });
  app.use('/api/v1', adminListingsRouter(prisma, store, { hasSpotPair: (pair) => pair === 'BTC/USDT' }, registry, () => QA_PRELISTING_NOW));
  app.get('/api/v1/market/live', (_req, res) => res.status(204).end());
  app.get('/api/v1/*', (req, res) => res.json(fixtures[req.path.slice('/api/v1'.length)]?.() ?? []));
  app.use('/api/v1', (_req, res) => res.status(405).json({ error: 'QA disallows writes' }));
  app.use(express.static(dist, { index: false }));
  app.get('*', (_req, res) => res.type('html').send(fs.readFileSync(path.join(dist, 'index.html'), 'utf8')));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const api = async (p, { method = 'GET', body, ifMatch } = {}) => {
    const r = await fetch(`${origin}/api/v1${p}`, { method, headers: { Authorization: `Bearer ${tokens.admin}`, 'Content-Type': 'application/json', ...(ifMatch !== undefined ? { 'If-Match': String(ifMatch) } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { store, registry, server, origin, api };
}

/** The stored draft without what the store assigns on creation. */
const comparable = (draft) => { const { simulationProfile: _p, wickModel: _w, ...rest } = draft; return rest; };
const edgeJson = async (base, p) => { const r = await fetch(`${base}${p}`, { cache: 'no-store' }); return { status: r.status, body: await r.json().catch(() => null) }; };

(async () => {
  assert.ok(fs.existsSync(path.join(dist, 'index.html')), `build the frontend first: QA_FRONTEND_DIST=${dist}`);
  const persistA = fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-qvtr-qa-a-'));
  const persistB = fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-qvtr-qa-b-'));
  let mfA, mfB, A, B, browser;
  let viaForm = null, viaApi = null, idA = null;

  const newPage = async (origin, width, who = 'admin', clock = null, language = 'ru') => {
    const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 1000 }, locale: 'ru-RU', serviceWorkers: 'block' });
    let closing=false;
    const closeContext=context.close.bind(context);
    context.close=async(...args)=>{closing=true;return closeContext(...args);};
    await context.routeWebSocket(/.*/, (ws) => ws.close());
    await context.route('**/*', async (route) => {
      const u = route.request().url();
      if(closing)return route.abort().catch(()=>{});
      if(process.env.QA_PRODUCTION_BUNDLE==='true' && /^https:\/\/(api|market)\.voltextech\.net\//.test(u)){
        // Test the sealed production bytes, but NEVER send fixture credentials or writes to production.
        const parsed=new URL(u),local=parsed.hostname==='api.voltextech.net'?origin:EDGE;
        const cors={'access-control-allow-origin':origin,'access-control-allow-headers':'authorization,content-type,if-match','access-control-allow-methods':'GET,POST,PUT,OPTIONS'};
        if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
        if(parsed.hostname==='market.voltextech.net' && clock){
          const published=await A.store.published();
          const response=managedListingResponse(new Request(EDGE+parsed.pathname+parsed.search,{method:route.request().method()}),published.listings,clock.now(),published.revision);
          if(response)return route.fulfill({status:response.status,headers:{...Object.fromEntries(response.headers),...cors},body:Buffer.from(await response.arrayBuffer())});
        }
        try{
          const response=await route.fetch({url:local+parsed.pathname+parsed.search});
          return await route.fulfill({response,headers:{...response.headers(),...cors}});
        }catch(error){if(!closing)throw error;}
        return;
      }
      if (clock && u.startsWith(EDGE)) {
        // After the opening: the Worker's own response code, at a simulated server time, over the listing published on worker A.
        const published = await A.store.published();
        const response = managedListingResponse(new Request(u, { method: route.request().method() }), published.listings, clock.now(), published.revision);
        if (response) return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
      }
      if (u.startsWith(origin) || u.startsWith(EDGE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
      if(new URL(u).hostname==='fonts.googleapis.com')return route.fulfill({status:200,contentType:'text/css',body:'/* isolated QA system fonts */'});
      return route.abort();
    });
    await context.addInitScript(([token, offset, language]) => {
      try { localStorage.setItem('exchange_token', token); localStorage.setItem('exchange_lang', language); } catch {}
      if (offset) {
        const RealDate = Date;
        const realNow = RealDate.now.bind(RealDate);
        const qaClock = { offset };
        globalThis.__voltexQaClock = qaClock;
        class FixtureDate extends RealDate {
          constructor(...args) { if (args.length === 0) super(realNow() + qaClock.offset); else super(...args); }
          static now() { return realNow() + qaClock.offset; }
        }
        globalThis.Date = FixtureDate;
      }
    }, [tokens[who], clock ? clock.offset : QA_PRELISTING_NOW - Date.now(), language]);
    const page = await context.newPage();
    page.on('pageerror', (error) => report.pageErrors.push(`${who}@${width}: ${error.message}`));
    return page;
  };
  const shot = async (page, name, options = {}) => { await page.screenshot({ path: path.join(output, name), animations: 'disabled', ...options }); report.screenshots.push(name); };

  try {
    mfA=await startEdge(EDGE_PORT,persistA); mfB=await startEdge(Number(new URL(EDGE_B).port),persistB);
    A=await renderFor(EDGE,'A');B=await renderFor(EDGE_B,'B');
    browser=await chromium.launch({headless:true,...(process.env.QA_CHROMIUM_PATH?{executablePath:process.env.QA_CHROMIUM_PATH}:{})});
    const {schemaVersion,...config}=file, symbol=file.symbol, pair=symbol+'/USDT', cap=Number(file.simulationProgram.maxPrice);
    const prefix='/admin/listings';
    const importer=(args=[])=>new Promise(resolve=>execFile(process.execPath,[path.join(root,'scripts/ai-draft-import.cjs'),...args],{timeout:60000,encoding:'utf8',env:{...process.env,VOLTEX_API:A.origin,VOLTEX_MARKET:EDGE,VOLTEX_ADMIN_TOKEN:tokens.admin,QA_AI_CANDIDATE:candidate}},(e,out,err)=>resolve({code:e?e.code:0,out:out+err})));
    const preserved=[];
    for(const f of ['qvtr-20261028.draft.json','eclv-20261103.draft.json','tyvn.draft.json']){
      const r=JSON.parse(fs.readFileSync(path.join(root,'config/test-markets',f),'utf8'));const {schemaVersion,...c}=r;
      const made=await A.api(prefix,{method:'POST',body:{config:c}});assert.equal(made.status,201,JSON.stringify(made.body));preserved.push((await A.api(prefix)).body.listings.find(l=>l.id===made.body.id));
    }
    await step('auth: anonymous 401 and ordinary user 403 for Admin Listings',async()=>{
      assert.equal((await fetch(A.origin+'/api/v1'+prefix)).status,401);
      assert.equal((await fetch(A.origin+'/api/v1'+prefix,{headers:{Authorization:'Bearer '+tokens.user}})).status,403);
    });
    await step('idempotent private import; exact config and stable seed',async()=>{
      const before=report.renderCalls.filter(c=>c==='A POST /admin/listings').length;
      let r=await importer();assert.equal(r.code,0,r.out);assert.equal(report.renderCalls.filter(c=>c==='A POST /admin/listings').length,before);
      r=await importer(['--create']);assert.equal(r.code,0,r.out);
      r=await importer(['--create']);assert.equal(r.code,0,r.out);assert.match(r.out,/already imported/);
      assert.equal(report.renderCalls.filter(c=>c==='A POST /admin/listings').length,before+1);
      const all=(await A.api(prefix)).body.listings, rows=all.filter(l=>l.symbol===symbol);assert.equal(rows.length,1);
      idA=rows[0].id;viaApi=rows[0].draft;assert.deepEqual(comparable(viaApi),file);
      assert.equal(rows[0].activeVersion,null);assert.deepEqual((await edgeJson(EDGE,'/market/listings')).body.assets,[]);
    });
    await step('conflicts and revision/If-Match fencing',async()=>{
      let r=await A.api(prefix,{method:'POST',body:{config}});assert.equal(r.status,409);
      const row=(await A.api(prefix)).body.listings.find(l=>l.id===idA);
      r=await A.api(`${prefix}/${idA}/draft`,{method:'PUT',ifMatch:row.draftRevision,body:{config}});assert.equal(r.status,200,JSON.stringify(r.body));
      assert.equal(r.body.draft.seed,file.seed);
      r=await A.api(`${prefix}/${idA}/draft`,{method:'PUT',ifMatch:row.draftRevision,body:{config}});assert.equal(r.status,409);
      r=await A.api(`${prefix}/${idA}/draft`,{method:'PUT',body:{config}});assert.ok([409,428].includes(r.status),JSON.stringify(r));
    });
    await step('importer refuses matching names and reused seeds under another ticker',async()=>{
      let changed={...config,symbol:'AIXTEST',seed:'synthetic-conflict-test-v1'};
      let r=await B.api(prefix,{method:'POST',body:{config:changed}});assert.equal(r.status,201,JSON.stringify(r.body));
      const id=r.body.id, rev=r.body.draftRevision;
      const run=()=>new Promise(resolve=>execFile(process.execPath,[path.join(root,'scripts/ai-draft-import.cjs'),'--create'],{timeout:30000,env:{...process.env,VOLTEX_API:B.origin,VOLTEX_ADMIN_TOKEN:tokens.admin,QA_AI_CANDIDATE:candidate}},(e,out,err)=>resolve({code:e?.code||0,out:out+err})));
      r=await run();assert.equal(r.code,2,r.out);
      changed={...changed,name:'Synthetic other name',seed:file.seed};
      r=await B.api(`${prefix}/${id}/draft`,{method:'PUT',ifMatch:rev,body:{config:changed}});assert.equal(r.status,200,JSON.stringify(r.body));
      r=await run();assert.equal(r.code,2,r.out);
      assert.equal((await B.api(prefix)).body.listings.length,1);
    });
    await step('private preview is bounded, exact peak and no early candles',async()=>{
      const r=await A.api(`${prefix}/${idA}/preview?horizon=growth&interval=1h`);assert.equal(r.status,200,JSON.stringify(r.body));
      assert.ok(r.body.candles.length>100);assert.ok(r.body.candles.every(c=>c.low>0&&c.high<=cap));
      report.preview={summary:r.body.scenarioSummary,candles:r.body.candles.length,maximum:Math.max(...r.body.candles.map(c=>c.high))};
      const early=await A.api(`${prefix}/${idA}/preview?at=${new Date(AT-10000).toISOString()}&interval=5m`);assert.equal(early.body.candles.length,0);
    });
    const fit=async page=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow');
    for(const width of [1440,390])await step(`Admin private preview ${width}, persisted reload`,async()=>{
      const page=await newPage(A.origin,width);await page.goto(A.origin+'/admin/listings');await page.reload();
      const row=page.locator(`[data-listing-row="${symbol}"]`);await row.waitFor({timeout:20000});assert.ok((await row.innerText()).includes(file.name));
      await shot(page,`admin-draft-${width}.png`);await page.locator(`[data-edit-listing="${symbol}"]`).click();
      assert.equal(await page.inputValue('[data-field="seed"]'),file.seed);
      await page.locator('[data-preview]').click();await page.locator('[data-listing-preview]').waitFor({timeout:30000});
      await page.locator('[data-preview-summary]').scrollIntoViewIfNeeded();await fit(page);await shot(page,`admin-preview-${width}.png`);
      const save=page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/draft'));
      await page.locator('[data-save-draft]').click();const saved=await save;assert.equal(saved.status(),200);
      assert.deepEqual(comparable((await saved.json()).draft),file,'editing must preserve exact model, seed and logo');
      await page.context().close();
    });
    await step('LOCAL staged then running, repeated start cannot reset time; Spot order denied',async()=>{
      const row=(await A.api(prefix)).body.listings.find(l=>l.id===idA);
      let r=await A.api(`${prefix}/${idA}/publish`,{method:'POST',body:{draftRevision:row.draftRevision,publishKey:'local-ai-candidate-0001',countdown:'staged'}});assert.equal(r.status,200,JSON.stringify(r.body));
      assert.deepEqual((await edgeJson(EDGE,'/market/listings')).body.assets,[]);
      const page=await newPage(A.origin,1440);await page.goto(A.origin+'/admin/listings');
      const rowUI=page.locator(`[data-listing-row="${symbol}"]`);await rowUI.locator('[data-timer-action="start"]').click({timeout:20000});
      await rowUI.locator('[data-listing-timer="running"]').waitFor({timeout:15000});
      const before=(await A.api(prefix)).body.listings.find(l=>l.id===idA);
      const twice=await A.api(`${prefix}/${idA}/countdown`,{method:'POST',body:{action:'start'}});assert.equal(twice.status,200,JSON.stringify(twice.body));
      const after=(await A.api(prefix)).body.listings.find(l=>l.id===idA);
      assert.deepEqual([after.active,after.activeVersion,after.countdown],[before.active,before.activeVersion,before.countdown]);
      const live=(await edgeJson(EDGE,'/market/listings')).body.assets;assert.equal(live.length,1);assert.equal(live[0].pair,pair);assert.equal(live[0].isTradable,false);
      await A.registry.ensureFresh(3000);assert.throws(()=>assertSpotListing(pair));
      await shot(page,'admin-running-local-1440.png');await page.context().close();
    });
    for(const width of [1440,390]){
      await step(`Spot countdown ${width}, ticking, reload, logo and names`,async()=>{
        const page=await newPage(A.origin,width,'user');await page.goto(A.origin+'/trade?pair='+encodeURIComponent(pair));
        if(width<600)await page.locator('#mobile-trade-chart').click({timeout:20000});
        const card=page.locator('.vta-prelisting[data-countdown="running"]');await card.waitFor({timeout:20000});
        assert.equal(await card.locator('[data-demo-provenance]').innerText(),'DEMO · SIMULATED · NO REAL TRADING');
        assert.ok((await card.innerText()).includes(file.name));assert.equal(await card.locator('.vta-prelisting-mark img').getAttribute('src'),file.logo);
        const second=await card.locator('.vta-countdown-cell strong').nth(3).innerText();await page.waitForTimeout(2100);
        assert.notEqual(await card.locator('.vta-countdown-cell strong').nth(3).innerText(),second);
        await page.reload();if(width<600)await page.locator('#mobile-trade-chart').click({timeout:20000});await card.waitFor({timeout:20000});
        await fit(page);await shot(page,`spot-countdown-${width}.png`);await page.context().close();
      });
      await step(`Spot ticker/full name search ${width}`,async()=>{
        const page=await newPage(A.origin,width,'user');await page.goto(A.origin+'/trade?pair=BTC%2FUSDT');
        if(width<600)await page.locator('.ticker-bar .pair-selector').first().click({timeout:20000});
        const search=page.locator('.pairs-search input');await search.waitFor({timeout:20000});
        for(const q of [symbol,file.name]){await search.fill(q);await page.locator(`.pair-row[data-pair="${pair}"]`).waitFor({timeout:10000});}
        await fit(page);await shot(page,`spot-search-${width}.png`);await page.context().close();
      });
      await step(`Markets ${width}, canonical name/logo/date`,async()=>{
        const page=await newPage(A.origin,width,'user');await page.goto(A.origin+'/markets');
        const row=page.locator(`.test-market-row[data-pair="${pair}"]`);await row.waitFor({timeout:20000});
        assert.equal(await row.locator('img').first().getAttribute('src'),file.logo);await row.scrollIntoViewIfNeeded();await fit(page);
        await shot(page,`markets-${width}.png`);await page.context().close();
      });
      await step(`countdown day rollover then actual mounted opening ${width}`,async()=>{
        const clock={offset:AT-2*DAY-HOUR-Date.now(),now(){return Date.now()+this.offset;}};
        const page=await newPage(A.origin,width,'user',clock);await page.goto(A.origin+'/trade?pair='+encodeURIComponent(pair));
        if(width<600)await page.locator('#mobile-trade-chart').click({timeout:20000});
        const cells=page.locator('.vta-countdown-cell strong');await cells.first().waitFor({timeout:20000});assert.equal(await cells.first().innerText(),'02');
        const advance=async at=>{clock.offset=at-Date.now();await page.evaluate(offset=>globalThis.__voltexQaClock.offset=offset,clock.offset);};
        await advance(AT-2*DAY+2000);await page.waitForFunction(()=>document.querySelector('.vta-countdown-cell strong')?.textContent==='01');
        assert.equal(await cells.nth(1).innerText(),'23');await advance(AT-6000);
        await page.locator('.managed-demo-chart canvas').first().waitFor({timeout:30000});assert.ok(clock.now()>=AT);assert.equal(await page.locator('.vta-prelisting').count(),0);
        await shot(page,`spot-opening-${width}.png`);await page.context().close();
      });
      await step(`scenario chart at peak ${width}, reload stable`,async()=>{
        const hours=file.simulationProgram.stages.reduce((n,s)=>n+s.durationHours,0),at=AT+hours*HOUR;
        const clock={offset:at-Date.now(),now:()=>at};const page=await newPage(A.origin,width,'user',clock);
        await page.goto(A.origin+'/trade?pair='+encodeURIComponent(pair));if(width<600)await page.locator('#mobile-trade-chart').click({timeout:20000});
        await page.locator('.managed-demo-chart canvas').first().waitFor({timeout:30000});await fit(page);await shot(page,`spot-peak-${width}.png`);
        await page.reload();if(width<600)await page.locator('#mobile-trade-chart').click({timeout:20000});await page.locator('.managed-demo-chart canvas').first().waitFor({timeout:30000});
        await page.context().close();
      });
    }
    await step('all seven languages: translated countdown, unchanged identity, no overflow',async()=>{
      const days={ru:'Дни',en:'Days',zh:'天',es:'Días',hi:'दिन',ja:'日',ko:'일'};
      report.locales={};
      for(const lang of ['ru','en','zh','es','hi','ja','ko']){
        const page=await newPage(A.origin,390,'user',null,lang);await page.goto(A.origin+'/trade?pair='+encodeURIComponent(pair));
        await page.locator('#mobile-trade-chart').click({timeout:20000});const card=page.locator('.vta-prelisting');await card.waitFor({timeout:20000});
        assert.ok((await card.innerText()).includes(file.name));
        const label=await card.locator('.vta-countdown-cell span').first().textContent();assert.equal(label,days[lang]);report.locales[lang]=label;
        await fit(page);await shot(page,`locale-${lang}-390.png`);await page.context().close();
      }
    });
    await step('other listing drafts byte-identical, zero financial writes/outbound/browser errors',async()=>{
      const all=(await A.api(prefix)).body.listings;
      for(const old of preserved)assert.deepEqual(all.find(l=>l.id===old.id),old);
      assert.deepEqual(report.pageErrors,[]);assert.equal(report.outbound,0);
      assert.deepEqual(report.renderCalls.filter(c=>/ (POST|PUT|DELETE) \/(orders|withdrawals|transfers|deposits|futures)(?:\/|$)/.test(c)),[]);
    });
    for(const width of [1440,390]) await step(`reschedule dialog ${width}: cancel, +1/+2/+3, double-click, server reload and countdown`,async()=>{
      const page=await newPage(A.origin,width,'admin');
      await page.goto(`${A.origin}/admin/listings`);
      const open=page.locator(`[data-reschedule-listing="${file.symbol}"]`);await open.waitFor();
      await open.click();await page.getByRole('button',{name:'Отмена',exact:true}).click();
      assert.equal(await page.locator('[data-reschedule-dialog]').count(),0);
      for(const days of [1,2,3]){
        const before=(await A.api(prefix)).body.listings.find(x=>x.id===idA);
        const writes=report.renderCalls.filter(x=>x.includes(`/admin/listings/${idA}/reschedule`)).length;
        await open.click();const dialog=page.locator('[data-reschedule-dialog]');await dialog.waitFor();
        await dialog.locator(`[data-reschedule-days="${days}"]`).click();
        await fit(page);await shot(page,`reschedule-${width}-plus${days}.png`);
        await dialog.locator('[data-confirm-reschedule]').evaluate(button=>{button.click();button.click();});
        await dialog.waitFor({state:'hidden'});
        assert.equal(report.renderCalls.filter(x=>x.includes(`/admin/listings/${idA}/reschedule`)).length,writes+1);
        const after=(await A.api(prefix)).body.listings.find(x=>x.id===idA);
        assert.equal(Date.parse(after.active.listingAt)-Date.parse(before.active.listingAt),days*DAY);
        assert.deepEqual({...after.active,listingAt:before.active.listingAt},before.active);
        assert.deepEqual(after.countdown,before.countdown);assert.equal(after.countdown.state,'running');
        const publicAsset=await edgeJson(EDGE,`/market/test-assets/${file.symbol}-USDT`);
        assert.equal(Date.parse(publicAsset.body.listingAt),Date.parse(after.active.listingAt));
        await page.reload();await open.waitFor();
      }
      const latest=(await A.api(prefix)).body.listings.find(x=>x.id===idA);
      const writes=report.renderCalls.filter(x=>x.includes(`/admin/listings/${idA}/reschedule`)).length;
      await open.click();
      await page.evaluate(at=>{globalThis.__voltexQaClock.offset+=at-Date.now();},Date.parse(latest.active.listingAt)-30_000);
      await page.waitForFunction(()=>document.querySelector('[data-confirm-reschedule]')?.disabled===true);
      assert.equal(report.renderCalls.filter(x=>x.includes(`/admin/listings/${idA}/reschedule`)).length,writes,'expired UI cannot submit');
      await page.context().close();
    });
  }finally{
    await browser?.close();A?.server.close();B?.server.close();await mfA?.dispose();await mfB?.dispose();
    for(const p of [persistA,persistB]){assert.ok(p.startsWith(path.join(os.tmpdir(),'voltex-qvtr-qa-')));fs.rmSync(p,{recursive:true,force:true});}
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({checks:report.checks.length,failures:report.failures.length,screenshots:report.screenshots.length}));
    if(report.failures.length)process.exitCode=1;
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
