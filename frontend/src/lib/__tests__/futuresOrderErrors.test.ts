import { readFileSync } from 'fs';
import { resolve } from 'path';
import { futuresOrderErrorMessage } from '../futuresOrderErrors';
import { PrivateTradingError } from '../privateTradingError';
import { RU } from '../i18n/locales/ru';
import { EN } from '../i18n/locales/en';
import { ZH } from '../i18n/locales/zh';
import { ES } from '../i18n/locales/es';
import { HI } from '../i18n/locales/hi';
import { JA } from '../i18n/locales/ja';
import { KO } from '../i18n/locales/ko';

/**
 * A refusal has to name its own cause.
 *
 * The bug these tests exist for: an order that the account could not
 * afford came back reading "max MARKET quantity …", sending the trader to
 * shrink a size that was within every contract limit. Margin and contract
 * size are separate reasons and get separate sentences — and neither is
 * ever rendered as the engine's raw code.
 */

/** A `t` that renders the REAL Russian dictionary, so wording is asserted,
 *  not a key echo. Interpolation matches `i18n.tsx`. */
const t = (key: keyof typeof RU, params?: Record<string, string | number>): string => {
  let text: string = RU[key] ?? key;
  if (params) for (const [name, value] of Object.entries(params)) text = text.replace(`{${name}}`, String(value));
  return text;
};
const FALLBACK = 'Не удалось разместить ордер';
const say = (error: unknown) => futuresOrderErrorMessage(error, t, FALLBACK);
const engine = (code: string, detail?: { limit?: string; allowed?: string; actual?: string }) =>
  new PrivateTradingError('серверный текст', 400, code, detail);

const LOCALES = { RU, EN, ZH, ES, HI, JA, KO };

