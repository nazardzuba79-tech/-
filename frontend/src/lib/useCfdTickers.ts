import { useEffect, useState } from 'react';
import { api } from './api';
import type { CfdTickerRow } from '../components/CfdInstrumentList';

// Matches CfdMarketDataService's server-side cache TTL — polling faster
// than that just wastes requests without ever seeing fresher data (see
// CFD_INSTRUMENTS' doc comment there for the Twelve Data credit budget
// this is paced against).
const POLL_MS = 60_000;

/** Shared poll so the instrument list and the price panel don't each open
 * their own interval against the same endpoint. */
export function useCfdTickers() {
  const [tickers, setTickers] = useState<CfdTickerRow[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loadError, setLoadError] = useState(false);

  function load() {
    setLoadError(false);
    api
      .getCfdTickers()
      .then((res) => {
        setConfigured(res.configured);
        setTickers(res.tickers);
      })
      .catch(() => setLoadError(true));
  }

  useEffect(() => {
    load();
    const interval = window.setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, []);

  return { tickers, configured, loadError, reload: load };
}
