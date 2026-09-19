#!/usr/bin/env node
/**
 * The Futures bottom panel — tabs, table, empty state — in a real browser.
 *
 * LOCAL PRESENTATION QA ONLY. Fixture data, reads only, every write 404s.
 * No production account, database or external call.
 *
 * Both states are driven, because they fail in opposite directions: an
 * empty panel fails by being a black hole, a full one by being a raw grid.
 * `--positions empty|filled` picks which, and the run measures what the
 * eye is actually complaining about — how much of the panel is dead space,
 * how the tabs are weighted, and whether the table's rows and columns have
 * a rhythm.
 *
 *   node scripts/qa-futures-bottom-panel.cjs [--dist path] [--label before]
 *
 * QA_MEASURE_ONLY=1 measures and screenshots without asserting, which is
 * how the "before" half is taken against a build that predates this work.
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DIST = path.resolve(arg('--dist', path.join(ROOT, 'frontend', 'dist')));
const PORT = Number(arg('--port', '4330'));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'docs', 'qa', 'futures-bottom-panel')));
const LABEL = arg('--label', 'after');
const MEASURE_ONLY = process.env.QA_MEASURE_ONLY === '1';
const WIDTHS = (arg('--widths', '1920,1664,1440,1366')).split(',').map(Number);

const express = require('express');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

/** One open position, so the table renders with real-shaped values. */
const POSITION = {
  id: 'qa-pos-1', symbol: 'BTC/USDT', side: 'LONG', size: '0.250',
  entryPrice: '77260.40', leverage: 10, marginType: 'CROSS',
  initialMargin: '1931.51', liquidationPrice: '70118.20', markPrice: '77840.10',
  unrealizedPnl: '144.93', realizedPnl: '0', roe: '7.50',
  openedAt: new Date().toISOString(),
  protection: { takeProfit: null, stopLoss: null },
};

function start(positions) {
  const app = express();
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.get('/api/v1/me', (_q, r) => r.json({ id: 'qa-user', email: 'qa@example.invalid', role: 'USER' }));
  // An ORDINARY account. Without this the page cannot tell, and
  // useNativeFuturesExecution deliberately returns a non-ready NATIVE
  // execution rather than falling through to the real-money routes — which
  // leaves the panel on "Загрузка..." forever and the table never renders.
  app.get('/api/v1/private-trading/access', (_q, r) =>
    r.json({ allowed: false, mode: 'ORDINARY', nativeAvailable: false, simulationOnly: false }));
  app.get('/api/v1/futures/positions', (_q, r) => r.json(positions));
  app.get('/api/v1/futures/positions/history', (_q, r) => r.json([]));
  app.get('/api/v1/futures/orders/me', (_q, r) => r.json([]));
  app.get(['/api/v1/balances', '/api/v1/futures/balances', '/api/v1/orders', '/api/v1/orders/me'], (_q, r) => r.json([]));
  app.get('/api/v1/market/external/rankings', (_q, r) => r.json({ source: 'LOCAL TEST FIXTURE', rankings: [] }));
  app.get('/api/v1/support/conversations/mine', (_q, r) => r.json({ conversation: null, messages: [] }));
  app.get('/api/v1/deposit-chains', (_q, r) => r.json([]));
  app.get('/api/v1/market/assets/icons', (req, r) => {
    const symbols = String(req.query.symbols || '').split(',').filter(Boolean);
    r.json({ assets: Object.fromEntries(symbols.map(s => [s, { id: `qa:${s.toLowerCase()}`, name: s, logoUrl: null }])) });
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
    req.on('error', () => Date.now() > deadline ? reject(new Error('no harness')) : setTimeout(attempt, 150));
  };
  attempt();
});

/**
 * What the panel is actually made of.
 *
 * DEAD SPACE is the number the complaint is about: the share of the panel's
 * own height that no content occupies. It is measured as the panel's height
 * minus everything its header, its column headings and its rows take, so it
 * cannot be argued with.
 */
