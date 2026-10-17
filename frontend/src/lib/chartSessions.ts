/**
 * Trading calendars for derived chart bars (2026-10-15).
 *
 * A derived bar (a week from days, 2h from hours) is complete when every
 * base bar of its bucket is present. A 24/7 venue (Spot, Futures, the test
 * markets) has a base bar in every slot, so "every slot" is the rule there.
 * A CFD market closes for the weekend and, for CME/ICE products, for a daily
 * break: no bar exists then, and none is missing. The weekly calendar in
 * lib/cfdInfoStrip (forex, CME, ICE windows in New York time) tells the two
 * apart, so a forex week built from its Sunday–Friday daily bars is whole and
 * a week with a missing Wednesday is still dropped. Exchange holidays are not
 * in that calendar: such a week has a slot that is "expected" and absent, and
 * is dropped rather than padded.
 */
import type { ChartMarket } from './chartCapabilities';
import { cfdSessionOpenAt, newYorkClock } from './cfdInfoStrip';

/**
 * Daily pauses of the display provider inside the exchange's own session,
 * as [from, to) minutes of the New York day. Measured on 2026-10-15 over a
 * week of the provider's hourly bars: Brent (UKOIL) has no bar from 17:00 New
 * York, an hour before ICE's 18:00 close, every weekday (Friday included).
 * Every other instrument's gaps were exactly its calendar's closures.
 */
const PROVIDER_PAUSE: Readonly<Record<string, readonly [number, number]>> = Object.freeze({ XBRUSD: [17 * 60, 18 * 60] as const });

function openAt(symbol: string, at: number): boolean {
  if (cfdSessionOpenAt(symbol, at) !== true) return false;
  const pause = PROVIDER_PAUSE[symbol];
  if (!pause) return true;
  const { minute } = newYorkClock(at);
  return minute < pause[0] || minute >= pause[1];
}

/** Is the market open at any of a few instants spread over the bar? */
function openDuring(symbol: string, time: number, step: number): boolean {
  const samples = step <= 60 ? [time] : [time, time + step * 0.25, time + step * 0.5, time + step * 0.75, time + step - 60];
  return samples.some(at => openAt(symbol, at * 1000));
}

/** Answers per instrument and bar, bounded: a 5-second chart poll re-aggregates the same bars. */
const MEMO_MAX = 4096;
const memo = new Map<string, boolean>();

/** The `expectedBar` rule for an instrument's derived bars, or undefined for a market without closures (every slot expected). */
export function expectedBarFor(market: ChartMarket, pair: string): ((time: number, step: number) => boolean) | undefined {
  if (market !== 'cfd') return undefined;
  const symbol = pair.toUpperCase().replace('/', '');
  if (cfdSessionOpenAt(symbol, Date.now()) === null) return undefined; // no calendar for it: the strict rule
  return (time, step) => {
    const key = `${symbol}:${step}:${time}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    const open = openDuring(symbol, time, step);
    if (memo.size >= MEMO_MAX) memo.clear();
    memo.set(key, open);
    return open;
  };
}
