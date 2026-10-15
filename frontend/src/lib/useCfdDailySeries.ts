import { useEffect, useState } from 'react';
import { addBrowserActivityListener, isBrowserInactive, removeBrowserActivityListener } from './browserActivity';
import { displayRefreshDelay, readDisplayJson, SLOW_DISPLAY_REFRESH_MS } from './displaySnapshotCache';
import { parseCfdDailyBars, type CfdDailyBar } from './cfdInfoStrip';
import { cfdDailySessionUrl } from './useCfdDailySession';

/** At most this many daily-series requests at once: the display cache admits 16 in flight for the whole page. */
const CONCURRENCY = 3;

/**
 * Daily bars for every instrument of the CFD market list (2026-10-15), so
 * each row's day change is the same figure the information strip shows for
 * that instrument — the price against the previous session's close
 * (lib/cfdInfoStrip). The provider's own `dayDiffPercent` is not used: on
 * 2026-10-15 it was measured against the close two sessions back for every
 * instrument checked (XAGUSD −5.12 % where the previous close gives +0.44 %).
 *
 * The URL is the strip's own (`cfdDailySessionUrl`, 20 daily bars), so the
 * selected instrument's series is one shared request, and all of them ride
 * the six-hour display snapshot cache: a reload within six hours costs none.
 */
export function useCfdDailySeries(symbols: readonly string[], enabled = true): ReadonlyMap<string, CfdDailyBar[]> {
  const [series, setSeries] = useState<ReadonlyMap<string, CfdDailyBar[]>>(() => new Map());
  const key = symbols.join(',');
  useEffect(() => {
    if (!enabled || !symbols.length) return;
    let cancelled = false, timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();
    const load = async () => {
      if (cancelled || isBrowserInactive()) return;
      const queue = [...symbols];
      let next = SLOW_DISPLAY_REFRESH_MS;
      const worker = async () => {
        for (let symbol = queue.shift(); symbol !== undefined && !cancelled; symbol = queue.shift()) {
          const url = cfdDailySessionUrl(symbol);
          try {
            const bars = parseCfdDailyBars(await readDisplayJson(url, SLOW_DISPLAY_REFRESH_MS, controller.signal), symbol);
            if (cancelled || !bars) continue;
            next = Math.min(next, displayRefreshDelay(url, SLOW_DISPLAY_REFRESH_MS));
            setSeries(previous => { const map = new Map(previous); map.set(symbol!, bars); return map; });
          } catch {
            // A row without its series shows no change ("—"); the next round tries again.
            next = Math.min(next, 60_000);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
      if (!cancelled && !isBrowserInactive()) timer = setTimeout(() => void load(), next);
    };
    const visible = () => { if (isBrowserInactive()) { if (timer) clearTimeout(timer); timer = null; } else if (!timer) void load(); };
    addBrowserActivityListener(visible);
    void load();
    return () => { cancelled = true; controller.abort(); if (timer) clearTimeout(timer); removeBrowserActivityListener(visible); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return series;
}
