'use strict';
/**
 * Disposable browser QA for the read-only CFD market-data UI.
 *
 * - Runs the actual compiled frontend and actual /cfd/tickers Express route.
 * - Uses the real public display router (BiQuote -> Deriv -> EIA fallback).
 * - Never connects to VOLTEX production, a database, user balances, orders or positions.
 * - Browser requests are loopback-only; TradingView and every other external
 *   browser request are blocked. Provider HTTP/WebSocket traffic belongs to the
 *   server-side display sources under test.
 */
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { randomBytes } = require('node:crypto');
const { chromium } = require(process.env.CFD_QA_PLAYWRIGHT || 'playwright');

process.env.JWT_SECRET ||= randomBytes(48).toString('hex');
process.env.API_KEY_ENCRYPTION_SECRET ||= randomBytes(32).toString('hex');
process.env.NODE_ENV = 'production';

const { CfdMarketDataService } = require('../dist/services/CfdMarketDataService');
const { cfdRouter } = require('../dist/api/routes/cfd');

const OUT = path.resolve('docs/qa/cfd-display-browser');
fs.mkdirSync(OUT, { recursive: true });
const report = {
  revision: process.env.GITHUB_SHA || null,
  environment: 'disposable loopback CI',
  startedAt: new Date().toISOString(),
  scenarios: [],
  localization: [],
  pageErrors: [],
  findings: [],
  blockedExternalHosts: [],
};
const deniedHosts = new Set();
let server;
let browser;
let activePage;

function noDatabase() {
  return new Proxy({}, { get() { throw new Error('Database access is forbidden in CFD display browser QA'); } });
}

function publicFixture(pathname) {
  if (pathname === '/market/external/tickers') return { source:'qa', tickers:[{
    pair:'BTC/USDT', lastPrice:'65000', changePercent24h:'1.25', quoteVolume24h:'1000000', high24h:'66000', low24h:'64000',
  }] };
  if (pathname === '/market/external/rankings') return { source:'qa', rankings:[] };
  if (pathname === '/market/global') return { source:'qa', global:null, fearGreed:null };
  if (pathname === '/futures/config') return { symbols:['BTC/USDT'], minLeverage:1, maxLeverage:100, highLeverageWarningThreshold:20, leverageTiers:[] };
  if (pathname.startsWith('/market/external/orderbook/')) return { pair:'BTC/USDT', bids:[], asks:[], timestamp:Date.now() };
  if (pathname.startsWith('/market/external/candles/')) return { pair:'BTC/USDT', interval:'15m', candles:[] };
  if (pathname.startsWith('/market/external/trades/')) return { pair:'BTC/USDT', trades:[] };
  if (pathname === '/support/conversations/mine') return { conversation:null, messages:[] };
  return null;
}

function initContext(context, target, lang='ru') {
  return context.addInitScript(({target,lang}) => {
    localStorage.setItem('exchange_lang', lang);
    if (target === 'cfd') localStorage.setItem('exchange_token','local-cfd-display-qa');
  }, {target,lang});
}

async function restrictBrowser(context, origin) {
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { deniedHosts.add(url.hostname); return route.abort(); }
    if (!['GET','HEAD'].includes(route.request().method())) return route.abort();
    return route.continue();
  });
}

