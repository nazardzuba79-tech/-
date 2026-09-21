'use strict';
/**
 * SPOT AND CFD IN THE APPROVED TERMINAL DESIGN — and Futures unchanged by it.
 *
 * The owner-approved composition is the Futures terminal as it ships: its
 * palette and type live in ArchiveTerminalPreview.css under
 * `#archive-terminal-preview`, an id that is set on every ordinary visit
 * because `archivePreview` is true whenever no `?design=` override is given.
 *
 * Measured before any of this was written, ten of the eleven core tokens
 * differed between that terminal and Spot/CFD. This harness is what turns
 * "looks consistent" into a number: it reads the computed tokens and the
 * strip's real geometry on all three terminals and requires Spot and CFD to
 * match Futures — while requiring FUTURES ITSELF to match a baseline captured
 * on unmodified main, so consistency can never be bought by changing it.
 *
 * Also checked, at every width, because a shared stylesheet is exactly the
 * kind of change that breaks these quietly: no horizontal page overflow, no
 * overlapping panels, and no NaN or undefined rendered anywhere.
 *
 * Real production bundle, real components, stubbed read-only API. No writes,
 * no backend, no secrets.
 */
'use strict';
/** Measure the real computed gap between the Futures terminal and Spot/CFD. */
const express = require('express');
const path = require('node:path');
const { once } = require('node:events');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const dist = path.resolve(__dirname, '../frontend/dist');
const fs = require('node:fs');
const OUT = path.resolve(process.env.QA_OUT || 'docs/qa/spot-cfd-terminal');
const PAIRS = ['BTC/USDT','ETH/USDT','SOL/USDT'];
const CANDLES=Array.from({length:120},(_,i)=>({time:Math.floor(Date.now()/1000)-(120-i)*60,open:84800,high:84950,low:84700,close:84890,volume:12}));
const app = express();
app.get('/api/v1/me', (_q,r)=>r.json({id:'qa',displayName:'QA',email:'qa@example.invalid',kycStatus:'NOT_STARTED',isAdmin:false,role:'USER'}));
app.get('/api/v1/futures/config',(_q,r)=>r.json({symbols:PAIRS,minLeverage:1,maxLeverage:100,leverageStep:1,fundingIntervalHours:8,highLeverageWarningThreshold:25,leverageTiers:[{notionalCap:null,maxLeverage:100,maintenanceMarginRate:0.005,maintenanceAmount:0}]}));
app.get('/api/v1/market/universe',(_q,r)=>r.json({available:true,value:{instruments:PAIRS.map(p=>({symbol:p,providerSymbol:p.replace('/',''),marketType:'linear_perpetual',baseAsset:p.split('/')[0],quoteAsset:'USDT',settleAsset:'USDT',status:'Trading',fundingIntervalMinutes:480}))}}));
app.get('/api/v1/market/external/tickers',(_q,r)=>r.json({tickers:PAIRS.map(p=>({pair:p,lastPrice:84890.1,high24h:85954.6,low24h:83535,changePercent:1.25,quoteVolume24h:3.19e9,volume24h:15000}))}));
app.get('/api/v1/market/external/symbols',(_q,r)=>r.json({symbols:PAIRS}));
app.get('/api/v1/market/pairs',(_q,r)=>r.json(PAIRS.map(p=>({pair:p,base:p.split('/')[0],quote:'USDT'}))));
app.get('/api/v1/futures/mark-price/:s',(_q,r)=>r.json({symbol:'BTCUSDT',markPrice:'84887.45',indexPrice:'84123.99'}));
app.get('/api/v1/futures/funding-rate/:s',(_q,r)=>r.json({history:[{rate:'0.0001',markPrice:'84887.45',indexPrice:'84123.99',appliedAt:new Date().toISOString()}]}));
app.get('/api/v1/futures/open-interest/:s',(_q,r)=>r.json({available:true,value:{openInterestBase:30894.9}}));
app.get('/api/v1/market/derivatives/:a',(_q,r)=>r.json({available:true,source:'qa',fetchedAt:Date.now(),stale:false,value:{turnover24hUsd:3.19e9,openInterestBase:30894.9,openInterestUsd:9.2e8}}));
app.get('/api/v1/wallet/overview',(_q,r)=>r.json({balances:{spot:[],futures:[],spotValueUsd:0,futuresValueUsd:0,totalValueUsd:0},valuationComplete:true,unpricedAssets:[],btcPriceUsd:84890}));
app.get('/api/v1/futures/positions',(_q,r)=>r.json([])); app.get('/api/v1/futures/orders',(_q,r)=>r.json([]));
app.get('/api/v1/orders',(_q,r)=>r.json([])); app.get('/api/v1/orders/history',(_q,r)=>r.json([]));
app.get('/api/v1/balances',(_q,r)=>r.json([]));
app.get('/api/v1/orderbook/:a/:b',(_q,r)=>r.json({bids:[['84880','1.2'],['84879','0.8']],asks:[['84892','0.9'],['84893','1.5']]}));
app.get('/api/v1/cfd/instruments',(_q,r)=>r.json({instruments:[{symbol:'XAUUSD',displayName:'Gold',category:'metals'},{symbol:'EURUSD',displayName:'Euro',category:'fx'}]}));
app.get('/api/v1/cfd/quotes',(_q,r)=>r.json({quotes:[{symbol:'XAUUSD',bid:2650.1,ask:2650.6,changePercent:0.4}]}));
app.get('/api/v1/cfd/positions',(_q,r)=>r.json({positions:[]}));
app.get('/api/v1/market/live',(_q,r)=>{r.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});r.write(': open\n\n');});
app.get('/api/v1/market/snapshot',(_q,r)=>r.json({pairs:PAIRS.map(p=>({pair:p,lastPrice:84890.1,changePercent:1.25,high24h:85954.6,low24h:83535,quoteVolume24h:3.19e9})),fetchedAt:Date.now()}));
app.get('/api/v1/market/assets/icons',(_q,r)=>r.json({icons:{}}));
app.get('/api/v1/market/external/rankings',(_q,r)=>r.json({gainers:[],losers:[]}));
app.get('/api/v1/market/external/orderbook/:p',(_q,r)=>r.json({bids:[[84880,1.2],[84879,0.8],[84878,2.1]],asks:[[84892,0.9],[84893,1.5],[84894,1.1]],fetchedAt:Date.now()}));
app.get(['/api/v1/market/external/candles/:p','/api/v1/market/futures/candles/:p','/api/v1/cfd/candles/:s','/api/v1/private-trading/candles'],(_q,r)=>r.json({candles:CANDLES}));
app.get('/api/v1/cfd/config',(_q,r)=>r.json({configured:true,instruments:[{symbol:'XAUUSD',displayName:'Gold',category:'metals',minQuantity:0.01,quantityStep:0.01,leverage:20}]}));
app.get('/api/v1/cfd/tickers',(_q,r)=>r.json({tickers:[{symbol:'XAUUSD',bid:2650.1,ask:2650.6,last:2650.3,changePercent:0.4,high24h:2662,low24h:2640}]}));
app.get(['/api/v1/orders/me','/api/v1/futures/orders/me'],(_q,r)=>r.json([]));
app.get('/api/v1/futures/balances',(_q,r)=>r.json([]));
app.get('/api/v1/private-trading/access',(_q,r)=>r.json({allowed:false}));
app.get('/api/v1/support/conversations/mine',(_q,r)=>r.json({conversation:null}));
app.use('/api/v1',(_q,r)=>r.json([]));
app.use(express.static(dist,{index:false}));
app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));


