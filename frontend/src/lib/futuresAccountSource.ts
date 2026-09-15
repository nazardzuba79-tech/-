import { createContext } from 'react';
import type { FuturesAccountState } from './futuresAccountStore';

/**
 * A replacement source for the four authenticated futures account
 * resources.
 *
 * Deliberately its own tiny module rather than a member of
 * `futuresExecution`: `useFuturesAccount` has to read it, and
 * `futuresExecution` reads `useFuturesAccount` for the real refresh path,
 * so putting the context in either of those two makes them import each
 * other. Nothing else belongs here.
 *
 * `null` (the default, and what every ordinary account sees) means "use
 * the shared store", which polls the real endpoints.
 */
export const FuturesAccountSourceContext = createContext<FuturesAccountState | null>(null);
