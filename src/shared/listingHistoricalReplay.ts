/**
 * Historical MOVEMENT replay for managed non-executable demo listings.
 * Historical provider prices and volumes are NEVER copied into the market:
 * the imported 1h candles become signed, per-hour PPM OHLC moves.
 *
 * No network, no provider keys, no clock, no Math.random. Source attribution
 * is USER-SUPPLIED / UNVERIFIED; publication is blocked separately until
 * a rights review. Ten-second intrabar paths and volumes are MODELED, not
 * historical trades. A supplied hour always consumes one real clock hour.
 */
export const HISTORICAL_MOVE_SCALE = 1_000_000;
export const HISTORICAL_MAX_CLIP_HOURS = 2_400; // up to 100 elapsed days
export const HISTORICAL_MAX_TOTAL_HOURS = 4_800;
export const HISTORICAL_SOURCES = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'] as const;
export type HistoricalMoveSource = typeof HISTORICAL_SOURCES[number];
export type HistoricalMoveBar = [highPpm: number, lowPpm: number, closePpm: number];

export interface HistoricalMoveClip {
  source: HistoricalMoveSource;
  sourceStart: string; // exact UTC hour, from the imported file
  resolution: '1h';
  provenance: 'USER_SUPPLIED_UNVERIFIED';
  bars: HistoricalMoveBar[];
}
export interface HistoricalMoveProgram {
  version: 1;
  clips: HistoricalMoveClip[];
}

const HOUR_MS = 3_600_000;
function utcHour(text: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/.test(text)) throw new Error('Ожидается точное время UTC с началом часа');
  const time = Date.parse(text);
  if (!Number.isSafeInteger(time) || new Date(time).toISOString() !== text) throw new Error('Некорректная дата UTC');
  return time;
}

/** Validates stored immutable movement data; rejects zero/negative multipliers and malformed bars. */
export function validateHistoricalMoveProgram(program: HistoricalMoveProgram): void {
  if (!program || program.version !== 1 || !Array.isArray(program.clips) || program.clips.length < 1 || program.clips.length > 3)
    throw new Error('Добавьте от одного до трёх исторических отрезков');
  let total = 0;
  for (const clip of program.clips) {
    if (!HISTORICAL_SOURCES.includes(clip.source) || clip.resolution !== '1h'
      || clip.provenance !== 'USER_SUPPLIED_UNVERIFIED') throw new Error('Неизвестное историческое движение или источник');
    utcHour(clip.sourceStart);
    if (!Array.isArray(clip.bars) || clip.bars.length < 24 || clip.bars.length > HISTORICAL_MAX_CLIP_HOURS)
      throw new Error('Отрезок должен содержать от 24 до 2400 последовательных часов');
    total += clip.bars.length;
    for (const bar of clip.bars) {
      if (!Array.isArray(bar) || bar.length !== 3 || bar.some(n => !Number.isSafeInteger(n)))
        throw new Error('Неправильные исторические коэффициенты OHLC');
      const [hi, lo, close] = bar;
      if (hi < Math.max(0, close) || lo > Math.min(0, close) || lo <= -HISTORICAL_MOVE_SCALE
        || hi > 4 * HISTORICAL_MOVE_SCALE || close <= -HISTORICAL_MOVE_SCALE || close > 4 * HISTORICAL_MOVE_SCALE)
        throw new Error('Неверные границы исторической свечи');
    }
  }
  if (total > HISTORICAL_MAX_TOTAL_HOURS) throw new Error('Не более 4800 часов в цепочке исторических отрезков');
}

/** Strict CSV importer for Kraken-style timestamp,open,high,low,close[,volume,trades].
 * Must be run on data the operator is authorized to use. Header optional.
 * No gap filling, no future-looking data, no price or source-volume persistence.
 */
export function importHistoricalHourlyCsv(csv: string, source: HistoricalMoveSource): HistoricalMoveClip {
  if (!HISTORICAL_SOURCES.includes(source)) throw new Error('Неизвестный инструмент для образца движения');
  if (new TextEncoder().encode(csv).byteLength > 512 * 1024) throw new Error('CSV больше 512 КБ: выберите меньший исторический период');
  const lines = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (/^timestamp\s*,\s*open\s*,\s*high\s*,\s*low\s*,\s*close/i.test(lines[0] || '')) lines.shift();
  if (lines.length < 24 || lines.length > HISTORICAL_MAX_CLIP_HOURS)
    throw new Error('Нужно 24–2400 почасовых свечей без пропусков');
  let previousTime = -1, previousClose = 0;
  const bars: HistoricalMoveBar[] = [];
  let sourceStart = '';
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].trim().split(',');
    if (parts.length < 5 || parts.length > 7) throw new Error('Неверная строка CSV ' + (i + 1));
    const stamp = parts[0].trim();
    let at: number;
    if (/^\d{10}$/.test(stamp)) at = Number(stamp) * 1000;
    else if (/^\d{13}$/.test(stamp)) at = Number(stamp);
    else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.000)?Z$/.test(stamp)) at = Date.parse(stamp);
    else throw new Error('Ожидается часовая метка времени UTC в строке ' + (i + 1));
    if (!Number.isSafeInteger(at) || at % HOUR_MS !== 0 || (i > 0 && at !== previousTime + HOUR_MS))
      throw new Error('Пропущенный, повторный или нечасовой интервал в строке ' + (i + 1));
    const [open, high, low, close] = parts.slice(1, 5).map(v => Number(v.trim()));
    if (![open,high,low,close].every(v => Number.isFinite(v) && v > 0)
      || high < Math.max(open,close) || low > Math.min(open,close))
      throw new Error('Некорректный OHLC в строке ' + (i + 1));
    if (i > 0 && Math.abs(open / previousClose - 1) > 0.005)
      throw new Error('Разрыв цены источника между часами: строка ' + (i + 1));
    const highPpm = Math.max(0, Math.ceil((high / open - 1) * HISTORICAL_MOVE_SCALE - 1e-8));
    const lowPpm = Math.min(0, Math.floor((low / open - 1) * HISTORICAL_MOVE_SCALE + 1e-8));
    const closePpm = Math.round((close / open - 1) * HISTORICAL_MOVE_SCALE);
    bars.push([Math.max(highPpm,closePpm), Math.min(lowPpm,closePpm), closePpm]);
    previousClose = close; previousTime = at;
    if (i === 0) sourceStart = new Date(at).toISOString();
  }
  const result: HistoricalMoveClip = { source, sourceStart, resolution: '1h', provenance: 'USER_SUPPLIED_UNVERIFIED', bars };
  validateHistoricalMoveProgram({version:1, clips:[result]});
  return result;
}