(async () => {
  const data = new CfdMarketDataService(undefined);
  const noDb = noDatabase();
  const cfd = cfdRouter(noDb, data, noDb);
  const app = express();
  app.use((req,res,next) => {
    if (!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return res.sendStatus(403);
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy', "connect-src 'self'; form-action 'none'; object-src 'none'");
    if (!['GET','HEAD'].includes(req.method)) return res.status(405).json({error:'Read-only QA'});
    next();
  });
  app.use('/api/v1', (req,res,next) => {
    if (req.path === '/me') return res.json({
      id:'local-cfd-display-qa', email:'qa@example.invalid', displayName:'LOCAL QA', phone:null, country:null,
      avatarUrl:null, isAdmin:false, kycStatus:'NOT_STARTED', twoFactorEnabled:false, createdAt:'2026-01-01T00:00:00.000Z',
    });
    if (req.path.startsWith('/cfd/')) return cfd(req,res,next);
    const fixture = publicFixture(req.path);
    if (fixture) return res.json(fixture);
    return res.status(503).json({error:'Unavailable in isolated QA'});
  });
  app.use(express.static(path.resolve('frontend/dist')));
  app.get('*', (_req,res) => res.sendFile(path.resolve('frontend/dist/index.html')));
  server = await new Promise(resolve => {
    const s = app.listen(0,'127.0.0.1',() => resolve(s));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({headless:true,args:['--no-sandbox']});

  // Russian is the default VOLTEX locale. Check the complete visual surface
  // at desktop/tablet/mobile sizes so localized labels cannot reintroduce overflow.
  for (const width of [1920,1280,768,390]) {
    for (const target of ['home','cfd']) {
      const context = await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
      await initContext(context,target,'ru');
      await restrictBrowser(context,origin);
      const page = await context.newPage();
      activePage = page;
      page.on('pageerror', error => report.pageErrors.push({target,width,lang:'ru',error:error.message}));
      const href = target === 'home' ? '/' : '/trade?market=cfd&symbol=WTIUSD';
      await page.goto(origin + href,{waitUntil:'domcontentloaded'});
      if (target === 'home') {
        await page.locator('.vx-asset-gold').waitFor({state:'visible',timeout:15000});
        await page.locator('.vx-asset-oil').waitFor({state:'visible',timeout:15000});
        await page.waitForFunction(() => {
          const gold=document.querySelector('.vx-asset-gold')?.textContent||'';
          const oil=document.querySelector('.vx-asset-oil')?.textContent||'';
          return !gold.includes('—') && !oil.includes('—');
        }, {timeout:15000});
      } else {
        await page.locator('.cfd-option').first().waitFor({state:'visible',timeout:15000});
        await page.waitForFunction(() => document.querySelectorAll('.cfd-option').length === 13,{timeout:15000});
        await page.locator('.cfd-market-overview').waitFor({state:'visible',timeout:15000});
      }
      const result = await page.evaluate(target => ({
        pathname: location.pathname,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        rows: document.querySelectorAll('.cfd-option').length,
        gold: document.querySelector('.vx-asset-gold')?.textContent || null,
        oil: document.querySelector('.vx-asset-oil')?.textContent || null,
        overview: document.querySelector('.cfd-market-overview')?.textContent || null,
        coverage: document.querySelector('.cfd-data-coverage')?.textContent || null,
        submits: document.querySelectorAll('.cfd-terminal button[type=submit]').length,
        forms: document.querySelectorAll('.cfd-terminal form').length,
      }),target);
      report.scenarios.push({target,width,lang:'ru',...result});
      if (result.overflow) report.findings.push(`Horizontal overflow: ${target} ${width}px`);
      if (target === 'home') {
        if (!result.gold || result.gold.includes('—')) report.findings.push(`GOLD missing: ${width}px`);
        if (!result.oil || result.oil.includes('—')) report.findings.push(`OIL missing: ${width}px`);
      } else {
        if (result.rows !== 13) report.findings.push(`Expected 13 instruments, got ${result.rows}: ${width}px`);
        if (result.submits !== 0 || result.forms !== 0) report.findings.push(`Trading controls visible: ${width}px`);
        if (!result.overview?.includes('WTIUSD') || !result.overview?.includes('Несколько источников')) report.findings.push(`Localized WTI overview incomplete: ${width}px`);
        if (!result.coverage?.includes('Покрытие рынка')) report.findings.push(`Localized coverage panel incomplete: ${width}px`);
      }
      await page.screenshot({path:path.join(OUT,`${target}-ru-${width}.png`),fullPage:true});
      await context.close();
      activePage = null;
    }
  }

  // One real browser render per supported language. This is intentionally
  // separate from the width matrix to keep upstream provider traffic bounded.
  const translations = {
    ru:['Обзор рынка','Несколько источников'],
    en:['Market overview','Multi-source'],
    zh:['市场概览','多数据源'],
    es:['Resumen del mercado','Varias fuentes'],
    hi:['बाज़ार अवलोकन','मल्टी-सोर्स'],
    ja:['市場概要','複数ソース'],
    ko:['시장 개요','다중 소스'],
  };
  for (const [lang,[heading,feed]] of Object.entries(translations)) {
    const context = await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
    await initContext(context,'cfd',lang);
    await restrictBrowser(context,origin);
    const page = await context.newPage();
    activePage = page;
    page.on('pageerror', error => report.pageErrors.push({target:'cfd-localization',lang,error:error.message}));
    await page.goto(origin+'/trade?market=cfd&symbol=WTIUSD',{waitUntil:'domcontentloaded'});
    await page.locator('.cfd-market-overview').waitFor({state:'visible',timeout:15000});
    await page.waitForFunction(() => document.querySelectorAll('.cfd-option').length === 13,{timeout:15000});
    const text = await page.locator('.cfd-market-overview').innerText();
    const coverage = await page.locator('.cfd-data-coverage').innerText();
    const ok = text.includes(heading) && text.includes(feed);
    report.localization.push({lang,heading,feed,ok,overview:text,coverage});
    if (!ok) report.findings.push(`Localization missing: ${lang}`);
    await page.screenshot({path:path.join(OUT,`cfd-${lang}-1280.png`),fullPage:true});
    await context.close();
    activePage = null;
  }

  if (report.pageErrors.length) report.findings.push(`Browser errors: ${report.pageErrors.length}`);
})().catch(async error => {
  report.findings.push(error instanceof Error ? error.message : 'Browser QA failed');
  if (activePage && !activePage.isClosed()) {
    try { await activePage.screenshot({path:path.join(OUT,'failure.png'),fullPage:true,timeout:3000}); } catch {}
  }
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  report.blockedExternalHosts = [...deniedHosts].sort();
  report.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));
  console.log(`CFD_DISPLAY_BROWSER_REPORT ${JSON.stringify(report)}`);
  if (report.findings.length) process.exitCode = 1;
});