const measure = (page) => page.evaluate(() => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top), bottom: Math.round(r.bottom),
      width: Math.round(r.width), height: Math.round(r.height) };
  };
  const one = (sel) => box(document.querySelector(sel));
  const panel = document.querySelector('.bottom-panel');
  const header = document.querySelector('.bottom-panel .terminal-account-header');
  const content = document.querySelector('.bottom-content');
  const rows = [...document.querySelectorAll('.futures-positions-table tbody tr')];
  const headCells = [...document.querySelectorAll('.futures-positions-table thead th')];
  const emptyState = document.querySelector('.futures-position-state');
  const tabs = [...document.querySelectorAll('.bottom-tabs .bottom-tab')];
  const styleOf = (el, props) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p).trim()]));
  };
  const active = tabs.find(t => t.getAttribute('aria-selected') === 'true') || null;
  const inactive = tabs.find(t => t.getAttribute('aria-selected') !== 'true') || null;

  const panelBox = box(panel);
  const contentBox = box(content);
  const occupied = (() => {
    if (!contentBox) return 0;
    const parts = [
      ...headCells.slice(0, 1).map(box),
      ...rows.map(box),
      box(emptyState),
      box(document.querySelector('.futures-state-columns')),
    ].filter(Boolean);
    if (!parts.length) return 0;
    const top = Math.min(...parts.map(p => p.top));
    const bottom = Math.max(...parts.map(p => p.bottom));
    return Math.max(0, bottom - top);
  })();

  return {
    panel: panelBox,
    header: box(header),
    content: contentBox,
    // The share of the content area nothing occupies.
    deadSpacePx: contentBox ? Math.max(0, contentBox.height - occupied) : null,
    deadSpacePct: contentBox && contentBox.height
      ? Math.round((Math.max(0, contentBox.height - occupied) / contentBox.height) * 100) : null,
    rowCount: rows.length,
    rowHeights: [...new Set(rows.map(r => Math.round(r.getBoundingClientRect().height)))],
    columnCount: headCells.length,
    headHeight: headCells.length ? Math.round(headCells[0].getBoundingClientRect().height) : null,
    emptyState: emptyState ? {
      box: box(emptyState),
      text: emptyState.textContent.trim().slice(0, 60),
      iconSize: emptyState.querySelector('svg')
        ? Math.round(emptyState.querySelector('svg').getBoundingClientRect().width) : null,
      centred: (() => {
        const e = box(emptyState), c = contentBox;
        if (!e || !c) return null;
        const left = e.left - c.left;
        const right = (c.left + c.width) - (e.left + e.width);
        return Math.abs(left - right) <= 4;
      })(),
      // The complaint was a black hole, which is what an empty state
      // clinging to the top of the panel looks like. Measured as how much
      // taller the space below it is than the space above it.
      voidBelowPx: (() => {
        const e = box(emptyState), c = contentBox;
        return e && c ? Math.round((c.top + c.height) - e.bottom) : null;
      })(),
      fillsContent: (() => {
        const e = box(emptyState), c = contentBox;
        return e && c ? Math.round(e.height) >= Math.round(c.height) - 34 : null;
      })(),
    } : null,
    tabCount: tabs.length,
    tabLabels: tabs.map(t => t.textContent.trim()),
    tabHeight: tabs.length ? Math.round(tabs[0].getBoundingClientRect().height) : null,
    activeTab: styleOf(active, ['color', 'font-weight', 'border-bottom-width', 'border-bottom-color']),
    inactiveTab: styleOf(inactive, ['color', 'font-weight', 'border-bottom-width', 'border-bottom-color']),
    // The leverage-tier block in the order ticket, which the owner said
    // breaks the composition beside this panel.
    tiers: (() => {
      const details = document.querySelector('.fo-tiers, details:has(.fo-tiersTitle)');
      const summary = document.querySelector('.fo-tiersTitle');
      return summary ? {
        box: box(summary), open: details ? details.hasAttribute('open') : null,
        style: styleOf(summary, ['font-size', 'color', 'background-color', 'border-top-width']),
      } : null;
    })(),
    // The strip of column headings the empty state draws over nothing. The
    // owner sees it on an account with no positions and it is the thing
    // that makes the panel look broken rather than simply empty, so it is
    // measured on its own rather than inferred from a gap.
    emptyColumns: (() => {
      const strip = document.querySelector('.futures-state-columns');
      if (!strip) return null;
      const th = [...strip.querySelectorAll('th')];
      return { box: box(strip), count: th.length,
        labels: th.map(c => c.textContent.trim()).slice(0, 12),
        fontSize: th[0] ? getComputedStyle(th[0]).fontSize : null };
    })(),
    // Sizes, because "readable" is a number before it is an opinion.
    type: {
      tab: styleOf(tabs[0], ['font-size', 'line-height']),
      th: styleOf(headCells[0] || document.querySelector('.futures-state-columns th'), ['font-size', 'line-height', 'color']),
      td: styleOf(document.querySelector('.futures-positions-table tbody td'), ['font-size', 'line-height', 'color']),
      // The money columns specifically: whatever the row renders as a figure.
      money: styleOf(document.querySelector('.futures-position-money, .futures-positions-table tbody td .mono'),
        ['font-size', 'line-height', 'color']),
    },
    // Anything whose text no longer fits the box it is painted in.
    clipped: [...document.querySelectorAll('.bottom-panel *')]
      .filter(el => !el.children.length && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1)
      .slice(0, 12)
      .map(el => ({ cls: String(el.className).slice(0, 40), text: (el.textContent || '').trim().slice(0, 24),
        scroll: el.scrollWidth, client: el.clientWidth })),
    // The global header, which the owner asked to carry a larger brand.
    brand: (() => {
      const link = document.querySelector('.header-brand');
      if (!link) return null;
      const svg = link.querySelector('svg');
      // The SVG's own ink, not its 40x40 viewBox with the padding around it.
      let ink = null;
      if (svg) {
        try {
          const bb = svg.getBBox();
          const r = svg.getBoundingClientRect();
          const vb = svg.viewBox.baseVal;
          const scale = vb && vb.width ? r.width / vb.width : 1;
          ink = { w: Math.round(bb.width * scale * 10) / 10, h: Math.round(bb.height * scale * 10) / 10 };
        } catch { ink = null; }
      }
      // The wordmark's real cap-to-baseline ink, measured through a canvas
      // in the element's own resolved font rather than read off line-height.
      const word = [...link.querySelectorAll('span')]
        .find(s => (s.textContent || '').replace(/\s+/g, '') === 'VOLTEX');
      let wordInk = null;
      if (word) {
        const cs = getComputedStyle(word);
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const m = ctx.measureText('VOLTEX');
        wordInk = { h: Math.round((m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) * 10) / 10,
          w: Math.round(m.width * 10) / 10, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
          letterSpacing: cs.letterSpacing };
      }
      const nav = document.querySelector('.top-nav-link, header a[href="/markets"], nav a');
      return { link: box(link), markBox: box(svg), markInk: ink, wordInk,
        header: box(document.querySelector('header, .top-nav, .app-header')),
        navFontSize: nav ? getComputedStyle(nav).fontSize : null,
        wallet: box(document.querySelector('.nav-wallet-link')),
        deposit: box(document.querySelector('.deposit-button')) };
    })(),
    // The order ticket keeps its own text scale; --text-secondary does not
    // reach it, so its resolved values are recorded beside the panel's.
    ticket: (() => {
      const root = document.querySelector('.fo-panel');
      if (!root) return null;
      const cs = getComputedStyle(root);
      return Object.fromEntries(['--fo-text', '--fo-text-2', '--fo-text-3', '--fo-surface', '--fo-control']
        .map(n => [n, cs.getPropertyValue(n).trim()]));
    })(),
    overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    // Horizontal scroll INSIDE the table is a real complaint about width,
    // separate from the page overflowing.
    tableScrollX: (() => {
      const s = document.querySelector('.futures-positions-scroll, .futures-state-columns');
      return s ? Math.max(0, s.scrollWidth - s.clientWidth) : null;
    })(),
  };
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = {};
  let browser;
  let server;

  try {
    browser = await chromium.launch({ args: ['--no-sandbox'] });

    for (const fill of ['empty', 'filled']) {
      server = start(fill === 'filled' ? [POSITION] : []);
      await waitForServer();

      for (const width of WIDTHS) {
        const context = await browser.newContext({ viewport: { width, height: 940 } });
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', (e) => pageErrors.push(String(e)));
        await page.addInitScript(() => {
          localStorage.setItem('exchange_token', 'qa-token');
          localStorage.setItem('exchange_lang', 'ru');
        });
        await page.goto(`http://127.0.0.1:${PORT}/futures`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2200);

        // The panel auto-compacts when there is nothing in it, so a
        // measurement taken on arrival would be of a 44px strip rather than
        // of the panel the owner is looking at. Press the tab first, which
        // is what reveals it — and is what a trader does.
        const openTab = page.locator('.bottom-tabs .bottom-tab').nth(1);
        if (await openTab.count()) { await openTab.click(); await page.waitForTimeout(400); }

        const key = `${fill}-${width}`;
        const view = report[key] = await measure(page);
        view.pageErrors = pageErrors;
        await page.screenshot({ path: path.join(OUT, `${LABEL}-${key}.png`) });
        // The panel on its own, which is what the owner is looking at.
        const panel = await page.locator('.bottom-panel').first();
        if (await panel.count()) {
          await panel.screenshot({ path: path.join(OUT, `${LABEL}-${key}-panel.png`) }).catch(() => {});
        }

        // Every tab must still switch — the redraw is styling, not wiring.
        if (fill === 'empty' && !MEASURE_ONLY) {
          view.tabSwitching = [];
          for (const label of view.tabLabels) {
            const tab = page.locator('.bottom-tabs .bottom-tab', { hasText: label.replace(/\s*\(.*\)$/, '') }).first();
            await tab.click();
            await page.waitForTimeout(220);
            view.tabSwitching.push({
              label,
              selected: await tab.getAttribute('aria-selected'),
              panelRendered: await page.locator('#futures-bottom-content').first().isVisible(),
            });
          }
        }

        await context.close();
      }
      server.close();
      server = null;
    }

    if (!MEASURE_ONLY) {
      for (const [key, view] of Object.entries(report)) {
        const [fill, width] = key.split('-');
        assert.equal(view.pageErrors.length, 0, `${key}: page errors ${view.pageErrors.join('; ')}`);
        assert.equal(view.overflowX, 0, `${key}: horizontal page overflow`);
        assert.equal(view.tabCount, 5, `${key}: expected five tabs, saw ${view.tabCount}`);

        // The tabs read as a set: one rhythm, one active marker.
        assert.ok(view.activeTab, `${key}: no active tab`);
        assert.notEqual(view.activeTab.color, view.inactiveTab.color,
          `${key}: the active tab is not distinguished by colour`);
        const rule = parseFloat(view.activeTab['border-bottom-width']);
        assert.ok(rule > 0 && rule <= 2,
          `${key}: the active tab's underline is ${rule}px — it should be a hairline, not a slab`);
        // Invisible, not absent. The inactive tab keeps a transparent
        // hairline so selecting one does not shift its text by a pixel —
        // what must not happen is that it can be SEEN.
        const inactiveRule = parseFloat(view.inactiveTab['border-bottom-width']);
        const inactiveColour = view.inactiveTab['border-bottom-color'];
        assert.ok(inactiveRule === 0 || /rgba\(.*,\s*0\)$/.test(inactiveColour) || inactiveColour === 'transparent',
          `${key}: an inactive tab carries a visible underline (${inactiveRule}px ${inactiveColour})`);

        if (fill === 'empty') {
          assert.ok(view.emptyState, `${key}: no empty state rendered`);
          assert.equal(view.emptyState.centred, true, `${key}: the empty state is not centred horizontally`);
          assert.ok(view.emptyState.iconSize && view.emptyState.iconSize <= 28,
            `${key}: the empty-state icon is ${view.emptyState.iconSize}px — restrained means small`);
          // The black hole: an empty state sitting against the top with the
          // rest of the panel left dark. It has to take the space it is in
          // and centre itself inside it.
          assert.equal(view.emptyState.fillsContent, true,
            `${key}: the empty state is ${view.emptyState.box.height}px inside a ${view.content.height}px panel`);
          assert.ok(view.emptyState.voidBelowPx !== null && view.emptyState.voidBelowPx <= 24,
            `${key}: ${view.emptyState.voidBelowPx}px of dark panel below the empty state`);
          for (const step of view.tabSwitching || []) {
            assert.equal(step.selected, 'true', `${key}: tab "${step.label}" did not select`);
            assert.equal(step.panelRendered, true, `${key}: tab "${step.label}" rendered no panel`);
          }
        } else {
          assert.ok(view.rowCount > 0, `${key}: the filled fixture rendered no rows`);
          assert.equal(view.rowHeights.length, 1,
            `${key}: rows have ${view.rowHeights.length} different heights: ${view.rowHeights.join(', ')}`);
          assert.ok(view.rowHeights[0] >= 40 && view.rowHeights[0] <= 72,
            `${key}: row height ${view.rowHeights[0]}px is outside a readable band`);
          assert.equal(view.tableScrollX, 0,
            `${key}: the table scrolls sideways by ${view.tableScrollX}px inside its panel`);
        }
      }
    }

      // THE RHYTHM IS THE POINT. A row and a heading band that change
      // height with the viewport is what made the table read as
      // unfinished; one value across every width is the fix, and it is
      // asserted across the widths rather than inside each one.
      const filled = Object.entries(report).filter(([k]) => k.startsWith('filled-'));
      const rowHeights = new Set(filled.flatMap(([, v]) => v.rowHeights));
      assert.equal(rowHeights.size, 1,
        `rows are ${[...rowHeights].join(', ')}px across the four widths — they must be one height`);
      const headHeights = new Set(filled.map(([, v]) => v.headHeight));
      assert.equal(headHeights.size, 1,
        `column headings are ${[...headHeights].join(', ')}px across the four widths`);
      const tabHeights = new Set(Object.values(report).map((v) => v.tabHeight));
      assert.equal(tabHeights.size, 1,
        `the tab row is ${[...tabHeights].join(', ')}px across the views`);

    fs.writeFileSync(path.join(OUT, `${LABEL}-metrics.json`),
      JSON.stringify({ status: MEASURE_ONLY ? 'MEASURED' : 'PASS', label: LABEL, report }, null, 2));
    console.log(JSON.stringify({
      status: MEASURE_ONLY ? 'MEASURED' : 'PASS',
      perView: Object.fromEntries(Object.entries(report).map(([k, v]) => [k, {
        panelHeight: v.panel?.height ?? null,
        deadSpacePx: v.deadSpacePx, deadSpacePct: v.deadSpacePct,
        rowCount: v.rowCount, rowHeights: v.rowHeights, headHeight: v.headHeight,
        tabHeight: v.tabHeight,
        activeUnderline: v.activeTab?.['border-bottom-width'] ?? null,
        activeColor: v.activeTab?.color ?? null,
        inactiveColor: v.inactiveTab?.color ?? null,
        emptyIcon: v.emptyState?.iconSize ?? null,
        tiersFontSize: v.tiers?.style?.['font-size'] ?? null,
        tableScrollX: v.tableScrollX,
        pageErrors: v.pageErrors.length,
      }])),
    }, null, 2));
  } catch (error) {
    fs.writeFileSync(path.join(OUT, `${LABEL}-metrics.json`),
      JSON.stringify({ status: 'FAIL', error: String(error && error.message || error), report }, null, 2));
    console.error('FAIL', error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (server) server.close();
  }
})();