describe('futures order error messages', () => {
  it('names a margin shortfall as a margin shortfall, not a size limit', () => {
    const message = say(engine('INSUFFICIENT_DEMO_MARGIN'));
    expect(message).toBe('Недостаточно средств для размещения этого ордера.');
    expect(message).not.toMatch(/количеств/i);
    expect(message).not.toMatch(/MARKET/i);
  });

  it('separates a refusal at fill time from a refusal at placement', () => {
    expect(say(engine('INSUFFICIENT_FILL_MARGIN'))).not.toBe(say(engine('INSUFFICIENT_DEMO_MARGIN')));
    expect(say(engine('INSUFFICIENT_FILL_MARGIN'))).toContain('исполнения');
  });

  it('quotes the market-order ceiling only when THAT is the limit broken', () => {
    const message = say(engine('INVALID_ORDER_SIZE', { limit: 'maxMarketOrderQty', allowed: '120', actual: '500' }));
    expect(message).toBe('Максимальное количество рыночного ордера — 120.');
    expect(message).not.toMatch(/средств/i);
  });

  it('gives each contract limit its own sentence with its own value', () => {
    const cases: [string, string, string][] = [
      ['minOrderQty', '0.001', 'Минимальное количество для этого контракта — 0.001.'],
      ['maxOrderQty', '1000', 'Максимальное количество лимитного ордера — 1000.'],
      ['minNotionalValue', '5', 'Минимальная стоимость ордера — 5 USDT.'],
      ['qtyStep', '0.01', 'Количество должно быть кратно 0.01.'],
      ['tickSize', '0.1', 'Цена должна быть кратна 0.1.'],
      ['tierMaxLeverage', '25', 'Для такого размера позиции максимальное плечо — 25x.'],
    ];
    const seen = new Set<string>();
    for (const [limit, allowed, expected] of cases) {
      const message = say(engine('INVALID_ORDER_SIZE', { limit, allowed, actual: '1' }));
      expect(message).toBe(expected);
      seen.add(message);
    }
    // Every limit reads differently — one shared sentence would be the same
    // defect in a new costume.
    expect(seen.size).toBe(cases.length);
  });

  it('never leaves a {allowed} placeholder when the engine sent no value', () => {
    for (const code of ['INVALID_QUANTITY_STEP', 'INVALID_PRICE_STEP', 'TIER_LEVERAGE_EXCEEDED']) {
      expect(say(engine(code))).not.toContain('{allowed}');
      expect(say(engine(code))).not.toBe(FALLBACK);
    }
  });

  it('never shows a raw internal code, whether or not the code is mapped', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const codes = [
        'INSUFFICIENT_DEMO_MARGIN', 'INVALID_ORDER_SIZE', 'INVALID_LEVERAGE', 'RISK_LIMIT_EXCEEDED',
        'CLOSE_EXCEEDS_POSITION', 'LIMIT_PRICE_REQUIRED', 'CONTRACT_LIMIT', 'STALE_BOOK',
        'ACCOUNT_MISSING', 'SOME_CODE_NOBODY_MAPPED_YET',
      ];
      for (const code of codes) expect(say(engine(code))).not.toMatch(/[A-Z]{3,}_[A-Z_]{3,}/);
      // The unmapped one is still recorded — for the logs, not the trader.
      expect(warn).toHaveBeenCalledWith(
        '[futures] unmapped order error code', 'SOME_CODE_NOBODY_MAPPED_YET', undefined,
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('names a near-live price the server could not refresh as a price problem to retry, not as a generic failure', () => {
    // The owner's report: «Не удалось разместить ордер» on a limit close of
    // AKEUSDT. The server had refused with `near_live_price_unavailable`
    // (the collector's frame past the command headroom and the on-demand
    // read failing on a thin book), a code this table did not know.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const code of ['near_live_price_stale', 'near_live_price_unavailable', 'quote_stale', 'collector_unavailable', 'market_data_busy', 'market_data_invalid', 'MARK_MISSING']) {
        expect(say(engine(code))).toBe('Текущая цена контракта сейчас недоступна или устарела. Повторите через несколько секунд.');
      }
      for (const code of ['native_queue_full', 'client_queue_full', 'account_changed']) expect(say(engine(code))).toBe(RU['futures.orderError.busy']);
      for (const code of ['INVALID_REDUCE_SIDE', 'INVALID_REDUCE_SYMBOL', 'MARGIN_TYPE_MISMATCH']) expect(say(engine(code))).toBe(RU['futures.orderError.reduceSide']);
      expect(say(engine('POSITION_ID_REQUIRED'))).toBe(RU['futures.orderError.positionNotOpen']);
      expect(say(engine('EXECUTION_MODE_MISMATCH'))).toBe(RU['futures.orderError.executionMode']);
      expect(say(engine('IDEMPOTENCY_CONFLICT'))).toBe(RU['futures.orderError.duplicate']);
      expect(warn).not.toHaveBeenCalled();
      for (const key of ['futures.orderError.priceUnavailable', 'futures.orderError.busy', 'futures.orderError.reduceSide', 'futures.orderError.executionMode', 'futures.orderError.duplicate'] as const) {
        for (const dict of Object.values(LOCALES)) expect(dict[key].length).toBeGreaterThan(10);
      }
    } finally {
      warn.mockRestore();
    }
  });

  it('leaves errors from the ordinary account to their own handling', () => {
    expect(say(new Error('boom'))).toBe(FALLBACK);
    expect(say(undefined)).toBe(FALLBACK);
  });

  it('withholds the engine sentence when a code has no wording yet, and logs it', () => {
    // This used to assert the opposite — an unmapped code showed the
    // engine's own text. Issue #144: that text is `data.error` verbatim,
    // which across these routes is English, a caught exception's message or
    // an HTML error page, none of it written for a trader. A gap in the
    // table is now the caller's localized line plus a console warning
    // naming the code, so the gap is visible to us and not to them.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(say(engine('NOT_IN_THE_TABLE'))).toBe(FALLBACK);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('unmapped order error code'), 'NOT_IN_THE_TABLE', undefined);
    } finally {
      warn.mockRestore();
    }
  });

  it('is translated in every language the interface offers', () => {
    const keys = Object.keys(RU).filter((key) => key.startsWith('futures.orderError.'));
    expect(keys.length).toBeGreaterThanOrEqual(30);
    for (const [name, dict] of Object.entries(LOCALES)) {
      for (const key of keys) {
        const text = (dict as Record<string, string>)[key];
        expect(typeof text === 'string' && text.trim().length > 0 ? `${name}:${key}` : `MISSING ${name}:${key}`)
          .toBe(`${name}:${key}`);
        // A locale that copied the Russian sentence verbatim was never
        // translated — the trader would just read Russian in Japanese.
        if (name !== 'RU') {
          expect(`${name}:${key}:${text === RU[key as keyof typeof RU] ? 'UNTRANSLATED' : 'ok'}`)
            .toBe(`${name}:${key}:ok`);
        }
      }
    }
  });

  it('keeps the placeholder in every language that quotes a limit value', () => {
    const parameterized = Object.keys(RU).filter(
      (key) => key.startsWith('futures.orderError.') && RU[key as keyof typeof RU].includes('{allowed}'),
    );
    expect(parameterized.length).toBeGreaterThanOrEqual(10);
    for (const [name, dict] of Object.entries(LOCALES)) {
      for (const key of parameterized) {
        expect(`${name} ${key}: ${(dict as Record<string, string>)[key]}`).toContain('{allowed}');
      }
    }
  });

  it('is what the order form, the close button and the TP/SL editor all use', () => {
    const src = (path: string) => readFileSync(resolve(__dirname, '../../', path), 'utf8');
    for (const path of [
      'components/FuturesOrderForm.tsx',
      'components/FuturesPositionsPanel.tsx',
      'components/FuturesPositionProtection.tsx',
    ]) {
      expect(src(path)).toContain('futuresOrderErrorMessage(');
    }
  });
});
