// Rasterise the hero instrument SVGs to transparent PNGs with Chromium.
// usage: node raster-logos.cjs <svgDir> <outDir> <size>
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const [svgDir, outDir, sizeArg] = process.argv.slice(2);
  const size = Number(sizeArg || 512);
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  for (const file of fs.readdirSync(svgDir).filter((f) => f.endsWith('.svg'))) {
    const svg = fs.readFileSync(path.join(svgDir, file), 'utf8');
    const html = `<!doctype html><html><head><style>html,body{margin:0;background:transparent;width:${size}px;height:${size}px;overflow:hidden}img{display:block;width:${size}px;height:${size}px;object-fit:contain}</style></head><body><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body></html>`;
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForTimeout(50);
    const out = path.join(outDir, file.replace(/\.svg$/, '.png'));
    await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log(file, '->', out);
  }
  await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