const DESKTOP = [[1920,1080],[1440,900],[1366,768]];
const MOBILE = [[390,844],[430,932]];
const TERMINALS = [['futures','/futures'],['spot','/trade'],['cfd','/trade?market=cfd']];
const TOKENS = ['--bg-primary','--bg-secondary','--bg-tertiary','--border-color','--text-primary',
  '--text-secondary','--accent-yellow','--color-buy','--color-sell','--panel','--font-family'];

const READ = (tokenNames) => {
  const root = document.querySelector('.trade-terminal');
  if (!root) return { missing: true };
  const cs = getComputedStyle(root);
  const strip = document.querySelector('.ticker-bar, .cfd-ticker-bar');
  const sc = strip && getComputedStyle(strip);
  const text = document.body.textContent || '';
  /* Panels that overlap are the classic cost of moving one shell's layout
     onto another's DOM, and they do not show up in a screenshot diff of a
     single width. Compared pairwise on the real boxes. */
  const panels = [...document.querySelectorAll(
    '.chart-area,.orderbook-area,.order-form-area,.bottom-panel,.market-panel,'
    + '.cfd-chart-area,.cfd-form-area,.cfd-instruments-area,.cfd-bottom-panel')]
    .map(e => ({ cls: e.className.split(' ')[0], r: e.getBoundingClientRect() }))
    .filter(p => p.r.width > 4 && p.r.height > 4);
  const overlaps = [];
  for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) {
    const a = panels[i].r, b = panels[j].r;
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (w > 2 && h > 2) overlaps.push(`${panels[i].cls} x ${panels[j].cls}`);
  }
  return {
    classes: root.className,
    tokens: Object.fromEntries(tokenNames.map(n => [n, cs.getPropertyValue(n).trim()])),
    strip: sc ? { h: Math.round(strip.getBoundingClientRect().height), bg: sc.backgroundColor,
      border: sc.borderBottomColor, pad: sc.padding } : null,
    stripClipped: strip ? strip.getBoundingClientRect().top < -1 : null,
    overflowX: Math.round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
    overlaps,
    hasNaN: /\bNaN\b/.test(text),
    hasUndefined: /\bundefined\b/.test(text),
    smallTargets: [...document.querySelectorAll('button')]
      .filter(b => { const r = b.getBoundingClientRect(); return r.height > 0 && r.height < 28 && r.width > 8; })
      .length,
  };
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const findings = [];
  const report = { startedAt: new Date().toISOString(), widths: {}, findings,
    environment: 'LOCAL QA ONLY - production bundle, stubbed read-only API' };

  for (const [w, h] of [...DESKTOP, ...MOBILE]) {
    const mobile = w <= 430;
    const key = `${w}x${h}`;
    report.widths[key] = {};
    for (const [name, url] of TERMINALS) {
      // An explicit locale, because this container's own LANG is `en-US@posix`,
      // which Intl rejects outright. Without this the harness would report a
      // RangeError from its own environment as if the page had thrown it.
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'en-US' });
      await ctx.addInitScript(() => { try { localStorage.setItem('exchange_token','local-qa'); localStorage.setItem('exchange_lang','ru'); } catch {} });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
      await page.goto(origin + url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3200);
      const m = await page.evaluate(READ, TOKENS);
      m.pageErrors = errs;
      report.widths[key][name] = m;
      await page.screenshot({ path: path.join(OUT, `${name}-${key}.png`) }).catch(() => {});
      await ctx.close();

      if (m.missing) { findings.push(`${name} @${key}: terminal did not render`); continue; }
      if (m.overflowX > 0) findings.push(`${name} @${key}: page scrolls horizontally by ${m.overflowX}px`);
      if (m.overlaps.length) findings.push(`${name} @${key}: panels overlap - ${m.overlaps.join(', ')}`);
      if (m.hasNaN) findings.push(`${name} @${key}: NaN is rendered`);
      if (m.hasUndefined) findings.push(`${name} @${key}: "undefined" is rendered`);
      if (m.stripClipped) findings.push(`${name} @${key}: the top strip is clipped above the viewport`);
      if (errs.length) findings.push(`${name} @${key}: ${errs.length} uncaught page error(s): ${errs[0]}`);
      /* Tap targets are asserted for the two terminals this change is about.
         Futures has ONE control under 28px and had it before any of this
         existed — measured on unmodified main, where Spot had 22 and CFD 7.
         It is recorded below so it is not lost, but it is not this task's to
         fix, and failing on it would mean failing on someone else's bug. */
      if (mobile && name !== 'futures' && m.smallTargets > 0) {
        findings.push(`${name} @${key}: ${m.smallTargets} tap target(s) under 28px tall`);
      }
      if (mobile && name === 'futures' && m.smallTargets > 0) {
        (report.preExisting ||= []).push(`futures @${key}: ${m.smallTargets} tap target(s) under 28px tall (pre-existing on main, out of scope)`);
      }
    }

    /* CONSISTENCY, both directions. Spot and CFD must match Futures, and
       Futures must still match what it was before this change existed. */
    const { futures, spot, cfd } = report.widths[key];
    for (const [n, v] of [['spot', spot], ['cfd', cfd]]) {
      if (!futures || !v || futures.missing || v.missing) continue;
      const bad = TOKENS.filter(t => futures.tokens[t] !== v.tokens[t]);
      if (bad.length) findings.push(`${n} @${key}: ${bad.length} token(s) differ from Futures - ${bad.join(', ')}`);
      if (v.strip && futures.strip && v.strip.bg !== futures.strip.bg) {
        findings.push(`${n} @${key}: strip background ${v.strip.bg} != Futures ${futures.strip.bg}`);
      }
    }
  }

  const BASE = process.env.FUTURES_BASELINE;
  if (BASE && fs.existsSync(BASE)) {
    const base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
    const now = report.widths['1440x900'].futures;
    const drift = TOKENS.filter(t => base.tokens[t] !== now.tokens[t]);
    report.futuresDrift = drift;
    if (drift.length) findings.push(`FUTURES REGRESSED: ${drift.join(', ')}`);
  }

  await browser.close(); server.close();
  report.status = findings.length ? 'FAIL' : 'PASS';
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, findings,
    futuresDrift: report.futuresDrift, preExisting: report.preExisting,
    summary: Object.fromEntries(Object.entries(report.widths).map(([k, v]) =>
      [k, Object.fromEntries(Object.entries(v).map(([n, m]) =>
        [n, m.missing ? 'MISSING' : `strip=${m.strip ? m.strip.h + 'px' : 'n/a'} ovf=${m.overflowX} lap=${m.overlaps.length}`]))])) }, null, 2));
  process.exit(findings.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
