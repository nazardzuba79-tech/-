// Private research evidence only. Both charts use a linear price scale in
// model units. The thin violet OHLC outline is computed independently from raw CSV.
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const path = require('node:path'),
  fs = require('node:fs');
const run = path.resolve(__dirname, '../../output/history20-v2-verification');
const catalog = require('../../src/shared/history20Regimes.json');
const names = ['Початок', 'Середина', 'Кінець'];
function svg(bars, reference = []) {
  const w = 580,
    h = 90,
    dx = w / bars.length;
  const min = Math.min(...bars.map((x) => x.low)),
    max = Math.max(...bars.map((x) => x.high));
  const y = (v) => 4 + ((max - v) / (max - min || 1)) * (h - 8);
  function candles(series, outline) {
    return series
      .map((b, i) => {
        const x = (i + 0.5) * dx,
          c = outline ? '#713daa' : b.close >= b.open ? '#13705c' : '#b8434a';
        return (
          '<g stroke="' +
          c +
          '" fill="' +
          (outline ? 'none' : c) +
          '"><path d="M' +
          x +
          ' ' +
          y(b.high) +
          ' V' +
          y(b.low) +
          '"/><rect x="' +
          (x - dx * 0.28) +
          '" y="' +
          Math.min(y(b.open), y(b.close)) +
          '" width="' +
          dx * 0.56 +
          '" height="' +
          Math.max(0.5, Math.abs(y(b.open) - y(b.close))) +
          '"/></g>'
        );
      })
      .join('');
  }
  return (
    '<svg viewBox="0 0 ' + w + ' ' + h + '">' + candles(bars, false) + candles(reference, true) + '</svg>'
  );
}
async function main() {
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({
        viewport: { width, height: width === 390 ? 844 : 900 },
        deviceScaleFactor: 1,
      });
      for (const r of catalog.records) {
        const data = JSON.parse(fs.readFileSync(path.join(run, r.id + '.json')));
        const rows = data
          .map(
            (d, i) =>
              '<section><h3>' +
              names[i] +
              ' · ' +
              new Date(d.source[0].time * 1000).toISOString().slice(0, 16) +
              ' UTC</h3><div><figure><figcaption>Попередній генератор · CALM_TREND</figcaption>' +
              svg(d.before) +
              '</figure><figure><figcaption>History20 v2 · контур OHLC джерела</figcaption>' +
              svg(d.right, d.source) +
              '</figure></div></section>',
          )
          .join('');
        await page.setContent(
          '<meta charset="utf-8"><style>*{box-sizing:border-box}body{font:15px system-ui;color:#1d2837;margin:20px}h1{font-size:24px}h3{font-size:14px}section{border-top:1px solid #ddd}section div{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0}figcaption,small{color:#506273}svg{width:100%}@media(max-width:600px){section div{grid-template-columns:1fr;gap:8px}body{margin:12px}}</style><h1>' +
            r.id +
            ' · ' +
            r.title +
            '</h1><p>' +
            r.pair +
            ' · ' +
            r.sourceFrame +
            ' · ' +
            r.start +
            ' — ' +
            r.endExclusive +
            ' UTC (кінець виключно)</p>' +
            rows +
            '<small>Приватне дослідження · Binance Vision · CC BY-NC-SA 4.0. Шкали цін підібрані окремо для кожної панелі.</small>',
        );
        await page.screenshot({ path: path.join(run, r.id + '-compare-' + width + '.png'), fullPage: true });
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
