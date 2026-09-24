import type { CfdOhlcInterval } from './BiquoteCfdOhlcSource';

type QuoteLike = { last: number | null };
type OhlcLike = { bars: unknown[] };

export interface CfdDisplaySelfTestDeps {
  getQuotes: () => Promise<QuoteLike[]>;
  getOhlc: (symbol: string, interval: CfdOhlcInterval, limit: number) => Promise<OhlcLike>;
  /** Initial warm-up followed by retry backoff. Kept tiny in tests through injection. */
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  log?: (result: CfdDisplaySelfTestResult) => void;
}

export interface CfdDisplaySelfTestResult {
  attempt: number;
  final: boolean;
  passed: boolean;
  quoteRows: number;
  pricedRows: number;
  xauOhlcBars: number;
  wtiOhlcBars: number;
  quotesOk: boolean;
  xauOhlcOk: boolean;
  wtiOhlcOk: boolean;
  errors: {
    quotes: string | null;
    xauOhlc: string | null;
    wtiOhlc: string | null;
  };
}

const DEFAULT_DELAYS_MS = [2_500, 5_000, 10_000] as const;
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const errorClass = (error: unknown) => error instanceof Error ? error.name || 'Error' : 'unknown';

/**
 * Startup smoke test for public CFD display feeds.
 *
 * The collector used to probe BiQuote and the just-opened Deriv stream
 * immediately after listen(). A normal cold-start handshake or one transient
 * upstream timeout therefore produced a scary one-off "0 bars / 0 priced"
 * log even though the API was healthy seconds later.
 *
 * This probe is deliberately outside request handling. It waits for a short
 * warm-up, retries only the parts that have not succeeded, and never blocks
 * startup. A successful leg is never queried again, so the retry path adds
 * no steady-state polling and no Neon/Prisma work.
 */
export async function runCfdDisplaySelfTest(deps: CfdDisplaySelfTestDeps): Promise<CfdDisplaySelfTestResult> {
  const delays = deps.retryDelaysMs?.length ? [...deps.retryDelaysMs] : [...DEFAULT_DELAYS_MS];
  const sleep = deps.sleep ?? wait;

  let quoteRows = 0;
  let pricedRows = 0;
  let xauOhlcBars = 0;
  let wtiOhlcBars = 0;
  let quotesOk = false;
  let xauOhlcOk = false;
  let wtiOhlcOk = false;
  let quotesError: string | null = null;
  let xauError: string | null = null;
  let wtiError: string | null = null;

  let last!: CfdDisplaySelfTestResult;
  for (let index = 0; index < delays.length; index += 1) {
    await sleep(Math.max(0, delays[index] ?? 0));

    const probes: Promise<void>[] = [];
    if (!quotesOk) probes.push((async () => {
      try {
        const quotes = await deps.getQuotes();
        quoteRows = quotes.length;
        pricedRows = quotes.filter(q => q.last !== null && Number.isFinite(q.last) && q.last > 0).length;
        quotesOk = pricedRows > 0;
        quotesError = quotesOk ? null : 'unpriced';
      } catch (error) {
        quotesError = errorClass(error);
      }
    })());
    if (!xauOhlcOk) probes.push((async () => {
      try {
        const result = await deps.getOhlc('XAUUSD', '15m', 20);
        xauOhlcBars = Array.isArray(result.bars) ? result.bars.length : 0;
        xauOhlcOk = xauOhlcBars >= 2;
        xauError = xauOhlcOk ? null : 'insufficient';
      } catch (error) {
        xauError = errorClass(error);
      }
    })());
    if (!wtiOhlcOk) probes.push((async () => {
      try {
        const result = await deps.getOhlc('WTIUSD', '15m', 20);
        wtiOhlcBars = Array.isArray(result.bars) ? result.bars.length : 0;
        wtiOhlcOk = wtiOhlcBars >= 2;
        wtiError = wtiOhlcOk ? null : 'insufficient';
      } catch (error) {
        wtiError = errorClass(error);
      }
    })());

    await Promise.all(probes);
    const passed = quotesOk && xauOhlcOk && wtiOhlcOk;
    const final = passed || index === delays.length - 1;
    last = {
      attempt: index + 1,
      final,
      passed,
      quoteRows,
      pricedRows,
      xauOhlcBars,
      wtiOhlcBars,
      quotesOk,
      xauOhlcOk,
      wtiOhlcOk,
      errors: { quotes: quotesError, xauOhlc: xauError, wtiOhlc: wtiError },
    };
    deps.log?.(last);
    if (passed) return last;
  }
  return last;
}
