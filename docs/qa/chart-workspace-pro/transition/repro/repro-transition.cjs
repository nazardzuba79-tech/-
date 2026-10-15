// Reproduction used for owner review 5518558556 (PR #520, 2026-10-14): AITH/USDT Spot 1440, layout 2 → 1 →
// «К дате», with the toolbar's painted states sampled every frame (requestAnimationFrame), its mutations
// (MutationObserver) and ResizeObserver callbacks, a Playwright trace and a video per run.
//
//   node scripts/qa-chart-workspace.cjs --serve --dist frontend/dist --port 4517      # the loopback fixture
//   QA_PLAYWRIGHT_MODULE=… node docs/qa/chart-workspace-pro/transition/repro/repro-transition.cjs \
//     --origin http://127.0.0.1:4517 --out <dir> --mode old --throttle 4 --runs 2 [--stress] [--market futures --pair BTC/USDT] [--width 1366]
//
// --mode old drives the page with the helper exactly as it was in 9a112675 (the CI failure), so the
// before/after runs differ only by the bundle. --throttle sets the CPU slowdown (CDP); --stress changes the
// row's padding by 1 px every frame for 90 frames to force extra ResizeObserver passes.
// Reproduce AITH 1440: layout 2 → 1 → «К дате» with toolbar lifecycle evidence (owner review 5518558556, P1).
// node cw2-repro-transition.cjs --origin http://127.0.0.1:PORT --out DIR --mode old|new --throttle 4 [--runs 1] [--width 1440] [--pair AITH/USDT] [--timeout 12000]
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const ORIGIN = arg('--origin'), OUT = arg('--out'), MODE = arg('--mode', 'new'), THROTTLE = Number(arg('--throttle', '1'));
const WIDTH = Number(arg('--width', '1440')), PAIR = arg('--pair', 'AITH/USDT'), RUNS = Number(arg('--runs', '1')), TIMEOUT = Number(arg('--timeout', '12000'));
const MARKET = arg('--market', 'spot'), STRESS = args.includes('--stress');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
fs.mkdirSync(OUT, { recursive: true });

const menuBox = () => {
  const el = document.querySelector('[data-cw-menu], [data-cw-menu-layer] .cw-menu, [data-cw-menu-layer] .cw-sheet');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { id: el.getAttribute('data-cw-menu'), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
};
// The helper as shipped in 9a112675 (the CI failure).
async function openFeatureOld(page, feature) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.keyboard.press('Escape');
    const trigger = page.locator(`[data-cw-feature="${feature}"]`).first();
    let action = false;
    if (!(await trigger.count()) || !(await trigger.isVisible())) {
      const more = page.locator('[data-cw-feature="more"]');
      if (await more.count()) { await more.click(); await page.waitForTimeout(150); const item = page.locator(`[data-cw-menu="more"] [data-cw-feature="${feature}"]`).first(); if (await item.count()) { await item.click(); action = true; } }
    } else { await trigger.click(); action = !(await trigger.getAttribute('aria-haspopup')); }
    await page.waitForTimeout(220);
    const box = await page.evaluate(menuBox);
    if (box || action) return box;
    await page.waitForTimeout(300);
  }
  return page.evaluate(menuBox);
}
// The helper as in fa76e844.
async function settleToolbar(page, { timeout = 3000 } = {}) {
  const read = () => page.evaluate(() => {
    const row = document.querySelector('[data-cw-toolbar]');
    if (!row) return null;
    const r = row.getBoundingClientRect();
    return { measured: row.classList.contains('is-measured'), menu: !!document.querySelector('[data-cw-menu]'),
      keys: [...row.querySelectorAll('[data-cw-feature]')].map(el => { const b = el.getBoundingClientRect(); return `${el.getAttribute('data-cw-feature')}@${Math.round(b.left)},${Math.round(b.top)}`; }).join('|'),
      box: `${Math.round(r.width)}x${Math.round(r.height)}` };
  });
  const deadline = Date.now() + timeout;
  let previous = null;
  while (Date.now() < deadline) {
    const now = await read();
    if (!now) return false;
    if (now.measured && previous && previous.keys === now.keys && previous.box === now.box) return true;
    previous = now;
    await page.waitForTimeout(150);
  }
  return false;
}
async function openFeatureNew(page, feature) {
  const ATTEMPTS = 3;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-cw-menu]'), null, { timeout: 1500 }).catch(() => {});
    await settleToolbar(page);
    const trigger = page.locator(`[data-cw-toolbar] [data-cw-feature="${feature}"]`).first();
    let action = false;
    try {
      if (!(await trigger.count()) || !(await trigger.isVisible())) {
        const more = page.locator('[data-cw-toolbar] [data-cw-feature="more"]');
        if (await more.count()) {
          await more.click({ timeout: 5000 }); await page.waitForTimeout(150);
          const item = page.locator(`[data-cw-menu="more"] [data-cw-feature="${feature}"]`).first();
          if (await item.count()) { await item.click({ timeout: 5000 }); action = true; }
        }
      } else { await trigger.click({ timeout: 5000 }); action = !(await trigger.getAttribute('aria-haspopup')); }
    } catch (error) {
      if (attempt === ATTEMPTS - 1) throw error;
      console.log(`  retry ${feature}: ${String(error.message || error).split('\n')[0].slice(0, 120)}`);
      await page.waitForTimeout(300);
      continue;
    }
    await page.waitForTimeout(220);
    const box = await page.evaluate(menuBox);
    if (box || action) return box;
    await page.waitForTimeout(300);
  }
  return page.evaluate(menuBox);
}

