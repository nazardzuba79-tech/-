import { PrivateTradingError } from './privateTradingError';

/**
 * THE SERVER WAS NOT THERE, SO IT NEVER ANSWERED.
 *
 * A 502/503/504 that carries no `code` is not the engine speaking: it is the
 * host's own page while the API restarts or is cold-starting (the engine's
 * refusals always carry a code). A fetch that fails before any response is
 * the same. Neither is a refusal of the order.
 *
 * A command is re-sent ONLY for these, and always under the SAME idempotency
 * key: the server answers a key it already committed with that commit's
 * receipt, so a retry can never place the order twice. Anything else — a
 * refusal with a code, the 45s deadline's "confirmation unknown" — goes to
 * the trader unchanged.
 */
export const NATIVE_TRANSPORT_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 8000] as const;

export function nativeTransportFailure(error: unknown): boolean {
  if (error instanceof PrivateTradingError) return !error.code && [502, 503, 504].includes(error.status);
  return error instanceof TypeError;
}

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function withNativeTransportRetry<T>(send: () => Promise<T>, wait: (ms: number) => Promise<void> = pause,
  delays: readonly number[] = NATIVE_TRANSPORT_RETRY_DELAYS_MS): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await send(); }
    catch (error) {
      if (attempt >= delays.length || !nativeTransportFailure(error)) throw error;
      await wait(delays[attempt]);
    }
  }
}
