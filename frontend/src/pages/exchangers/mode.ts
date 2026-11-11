import { createContext, useContext } from 'react';

/**
 * What the page can honestly claim right now (Issue #694):
 *   live    — the server returned BestChange data: real exchangers, rates, reserves;
 *   links   — no rate source (no API key, or the API release without this
 *             feature): the page shows NO exchangers and NO numbers and only
 *             opens a verified BestChange direction page. It must not call
 *             itself a comparison or a catalogue of exchangers;
 *   pending — not known yet (first read in flight): worded like `links`, so
 *             nothing is promised before the answer arrives.
 */
export type ExchangersMode = 'pending' | 'live' | 'links';

export const ExchangersModeContext = createContext<ExchangersMode>('pending');
export const useExchangersMode = (): ExchangersMode => useContext(ExchangersModeContext);
