// Private, offline History20 pack builder. Only hashes, source coordinates and
// aggregate measurements belong in Git. Runtime never downloads market data.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const windows = require('./windows.json');
const root = path.resolve(__dirname, '../..');
const dir = path.join(root, 'output/history20-v2');
const indexPath = path.join(root, 'src/shared/history20Regimes.json');
const day = 86400000;
const frames = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1440 };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
fs.mkdirSync(dir, { recursive: true });

function archive(pair, frame, month) {
  const stem = pair + '-' + frame + '-' + month;
  const url =
    'https://data.binance.vision/data/spot/monthly/klines/' + pair + '/' + frame + '/' + stem + '.zip';
  const file = path.join(dir, stem + '.zip');
  for (const suffix of ['.CHECKSUM', '']) {
    if (!fs.existsSync(file + suffix)) {
      execFileSync('curl', [
        '-fsSL',
        '--retry',
        '3',
        '--max-time',
        '120',
        '-o',
        file + suffix + '.part',
        url + suffix,
      ]);
      fs.renameSync(file + suffix + '.part', file + suffix);
    }
  }
  const digest = sha(fs.readFileSync(file));
  const [expected, name] = fs
    .readFileSync(file + '.CHECKSUM', 'utf8')
    .trim()
    .split(/\s+/);
  assert.equal(expected, digest);
  assert.equal(name, stem + '.zip');
  const csv = execFileSync('tar', ['-xOf', file, stem + '.csv'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 ** 2,
  });
  return { csv, source: { url, sha256: digest } };
}

function series(pair, frame, start, end, sources) {
  const rows = [];
  const months = new Set();
  for (let t = start; t < end; t += day) months.add(new Date(t).toISOString().slice(0, 7));
  for (const month of months) {
    const { csv, source } = archive(pair, frame, month);
    sources.push(source);
    for (const line of csv.trim().split(/\r?\n/)) {
      const [t, o, h, l, c, v, closeTime, quote] = line.split(',').map(Number);
      if (t < start || t >= end) continue;
      assert([t, o, h, l, c, v, quote].every(Number.isFinite) && t % (frames[frame] * 60000) === 0);
      assert(l > 0 && l <= Math.min(o, c) && h >= Math.max(o, c) && v >= 0 && quote >= 0);
      assert(closeTime === t + frames[frame] * 60000 - 1);
      rows.push([t, o, h, l, c, v, quote]);
    }
  }
  return rows;
}

const q = (xs) => {
  xs.sort((a, b) => a - b);
  return [0.1, 0.5, 0.9].map((p) => Number(xs[Math.floor((xs.length - 1) * p)].toPrecision(8)));
};
function characteristics(rows) {
  const shapes = rows.map(([, o, h, l, c]) => {
    const span = h - l || 1;
    return [Math.abs(c - o) / span, (h - Math.max(o, c)) / span, (Math.min(o, c) - l) / span];
  });
  const volumes = rows.map((r) => r[5]);
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const mean = sum(volumes) / rows.length;
  const posHigh = rows.reduce((a, r, i) => (r[2] > rows[a][2] ? i : a), 0);
  const posLow = rows.reduce((a, r, i) => (r[3] < rows[a][3] ? i : a), 0);
  let inside = 0,
    engulfing = 0,
    failedBreakHigh = 0,
    failedBreakLow = 0,
    upRun = 0,
    downRun = 0,
    longestUp = 0,
    longestDown = 0;
  const moves = [];
  for (let i = 1; i < rows.length; i++) {
    const [, o, h, l, c] = rows[i],
      prev = rows[i - 1];
    if (h <= prev[2] && l >= prev[3]) inside++;
    if (
      (c - o) * (prev[4] - prev[1]) < 0 &&
      Math.min(o, c) <= Math.min(prev[1], prev[4]) &&
      Math.max(o, c) >= Math.max(prev[1], prev[4])
    )
      engulfing++;
    const ret = Math.log(c / prev[4]);
    moves.push(Math.abs(ret));
    upRun = ret > 0 ? upRun + 1 : 0;
    downRun = ret < 0 ? downRun + 1 : 0;
    longestUp = Math.max(longestUp, upRun);
    longestDown = Math.max(longestDown, downRun);
    if (i >= 12) {
      const prior = rows.slice(i - 12, i),
        ceiling = Math.max(...prior.map((r) => r[2])),
        floor = Math.min(...prior.map((r) => r[3]));
      if (h > ceiling && c <= ceiling) failedBreakHigh++;
      if (l < floor && c >= floor) failedBreakLow++;
    }
  }
  return {
    inside,
    engulfing,
    failedBreakHigh,
    failedBreakLow,
    longestUp,
    longestDown,
    absoluteLogReturn: q(moves),
    bars: rows.length,
    body: q(shapes.map((s) => s[0])),
    upper: q(shapes.map((s) => s[1])),
    lower: q(shapes.map((s) => s[2])),
    relativeVolume: q(volumes.map((v) => v / mean)),
    maxRelativeVolume: +(Math.max(...volumes) / mean).toFixed(2),
    flat: rows.filter((r) => r[2] === r[3]).length,
    doji: shapes.filter((s) => s[0] <= 0.05).length,
    singleWick: shapes.filter((s) => (s[1] === 0) !== (s[2] === 0)).length,
    noWicks: shapes.filter((s) => s[1] === 0 && s[2] === 0).length,
    unequalTwoWicks: shapes.filter((s) => s[1] > 0 && s[2] > 0 && Math.abs(s[1] - s[2]) > 0.01).length,
    quoteTurnoverUSDT: Math.round(sum(rows.map((r) => r[6]))),
    returnPct: +((rows.at(-1)[4] / rows[0][1] - 1) * 100).toFixed(3),
    highAt: new Date(rows[posHigh][0]).toISOString(),
    lowAt: new Date(rows[posLow][0]).toISOString(),
  };
}

