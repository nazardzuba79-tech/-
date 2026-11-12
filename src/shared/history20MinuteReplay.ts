/** History20 v2. A private pack contains five LE doubles per observed minute:
 * O/H/L/C relative to the first open, and volume relative to the window mean.
 * No source prices, timestamps or arrays travel in a listing configuration. */
import { HISTORICAL_GROWTH_MAX_PEAK_PERCENT } from './listingHistoricalGrowth';

export const REGIME_MINUTES = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1440 } as const;
export type RegimeInterval = keyof typeof REGIME_MINUTES;
export interface ReplayBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
type Bar = Omit<ReplayBar, 'time'>;
const MINUTE = 60_000;

function append(result: Bar | undefined, next: Bar): Bar {
  if (!result) return { ...next };
  result.high = Math.max(result.high, next.high);
  result.low = Math.min(result.low, next.low);
  result.close = next.close;
  result.volume += next.volume;
  return result;
}

export class History20MinuteReplay {
  private readonly data: Float64Array;
  private readonly rollups: Array<{ size: number; values: Float64Array }>;
  readonly minutes: number;

  constructor(source: Float64Array) {
    this.minutes = source.length / 5;
    if (
      !Number.isSafeInteger(this.minutes) ||
      !this.minutes ||
      this.minutes > 60 * 24 * 60 ||
      source[0] !== 1
    )
      throw Error('Invalid History20 minute pack');
    this.data = source.slice();
    const cap = 1 + HISTORICAL_GROWTH_MAX_PEAK_PERCENT / 100;
    for (let j = 0; j < this.data.length; j += 5) {
      const open = this.data[j],
        high = this.data[j + 1],
        low = this.data[j + 2],
        close = this.data[j + 3],
        volume = this.data[j + 4];
      if (
        !Number.isFinite(open) ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close) ||
        !Number.isFinite(volume) ||
        low <= 0 ||
        low > Math.min(open, close) ||
        high < Math.max(open, close) ||
        high > cap ||
        volume < 0
      )
        throw Error('Invalid normalized OHLCV at minute ' + j / 5);
    }
    // Open and close always come from the minute array. Keep only high, low
    // and volume for complete aligned groups; never consult an unfinished group.
    this.rollups = [];
    let childSize = 1;
    let childValues: Float64Array | undefined;
    for (const size of [5, 15, 60, 240, 1440]) {
      const groups = Math.floor(this.minutes / size);
      const values = new Float64Array(groups * 3);
      for (let group = 0; group < groups; group++) {
        let high = -Infinity,
          low = Infinity,
          volume = 0;
        const left = (group * size) / childSize,
          right = ((group + 1) * size) / childSize;
        for (let i = left; i < right; i++) {
          if (childValues) {
            high = Math.max(high, childValues[3 * i]);
            low = Math.min(low, childValues[3 * i + 1]);
            volume += childValues[3 * i + 2];
          } else {
            high = Math.max(high, this.data[5 * i + 1]);
            low = Math.min(low, this.data[5 * i + 2]);
            volume += this.data[5 * i + 4];
          }
        }
        values[3 * group] = high;
        values[3 * group + 1] = low;
        values[3 * group + 2] = volume;
      }
      this.rollups.unshift({ size, values });
      childSize = size;
      childValues = values;
    }
  }

  private minute(i: number): Bar {
    const j = 5 * i,
      d = this.data;
    return { open: d[j], high: d[j + 1], low: d[j + 2], close: d[j + 3], volume: d[j + 4] };
  }

  /** Only the current minute is modeled. Its visited path cannot include an
   * extremum before the corresponding leg, or any observation from minute i+1. */
  private forming(i: number, fraction: number, seed: number): Bar {
    const bar = this.minute(i);
    const highFirst = ((Math.imul(i + seed, 2654435761) >>> 16) & 1) === 0;
    const path = [bar.open, highFirst ? bar.high : bar.low, highFirst ? bar.low : bar.high, bar.close];
    const leg = Math.min(2, Math.floor(3 * fraction));
    const close = path[leg] + (path[leg + 1] - path[leg]) * (3 * fraction - leg);
    const visited = [...path.slice(0, leg + 1), close];
    return {
      open: bar.open,
      high: Math.max(...visited),
      low: Math.min(...visited),
      close,
      volume: bar.volume * fraction,
    };
  }

  candles(
    start: number,
    initial: number,
    seed: string,
    interval: RegimeInterval,
    now: number,
    limit = 200,
  ): ReplayBar[] {
    if (
      !Number.isSafeInteger(start) ||
      start % MINUTE ||
      !Number.isFinite(now) ||
      !Number.isFinite(initial) ||
      initial <= 0 ||
      !Object.prototype.hasOwnProperty.call(REGIME_MINUTES, interval) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 1000
    )
      throw Error('Invalid History20 replay coordinates');
    if (now < start) return [];
    const step = REGIME_MINUTES[interval] * MINUTE;
    const end = start + this.minutes * MINUTE;
    const lastBucket = Math.floor(Math.min(now, end - 1) / step) * step;
    const complete = Math.min(this.minutes, Math.floor((now - start) / MINUTE));
    const fraction = ((now - start) % MINUTE) / MINUTE;
    let key = 0;
    for (const c of seed) key = (Math.imul(key, 31) + c.charCodeAt(0)) | 0;
    const result: ReplayBar[] = [];
    for (
      let bucket = Math.max(Math.floor(start / step) * step, lastBucket - (limit - 1) * step);
      bucket <= lastBucket;
      bucket += step
    ) {
      const stop = Math.min(complete, (bucket + step - start) / MINUTE);
      let row: Bar | undefined;
      const first = Math.max(0, (bucket - start) / MINUTE);
      if (first < stop) {
        let high = -Infinity,
          low = Infinity,
          volume = 0;
        for (let i = first; i < stop; ) {
          let advance = 1;
          for (const { size, values } of this.rollups) {
            if (size > stop - i || i % size !== 0) continue;
            const j = (3 * i) / size;
            high = Math.max(high, values[j]);
            low = Math.min(low, values[j + 1]);
            volume += values[j + 2];
            advance = size;
            break;
          }
          if (advance === 1) {
            high = Math.max(high, this.data[5 * i + 1]);
            low = Math.min(low, this.data[5 * i + 2]);
            volume += this.data[5 * i + 4];
          }
          i += advance;
        }
        row = { open: this.data[5 * first], high, low, close: this.data[5 * (stop - 1) + 3], volume };
      }
      if (complete < this.minutes && now >= bucket && now < bucket + step)
        row = append(row, this.forming(complete, fraction, key));
      if (row)
        result.push({
          time: bucket / 1000,
          open: initial * row.open,
          high: initial * row.high,
          low: initial * row.low,
          close: initial * row.close,
          volume: row.volume,
        });
    }
    return result;
  }
}
