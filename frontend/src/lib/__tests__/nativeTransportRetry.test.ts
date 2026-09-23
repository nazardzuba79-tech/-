import { readFileSync } from 'fs';
import { resolve } from 'path';
import { nativeTransportFailure, withNativeTransportRetry, NATIVE_TRANSPORT_RETRY_DELAYS_MS } from '../nativeTransportRetry';
import { futuresOrderErrorMessage } from '../futuresOrderErrors';
import { PrivateTradingError } from '../privateTradingError';
import { RU } from '../i18n/locales/ru';

/**
 * The owner's «Не удалось разместить ордер» on a limit close, 2026-09-23:
 * the API was restarting, the host answered 502 with an HTML page, and the
 * command — which carried no refusal at all — fell to the generic line.
 */
const t = (key: keyof typeof RU) => RU[key] ?? key;
const noWait = () => Promise.resolve();

describe('a command is re-sent only when the server never answered', () => {
  it('treats a code-less gateway status and a network failure as transport, a refusal never', () => {
    expect(nativeTransportFailure(new PrivateTradingError('Счёт временно недоступен', 502))).toBe(true);
    expect(nativeTransportFailure(new PrivateTradingError('Счёт временно недоступен', 503))).toBe(true);
    expect(nativeTransportFailure(new PrivateTradingError('Счёт временно недоступен', 504))).toBe(true);
    expect(nativeTransportFailure(new TypeError('Failed to fetch'))).toBe(true);
    // The engine's own refusals carry a code and are final.
    expect(nativeTransportFailure(new PrivateTradingError('x', 503, 'near_live_price_stale'))).toBe(false);
    expect(nativeTransportFailure(new PrivateTradingError('x', 504, 'native_confirmation_unknown'))).toBe(false);
    expect(nativeTransportFailure(new PrivateTradingError('x', 409, 'CLOSE_EXCEEDS_POSITION'))).toBe(false);
    expect(nativeTransportFailure(new PrivateTradingError('x', 500))).toBe(false);
  });

  it('retries a restart until the server answers, and returns that answer', async () => {
    const send = jest.fn()
      .mockRejectedValueOnce(new PrivateTradingError('Счёт временно недоступен', 502))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce('receipt');
    const waits: number[] = [];
    await expect(withNativeTransportRetry(send, async ms => { waits.push(ms); })).resolves.toBe('receipt');
    expect(send).toHaveBeenCalledTimes(3);
    expect(waits).toEqual(NATIVE_TRANSPORT_RETRY_DELAYS_MS.slice(0, 2));
  });

  it('stops at once on a refusal, and after the last delay on a server that stays down', async () => {
    const refused = jest.fn().mockRejectedValue(new PrivateTradingError('x', 409, 'INSUFFICIENT_DEMO_MARGIN'));
    await expect(withNativeTransportRetry(refused, noWait)).rejects.toMatchObject({ code: 'INSUFFICIENT_DEMO_MARGIN' });
    expect(refused).toHaveBeenCalledTimes(1);
    const down = jest.fn().mockRejectedValue(new PrivateTradingError('Счёт временно недоступен', 502));
    await expect(withNativeTransportRetry(down, noWait)).rejects.toMatchObject({ status: 502 });
    expect(down).toHaveBeenCalledTimes(NATIVE_TRANSPORT_RETRY_DELAYS_MS.length + 1);
  });

  it('re-sends under the SAME idempotency key, so a retry can never place the order twice', () => {
    const hook = readFileSync(resolve(__dirname, '../../pages/private-trading/useNativeDemo.tsx'), 'utf8');
    const task = hook.slice(hook.indexOf('const task=async()=>{'), hook.indexOf('setBusy(true);', hook.indexOf('const task=async()=>{')));
    // One key per draft, taken BEFORE the retry loop and reused inside it.
    expect(task.indexOf('attempts.current.get(fingerprint)')).toBeLessThan(task.indexOf('withNativeTransportRetry('));
    expect(task).toContain('nativeDemoApi.command(draft,key!)');
    expect(task).not.toMatch(/withNativeTransportRetry\([\s\S]*randomUUID/);
  });

  it('says the server was restarting instead of the generic line when it stays down', () => {
    expect(futuresOrderErrorMessage(new PrivateTradingError('Счёт временно недоступен', 502), t, 'Не удалось разместить ордер'))
      .toBe(RU['futures.orderError.serverUnavailable']);
    // A code still wins: a real refusal says its own reason.
    expect(futuresOrderErrorMessage(new PrivateTradingError('x', 503, 'near_live_price_stale'), t, 'Не удалось разместить ордер'))
      .toBe(RU['futures.orderError.priceUnavailable']);
  });
});
