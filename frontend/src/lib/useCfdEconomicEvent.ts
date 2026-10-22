import { useEffect, useMemo, useState } from 'react';
import { ECONOMIC_EVENT_SOURCE, pickNearestEconomicEvent, type EconomicEvent, type EconomicEventSource } from './cfdInfoStrip';

/** Nearest relevant official release for an instrument. Null while no permitted source is attached. */
export function useCfdEconomicEvent(symbol:string, source:EconomicEventSource|null = ECONOMIC_EVENT_SOURCE):EconomicEvent|null {
  const [events, setEvents] = useState<EconomicEvent[]|null>(null);
  useEffect(() => {
    if (!source) { setEvents(null); return; }
    let cancelled = false;
    source.list(Date.now()).then(list => { if (!cancelled) setEvents(Array.isArray(list) ? list : null); }, () => { if (!cancelled) setEvents(null); });
    return () => { cancelled = true; };
  }, [source]);
  return useMemo(() => events ? pickNearestEconomicEvent(events, symbol, Date.now()) : null, [events, symbol]);
}
