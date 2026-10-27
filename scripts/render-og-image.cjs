#!/usr/bin/env node
/**
 * Renders frontend/public/og-image.svg to frontend/public/og-image.png
 * (1200×630), the raster copy social networks and search previews accept
 * for og:image. The picture is the existing SVG, unchanged; Inter comes from
 * frontend/public/fonts so the text renders the same on every machine.
 *   node scripts/render-og-image.cjs [path to playwright]
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.argv[2] || 'playwright');

const pub = path.resolve(__dirname, '../frontend/public');
const font = (file) => `data:font/woff2;base64,${fs.readFileSync(path.join(pub, 'fonts/inter', file)).toString('base64')}`;
const faces = ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext'].map((subset) => [600, 800].map((weight) =>
  `@font-face{font-family:Inter;font-weight:${weight};src:url(${font(`${subset}.woff2`)}) format('woff2')}`).join('')).join('');
const svg = fs.readFileSync(path.join(pub, 'og-image.svg'), 'utf8');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><style>${faces}html,body{margin:0;background:#0b0e11}svg{display:block}</style>${svg}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(pub, 'og-image.png'), clip: { x: 0, y: 0, width: 1200, height: 630 } });
  await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
