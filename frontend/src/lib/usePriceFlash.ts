import { useEffect, useRef, useState } from 'react';

export type FlashDirection = 'up' | 'down' | null;

const FLASH_DURATION_MS = 600;

/** Briefly flags that a live-polled value just increased/decreased —
 * drives the Binance-style flash-on-change effect on price cells, giving
 * a "live" feel without an actual WebSocket push (Kraken's WS endpoint
 * isn't reachable from this environment, see KrakenMarketDataService —
 * this is real REST polling with a short visual pulse on top, not a fake
 * live-ness indicator). */
export function usePriceFlash(value: number): FlashDirection {
  const prevRef = useRef<number | null>(null);
  const [flash, setFlash] = useState<FlashDirection>(null);
  const timerRef = useRef<number>();

  useEffect(() => {
    const prev = prevRef.current;
    if (prev !== null && value !== prev && !Number.isNaN(value)) {
      setFlash(value > prev ? 'up' : 'down');
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setFlash(null), FLASH_DURATION_MS);
    }
    prevRef.current = value;
  }, [value]);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  return flash;
}
