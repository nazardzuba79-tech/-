// Rasterize the existing VOLTEX favicon, retaining its artwork and colors.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.MOBILE_REVIEW_PLAYWRIGHT || 'playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const artwork = fs.readFileSync(path.resolve(__dirname, '../frontend/public/favicon.svg'), 'utf8');
    const dir = path.resolve(__dirname, '../frontend/mobile-review/public/mobile');
    fs.writeFileSync(path.join(dir, 'brand.svg'), artwork);
    for (const [size, maskable] of [[180,false],[192,false],[512,false],[512,true]]) {
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
      await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;background:#0a0c10}body{display:grid;place-items:center}svg{width:${maskable ? 68 : 100}%;height:${maskable ? 68 : 100}%}</style>${artwork}`);
      await page.screenshot({ path: path.join(dir, `icon-${maskable ? 'maskable-' : ''}${size}.png`) });
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