function prepare([asset, first, last, frame, title], n) {
  const id = 'R' + String(n + 1).padStart(2, '0'),
    pair = asset + 'USDT',
    sources = [];
  const start = Date.parse(first),
    end = Date.parse(last) + day;
  const rows = series(pair, '1m', start, end, sources),
    observed = series(pair, frame, start, end, sources);
  // Never fill exchange downtime with interpolated ticks. Select an explicitly
  // documented contiguous source window in windows.json if an archive has gaps.
  assert.equal(
    rows.length,
    (end - start) / 60000,
    id + ' missing minutes ' + rows.length + '/' + (end - start) / 60000,
  );
  rows.forEach((r, i) => assert.equal(r[0], start + i * 60000));
  const stride = frames[frame];
  assert.equal(observed.length, rows.length / stride);
  for (let i = 0; i < observed.length; i++) {
    const block = rows.slice(i * stride, (i + 1) * stride),
      native = observed[i];
    assert.deepEqual(
      [
        block[0][0],
        block[0][1],
        Math.max(...block.map((r) => r[2])),
        Math.min(...block.map((r) => r[3])),
        block.at(-1)[4],
      ],
      native.slice(0, 5),
      id + ' native OHLC ' + native[0],
    );
    const v = block.reduce((a, r) => a + r[5], 0);
    assert(Math.abs(v - native[5]) <= Math.max(1e-7, native[5] * 1e-9), id + ' native volume');
  }
  const mean = rows.reduce((a, r) => a + r[5], 0) / rows.length,
    opening = rows[0][1];
  const pack = Buffer.alloc(rows.length * 40);
  rows.forEach((row, i) => {
    for (let col = 1; col <= 5; col++)
      pack.writeDoubleLE(row[col] / (col === 5 ? mean : opening), i * 40 + (col - 1) * 8);
  });
  const hash = sha(pack);
  fs.writeFileSync(path.join(dir, hash + '.bin'), pack);
  return {
    id,
    title,
    pair,
    start: first,
    endExclusive: new Date(end).toISOString().slice(0, 10),
    sourceFrame: frame,
    baseFrame: '1m',
    rows: rows.length,
    sha256: hash,
    sources,
    minute: characteristics(rows),
    episode: characteristics(observed),
  };
}

let failed = false;
const records = [];
for (const [i, spec] of windows.entries()) {
  try {
    const r = prepare(spec, i);
    records.push(r);
    console.log(r.id, r.pair, r.rows, r.sha256);
  } catch (e) {
    failed = true;
    console.error(spec[0], spec[1], e.message);
  }
}
if (failed) process.exitCode = 1;
else {
  const catalog = {
    version: 2,
    provider: 'Binance Vision Spot',
    rights: 'HISTORICAL_RIGHTS_UNVERIFIED',
    terms: 'https://github.com/binance/binance-public-data/blob/master/TERMS_AND_CONDITIONS.md',
    records,
  };
  if (process.argv.includes('--write-index'))
    fs.writeFileSync(indexPath, JSON.stringify(catalog, null, 2) + '\n');
  else assert.deepEqual(catalog, JSON.parse(fs.readFileSync(indexPath, 'utf8')));
}