/** Safely budgets the amount of JSON sent to the existing 160-KiB Durable Object endpoint. */
export function historicalSerializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function lastFactor(clip: HistoricalMoveClip): number {
  return clip.bars.reduce((factor, bar) => factor * (1 + bar[2] / HISTORICAL_MOVE_SCALE), 1);
}

/** Numeric high/low of the complete replay, including its joining anchor. */
export function historicalReplayBounds(program: HistoricalMoveProgram, anchor: number) {
  validateHistoricalMoveProgram(program);
  if (!(anchor > 0) || !Number.isFinite(anchor)) throw new Error('Некорректная цена соединения');
  let price = anchor, min = anchor, max = anchor;
  for (const clip of program.clips) {
    for (const bar of clip.bars) {
      const [h,l,c] = bar, open = price;
      min = Math.min(min,open * (1 + l / HISTORICAL_MOVE_SCALE));
      max = Math.max(max,open * (1 + h / HISTORICAL_MOVE_SCALE));
      price = open * (1 + c / HISTORICAL_MOVE_SCALE);
      if (!Number.isFinite(price) || price < 1e-8 || price > 1e9)
        throw new Error('Исторический отрезок выходит за поддерживаемую точность цены');
    }
  }
  return {min,max,close:price};
}

export interface HistoricalTick { price: number; high: number; low: number; volume: number; quoteVolume: number; }
export interface HistoricalHour { open: number; ticks: HistoricalTick[]; regime: 'impulse'|'pullback'|'consolidation'; }

/**
 * Returns canonical 10-second modeled ticks for one HISTORICAL hour.
 * The source's hourly close, high and low PPM moves are respected; true
 * intrahour ordering was not in hourly OHLC, and is intentionally modeled.
 * No clock acceleration and no "future" data reads.
 */
export function historicalReplayHour(program: HistoricalMoveProgram, anchor: number, hour: number, seed: string): HistoricalHour {
  validateHistoricalMoveProgram(program);
  if (!Number.isSafeInteger(hour) || hour < 0) throw new Error('Час истории должен быть неотрицательным');
  let open = anchor, remaining = hour;
  let found: HistoricalMoveBar | null = null;
  for (const clip of program.clips) {
    if (remaining < clip.bars.length) {
      for (let i=0; i<remaining; i++) open *= 1 + clip.bars[i][2] / HISTORICAL_MOVE_SCALE;
      found = clip.bars[remaining];
      break;
    }
    open *= lastFactor(clip);
    remaining -= clip.bars.length;
  }
  if (!Number.isFinite(open) || open <= 0) throw new Error('Историческая цена не представима');
  const ticks: HistoricalTick[] = [];
  let last = open;
  const hash = Array.from(seed + ':' + hour).reduce((h,ch)=>((h * 33) ^ ch.charCodeAt(0)) >>> 0, 5381);
  const upFirst = (hash & 1) === 0;
  const [high,low,close] = found
    ? [open * (1 + found[0] / HISTORICAL_MOVE_SCALE), open * (1 + found[1] / HISTORICAL_MOVE_SCALE), open * (1 + found[2] / HISTORICAL_MOVE_SCALE)]
    : [open * 1.004, open * 0.996, open];
  const stops: [number,number][] = upFirst
    ? [[0,open],[120,high],[240,low],[360,close]]
    : [[0,open],[120,low],[240,high],[360,close]];
  for (let t=1;t<=360;t++) {
    const index = t <= 120 ? 0 : t <= 240 ? 1 : 2;
    const [t0,p0] = stops[index], [t1,p1] = stops[index+1];
    const fraction = (t - t0)/(t1 - t0);
    const price = t === 360 ? close : p0 * Math.exp(Math.log(p1/p0) * fraction);
    const move = Math.abs(Math.log(price/last));
    // Model-only activity; historical volume is neither imported nor claimed.
    const quoteVolume = 20 + Math.min(300,move*20000) + (hash%17);
    ticks.push({price,high:Math.max(last,price),low:Math.min(last,price),
      quoteVolume,volume:quoteVolume/((price+last)/2)});
    last = price;
  }
  const delta = Math.log(close/open);
  return {open,ticks,regime:delta > 0.001 ? 'impulse' : delta < -0.001 ? 'pullback' : 'consolidation'};
}
