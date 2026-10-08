// Isolated QA fixture for the Stocks UI. Runs the real read-only stock server
// (services/stocks/server.mjs) over a disposable SQLite file filled with
// generated 15-minute candles. Never contacts a provider or production, never
// imported by the frontend or the stock runtime. Quotes are demonstration data.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../services/stocks/core.mjs';
import { createStockServer } from '../services/stocks/server.mjs';

const manifest = JSON.parse(readFileSync(new URL('../services/stocks/manifest.json', import.meta.url)));
const SLOT = 900000;
// Regular sessions in exchange-local minutes; breaks split them.
const SESSIONS = {
  'America/New_York': [[570, 960]], 'Europe/Moscow': [[600, 1125]], 'Asia/Tokyo': [[540, 690], [750, 930]],
  'Asia/Hong_Kong': [[570, 720], [780, 960]], 'Asia/Shanghai': [[570, 690], [780, 900]], 'Asia/Seoul': [[540, 930]], 'Asia/Kolkata': [[555, 930]],
};
const BASE = { USD: 180, RUB: 240, JPY: 2600, HKD: 64, CNY: 18, KRW: 68000, INR: 1450 };
const INDEX_BASE = { 'XJPX:N225': 38512, 'XHKG:HSI': 22840, 'XSHG:000001': 3290, 'XKRX:KOSPI': 2595, 'XNSE:NSEI': 24980 };

function seeded(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h += 0x6d2b79f5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const zoneParts = new Map();
function localSlot(ms, timeZone) {
  let f = zoneParts.get(timeZone);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); zoneParts.set(timeZone, f); }
  const p = Object.fromEntries(f.formatToParts(ms).map(x => [x.type, x.value]));
  return { weekday: p.weekday, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
/** Closed session slots (open times), newest last, at most `count`. */
export function sessionSlots(timeZone, now, count) {
  const windows = SESSIONS[timeZone] ?? [[600, 960]];
  const slots = [];
  for (let open = Math.floor(now / SLOT) * SLOT - SLOT; slots.length < count && open > now - 60 * 86400000; open -= SLOT) {
    const { weekday, minutes } = localSlot(open, timeZone);
    if (weekday === 'Sat' || weekday === 'Sun') continue;
    if (windows.some(([a, b]) => minutes >= a && minutes + 15 <= b)) slots.push(open);
  }
  return slots.reverse();
}
const decimal = (value, places) => {
  const text = value.toFixed(places);
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
};

/** Instruments without data, one sub-cent quote, indices without volume. */
export function fixtureCatalogue() {
  return manifest.map((item, n) => {
    const empty = n % 11 === 5;
    return { ...item, enabled: !empty, dataRightsStatus: empty ? 'unconfirmed' : 'confirmed' };
  });
}

/** A sub-cent OTC quote, to prove small prices keep their digits. */
export const TINY_PRICE_ID = 'PINX:MGNT';

export function fixtureCandles(item, now, count = 360) {
  const random = seeded(item.instrumentId);
  const tiny = item.instrumentId === TINY_PRICE_ID;
  let price = INDEX_BASE[item.instrumentId] ?? (tiny ? 0.0012345 : BASE[item.currency] * (0.25 + random() * 3));
  const places = tiny ? 7 : item.currency === 'JPY' || item.currency === 'KRW' ? 0 : 2 + Math.floor(random() * 2);
  const step = price * 0.0018;
  // Rounding to a fixed number of places is monotonic, so h ≥ max(o,c) and
  // l ≤ min(o,c) survive it, as the store's validator requires.
  return sessionSlots(item.exchangeTimeZone, now, count).map((open, n, all) => {
    const drift = Math.sin(n / 23) * step * 0.6 + (random() - 0.48) * step * 2.2;
    const o = price, c = Math.max(price * 0.6, price + drift);
    const h = Math.max(o, c) + random() * step, l = Math.max(Math.min(o, c) - random() * step, Math.min(o, c) * 0.9);
    price = c;
    const close = open + SLOT;
    return {
      instrumentId: item.instrumentId, interval: '15m', openTimeUtc: open, closeTimeUtc: close,
      open: decimal(o, places), high: decimal(h, places), low: decimal(l, places), close: decimal(c, places),
      volume: item.type === 'index' ? null : String(Math.round(2000 + random() * 90000)),
      currency: item.currency, provider: item.provider, providerTimestamp: close,
      fetchedAt: Math.min(now, close + 60000 + (n === all.length - 1 ? 30000 : 0)), adjustmentMode: 'unadjusted',
    };
  });
}

/** Starts the real stock read API on 127.0.0.1:port over generated candles. */
export async function startStockFixture({ port = 4431, frontendOrigin = '', now = Date.now() } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'voltex-stock-ui-qa-'));
  const store = new Store(join(dir, 'stocks.sqlite'));
  const instruments = fixtureCatalogue();
  let candles = 0;
  for (const item of instruments) {
    if (!item.enabled) continue;
    const rows = fixtureCandles(item, now);
    for (let n = 0; n < rows.length; n += 250) candles += store.write(rows.slice(n, n + 250), item, now);
  }
  const server = createStockServer({ store, instruments, origin: frontendOrigin });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${port}`, instruments, candles,
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}
