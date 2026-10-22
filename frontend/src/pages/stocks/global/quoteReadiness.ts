export type QuoteReadiness = {
  state: 'WAITING_FOR_QUOTE'; reason: 'BEFORE_DEMAND'; executable: false;
  quoteTimestamp: number; receivedAt: number; demandSince: number;
};

/** Informational presentation only; this cannot enable an order or replace its error. */
export function isWaitingForCurrentQuote(hint: QuoteReadiness | undefined, error: string, now: number, delaySeconds = 0) {
  return error === 'QUOTE_STALE' && !!hint && hint.state === 'WAITING_FOR_QUOTE' && hint.reason === 'BEFORE_DEMAND' &&
    hint.executable === false && [hint.quoteTimestamp, hint.receivedAt, hint.demandSince, now].every(Number.isSafeInteger) &&
    hint.quoteTimestamp > 0 && hint.quoteTimestamp < hint.demandSince && hint.demandSince <= now &&
    hint.receivedAt > 0 && hint.receivedAt <= now && Number.isSafeInteger(delaySeconds) && delaySeconds >= 0 &&
    Number.isSafeInteger(delaySeconds * 1000 + 60000) && now - hint.receivedAt <= 30000 &&
    now - hint.quoteTimestamp <= delaySeconds * 1000 + 60000;
}