const INIT = () => {
  window.__cwLife = { ro: [], mutations: [], frames: [], marks: [] };
  const RO = window.ResizeObserver;
  if (RO) window.ResizeObserver = class extends RO {
    constructor(cb) { super((entries, obs) => { window.__cwLife.ro.push({ t: Math.round(performance.now()), targets: entries.map(e => (e.target.className || '').toString().split(' ').slice(0, 2).join('.').slice(0, 40)) }); cb(entries, obs); }); }
  };
};
const INSTALL = () => {
  const row = document.querySelector('[data-cw-toolbar]');
  const keys = () => [...row.querySelectorAll('.cw-features [data-cw-feature]')].map(e => e.getAttribute('data-cw-feature')).join(' ');
  const state = () => {
    const el = row.querySelector('.cw-features [data-cw-feature="goto"]'); const r = el && el.getBoundingClientRect();
    return { keys: keys(), measured: row.classList.contains('is-measured'), more: row.getAttribute('data-cw-more'), dense: row.getAttribute('data-cw-dense'), width: row.clientWidth,
      menu: document.querySelector('[data-cw-menu]')?.getAttribute('data-cw-menu') || null, goto: r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null,
      cell: Math.round(document.querySelector('.cw-layout-cell.is-main')?.getBoundingClientRect().width || 0), parts: parts() };
  };
  const parts = () => {
    const w = el => el ? Math.round(el.getBoundingClientRect().width * 10) / 10 : null;
    const start = row.querySelector('.cw-start'), strip = start?.firstElementChild;
    const cs = strip ? getComputedStyle(strip) : null;
    return { start: w(start), startScroll: start?.scrollWidth ?? null, strip: w(strip), stripScroll: strip?.scrollWidth ?? null, stripClient: strip?.clientWidth ?? null, stripOverflow: cs ? cs.overflowX : null,
      stripKids: strip ? [...strip.children].map(c => (c.getAttribute('data-cw-tf') || (c.classList.contains('cw-tf-more') ? '▾' : c.tagName)) + ':' + w(c) + (c.scrollWidth > c.clientWidth + 1 ? '!' : '')).join(' ') : null,
      menus: w(row.querySelector('.cw-menus')), end: w(row.querySelector('.cw-end')), more: w(row.querySelector('.cw-features > [data-cw-feature="more"]')),
      keys: Object.fromEntries([...row.querySelectorAll('.cw-features .cw-feature-wrap > [data-cw-feature]')].map(e => [e.getAttribute('data-cw-feature'), w(e)])), features: w(row.querySelector('.cw-features')) };
  };
  const ids = nodes => { const out = []; for (const n of nodes) { if (n.nodeType !== 1) continue; const id = n.getAttribute('data-cw-feature') || n.querySelector?.('[data-cw-feature]')?.getAttribute('data-cw-feature'); if (id) out.push(id); } return out; };
  const mo = new MutationObserver(records => {
    const added = [], removed = [], attrs = new Set();
    for (const r of records) { added.push(...ids(r.addedNodes)); removed.push(...ids(r.removedNodes)); if (r.type === 'attributes') attrs.add(r.attributeName); }
    if (added.length || removed.length || attrs.size) window.__cwLife.mutations.push({ t: Math.round(performance.now()), added, removed, attrs: [...attrs], ...state() });
  });
  mo.observe(row, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-cw-more', 'data-cw-dense'] });
  let n = 0;
  const tick = () => { const s = state(); const last = window.__cwLife.frames.at(-1); if (!last || last.keys !== s.keys || last.width !== s.width || last.measured !== s.measured || String(last.goto) !== String(s.goto) || last.menu !== s.menu || last.cell !== s.cell) window.__cwLife.frames.push({ t: Math.round(performance.now()), ...s }); if (n++ < 4000) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  window.__cwMark = name => window.__cwLife.marks.push({ t: Math.round(performance.now()), name });
  window.__cwMark('installed');
};

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const summary = [];
  for (let run = 1; run <= RUNS; run += 1) {
    const tag = `${MODE}-${MARKET}-x${THROTTLE}-${WIDTH}${STRESS ? '-stress' : ''}-${run}`;
    const videoDir = path.join(OUT, `video-${tag}`);
    const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 900 }, locale: 'ru-RU', recordVideo: { dir: videoDir, size: { width: WIDTH, height: 900 } } });
    await ctx.route('**/*', route => { const url = new URL(route.request().url()); return url.origin === ORIGIN && ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort(); });
    await ctx.addInitScript(INIT);
    await ctx.tracing.start({ screenshots: true, snapshots: true });
    const page = await ctx.newPage();
    page.setDefaultTimeout(TIMEOUT);
    const errors = [];
    page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
    const cdp = await ctx.newCDPSession(page);
    if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    const open = MODE === 'old' ? openFeatureOld : openFeatureNew;
    const result = { tag, mode: MODE, market: MARKET, stress: STRESS, throttle: THROTTLE, width: WIDTH, pair: PAIR, timeout: TIMEOUT };
    await page.goto(`${ORIGIN}${MARKET === 'futures' ? '/futures' : '/trade'}?pair=${encodeURIComponent(PAIR)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-chart-state="candles"]', { timeout: 20000 });
    await page.waitForTimeout(800);
    await page.evaluate(INSTALL);
    const mark = name => page.evaluate(n => window.__cwMark(n), name);
    try {
      result.rowAtLayout1 = await page.evaluate(() => [...document.querySelectorAll('[data-cw-toolbar] .cw-features [data-cw-feature]')].map(e => e.getAttribute('data-cw-feature')));
      await open(page, 'layout'); await mark('layout-menu-open');
      await mark('layout2-click'); await page.locator('[data-cw-layout-option="2"]').click();
      await page.waitForFunction(() => document.querySelectorAll('[data-cw-pane]').length === 1 && ['ok', 'failed', 'empty', 'error'].includes(document.querySelector('[data-cw-pane]')?.getAttribute('data-cw-pane-state')), null, { timeout: 12000 }).catch(() => {});
      await mark('pane-settled');
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);
      result.rowAtLayout2 = await page.evaluate(() => [...document.querySelectorAll('[data-cw-toolbar] .cw-features [data-cw-feature]')].map(e => e.getAttribute('data-cw-feature')));
      await open(page, 'layout'); await mark('layout-menu-open-2');
      await mark('layout1-click'); await page.locator('[data-cw-layout-option="1"]').click();
      // Optional stressor: the row's content box changes by 1 px every frame for ~90 frames, so the toolbar's
      // ResizeObserver callback (compute) runs on every rendering step of the transition.
      if (STRESS) await page.evaluate(() => { const row = document.querySelector('[data-cw-toolbar]'); let i = 0; const f = () => { row.style.paddingRight = (i++ % 2) ? '1px' : '0px'; if (i < 90) requestAnimationFrame(f); else row.style.paddingRight = ''; }; requestAnimationFrame(f); });
      await page.keyboard.press('Escape'); await mark('escape');
      const t0 = Date.now();
      let box = null, error = null;
      try { box = await open(page, 'goto'); } catch (e) { error = String(e.message || e).split('\n').filter(l => /Timeout|waiting for|resolved to|not stable|detached|intercepts|retrying/.test(l)).slice(0, 8); }
      await mark('goto-open-done');
      result.gotoOpenMs = Date.now() - t0; result.gotoMenu = box; result.gotoError = error;
      const dialog = await page.locator('[data-cw-goto]').count();
      result.dialogOpen = dialog > 0;
      if (result.dialogOpen) {
        await page.locator('[data-cw-goto-input]').fill('2026-01-05T10:00');
        await page.locator('[data-cw-goto-apply]').click(); await page.waitForTimeout(900); await mark('goto-applied');
        result.gotoStatus = await page.evaluate(() => document.querySelector('[data-cw-goto] [role="status"]')?.textContent || null);
      }
    } catch (e) { result.fatal = String(e.message || e).split('\n').slice(0, 6); }
    const life = await page.evaluate(() => window.__cwLife);
    life.toolbar = await page.evaluate(() => window.__cwTb || []);
    const at = name => life.marks.find(m => m.name === name)?.t ?? null;
    const t1 = at('layout1-click'), tDone = at('goto-open-done');
    const after = life.mutations.filter(m => t1 !== null && m.t >= t1);
    const frames = life.frames.filter(f => t1 !== null && f.t >= t1 && (tDone === null || f.t <= tDone));
    const settled = after.length ? after.at(-1).t - t1 : null;
    const settledKeys = frames.length ? frames.at(-1).keys : null;
    const states = frames.map(f => f.keys).filter((k, i, a) => i === 0 || a[i - 1] !== k);
    const vanished = [...new Set(frames.flatMap(f => f.keys.split(' ').filter(Boolean)))].filter(k => !(settledKeys || '').split(' ').includes(k));
    const transient = frames.filter(f => f.keys.split(' ').includes('goto') && !(settledKeys || '').split(' ').includes('goto'));
    result.lifecycle = { paintedStatesAfterLayout1: states, keysShownThenHidden: vanished, roCallbacksAfterLayout1: life.ro.filter(r => t1 !== null && r.t >= t1 && (tDone === null || r.t <= tDone)).length, mutationsAfterLayout1: after.length, lastMutationMsAfterLayout1: settled,
      framesAfterLayout1: frames.length, framesWithGotoOnRow: transient.length, firstGotoFrameMs: transient.length ? transient[0].t - t1 : null, lastGotoFrameMs: transient.length ? transient.at(-1).t - t1 : null,
      keySequence: frames.map(f => `${f.t - t1}ms: [${f.keys}] w=${f.width} cell=${f.cell} measured=${f.measured} more=${f.more} dense=${f.dense} menu=${f.menu} goto=${f.goto ? f.goto.join(',') : '-'}`) };
    result.errors = errors;
    fs.writeFileSync(path.join(OUT, `life-${tag}.json`), JSON.stringify({ result, life }, null, 1));
    await ctx.tracing.stop({ path: path.join(OUT, `trace-${tag}.zip`) });
    const video = page.video();
    await ctx.close();
    if (video) { const p = await video.path(); fs.renameSync(p, path.join(OUT, `video-${tag}.webm`)); fs.rmSync(videoDir, { recursive: true, force: true }); }
    const line = `${tag}: dialog=${result.dialogOpen} openMs=${result.gotoOpenMs} status=${JSON.stringify(result.gotoStatus || null)} error=${result.gotoError ? 'YES' : 'no'} paintedStates=${result.lifecycle.paintedStatesAfterLayout1.length} [${result.lifecycle.paintedStatesAfterLayout1.map(k => '(' + k + ')').join(' → ')}] shownThenHidden=[${result.lifecycle.keysShownThenHidden}] transientGotoFrames=${result.lifecycle.framesWithGotoOnRow} (first ${result.lifecycle.firstGotoFrameMs} ms, last ${result.lifecycle.lastGotoFrameMs} ms) ro=${result.lifecycle.roCallbacksAfterLayout1} mutations=${result.lifecycle.mutationsAfterLayout1} settled=${result.lifecycle.lastMutationMsAfterLayout1} ms row1=[${result.rowAtLayout1}] row2=[${result.rowAtLayout2}]`;
    console.log(line); summary.push(line);
    if (result.gotoError) console.log('   ' + result.gotoError.join('\n   '));
  }
  fs.appendFileSync(path.join(OUT, 'summary.log'), summary.join('\n') + '\n');
  await browser.close();
})().catch(e => { console.error(e); process.exit(2); });
