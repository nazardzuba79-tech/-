import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve, sep } from 'path';
import { customerErrorText } from '../customerError';
import { futuresOrderErrorMessage } from '../futuresOrderErrors';
import { PrivateTradingError } from '../privateTradingError';
import { createRequire } from 'module';
import ts from 'typescript';
import { RU } from '../i18n/locales/ru';
import { EN } from '../i18n/locales/en';
import { ZH } from '../i18n/locales/zh';
import { ES } from '../i18n/locales/es';
import { HI } from '../i18n/locales/hi';
import { JA } from '../i18n/locales/ja';
import { KO } from '../i18n/locales/ko';

/**
 * What a customer is allowed to read when something fails (issue #144).
 *
 * The audit this file encodes has two halves, and failing either one is a
 * bug:
 *
 *   NOTHING MECHANICAL GETS OUT. An HTTP status line, an HTML error page, a
 *   stack, an engine code, a Zod report, a caught exception's own message —
 *   none of these may reach the screen, whatever transport carried them.
 *
 *   NOTHING HONEST GETS LOST. A refusal the account actually made — not
 *   enough balance, a price step, an order that can no longer be cancelled,
 *   a wrong code — still says exactly that. Suppressing a refusal, or
 *   softening it into "try again", would be the worse bug of the two: it
 *   would let a customer believe an action was possible when it was not.
 *
 * So each case below asserts both: the raw text is absent AND the meaning
 * is present.
 */

/**
 * `privateTradingApi.ts` reads `import.meta.env` at module scope, which
 * CommonJS jest cannot parse. Every other suite that touches it transpiles
 * it the same way; this one does too rather than reaching for a mock that
 * would let the real function drift away from what is being asserted.
 */
const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
function load(file: string, imports: Record<string, unknown> = {}) {
  const output: Record<string, any> = {};
  const source = readFileSync(resolve(frontend, 'src', file), 'utf8').replace('import.meta.env.VITE_API_URL', 'undefined');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', code)((name: string) => (name in imports ? imports[name] : req(name)), output);
  return output;
}
const { privateErrorText } = load('lib/privateTradingApi.ts', {
  './api': { getToken: () => null },
  './privateTradingError': { PrivateTradingError },
}) as { privateErrorText: (error: unknown) => string };

const t = (key: keyof typeof RU, params?: Record<string, string | number>): string => {
  let text: string = RU[key] ?? key;
  if (params) for (const [name, value] of Object.entries(params)) text = text.replace(`{${name}}`, String(value));
  return text;
};

/** What `api.ts` throws: a message, a status, and the parsed body. */
class FakeApiError extends Error {
  constructor(message: string, public status: number, public body: Record<string, unknown> = {}) {
    super(message);
  }
}

const FALLBACK = 'Не удалось выполнить операцию.';
const say = (error: unknown) => customerErrorText(error, t, FALLBACK);

/**
 * The shapes issue #144 names, each one a real thing a route has returned.
 * They are deliberately hostile: a body that is an HTML error page, a stack
 * with file positions, a status line, an engine identifier, and a caught
 * runtime fault.
 */
const INJECTED: { label: string; error: unknown }[] = [
  { label: 'a raw HTTP status line', error: new FakeApiError('HTTP/1.1 502 Bad Gateway', 502) },
  { label: 'an HTML error body', error: new FakeApiError('<!DOCTYPE html><html><head><title>504 Gateway Time-out</title></head><body><h1>504</h1></body></html>', 504) },
  { label: 'a stack-like string', error: new FakeApiError("TypeError: Cannot read properties of undefined (reading 'balance')\n    at placeOrder (/srv/api/routes/orders.ts:118:24)", 500) },
  { label: 'an unknown engine code', error: new FakeApiError('ORDER_REJECTED_BY_RISK_ENGINE_V2', 400, { code: 'ORDER_REJECTED_BY_RISK_ENGINE_V2' }) },
  { label: 'an arbitrary error.message', error: new FakeApiError('pool.query: connection terminated unexpectedly (DATABASE_URL)', 500) },
  { label: 'a flattened Zod report', error: new FakeApiError('Required; String must contain at least 8 character(s)', 400) },
  { label: "the client's own transport boilerplate", error: new FakeApiError('Request failed (500)', 500) },
  { label: 'a plain runtime fault with no status', error: new Error('undefined is not a function') },
  { label: 'a rejected non-Error value', error: { weird: true } },
];

/** Vocabulary that must never appear in anything a customer reads. */
const NEVER_ON_SCREEN =
  /websocket|endpoint|localhost|DATABASE_URL|process\.env|\bstack\b|\bSQL\b|HTTP\/\d|<[a-z]+>|\.ts:\d+|\bat \S+ \(|[A-Z]{3,}_[A-Z_]{3,}|https?:\/\//i;

describe('1. injected server junk never reaches the customer', () => {
  it.each(INJECTED)('$label falls back to approved wording', ({ error }) => {
    const shown = say(error);
    const raw = error instanceof Error ? error.message : '';
    if (raw) expect(shown).not.toContain(raw);
    expect(shown).not.toMatch(NEVER_ON_SCREEN);
    // And it is a sentence someone wrote, not an echo of a translation key.
    expect(shown).toMatch(/^[А-ЯЁ]/);
    expect(shown).not.toMatch(/^[a-z]+\.[a-zA-Z]/);
  });

  it.each(INJECTED)('$label is also safe on the futures order path', ({ error }) => {
    const shown = futuresOrderErrorMessage(error, t, t('futures.placeOrderError'));
    const raw = error instanceof Error ? error.message : '';
    if (raw) expect(shown).not.toContain(raw);
    expect(shown).not.toMatch(NEVER_ON_SCREEN);
  });

  it.each(INJECTED)('$label is also safe on the private terminal path', ({ error }) => {
    const carried = error instanceof Error ? new PrivateTradingError(error.message, (error as FakeApiError).status ?? 500) : error;
    const shown = privateErrorText(carried);
    const raw = error instanceof Error ? error.message : '';
    if (raw) expect(shown).not.toContain(raw);
    expect(shown).not.toMatch(NEVER_ON_SCREEN);
  });

  it('a 500 whose body happens to mention a balance is not read as a refusal', () => {
    // The regression: matching server prose for the word "balance" turned a
    // crashed request into "недостаточно средств" — a refusal the account
    // never made. Transport failure is reported as transport failure.
    const shown = privateErrorText(new PrivateTradingError("TypeError: Cannot read properties of undefined (reading 'balance')", 500));
    expect(shown).not.toMatch(/Недостаточно/);
    expect(shown).toBe('Не удалось обновить данные. Повторите запрос.');
  });

  it('an unmapped failure is reported to the console, not silently dropped', () => {
    const report = jest.fn();
    customerErrorText(new FakeApiError('kaboom in the widget factory', 500), t, FALLBACK, { report });
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: 'kaboom in the widget factory', status: 500 }));
  });
});

describe('2. real business refusals keep their meaning', () => {
  const cases: { label: string; error: unknown; must: RegExp; mustNot?: RegExp }[] = [
    { label: 'not enough of a named asset', error: new FakeApiError('Insufficient BTC balance', 400), must: /Недостаточно BTC/ },
    { label: 'not enough to transfer', error: new FakeApiError('Insufficient USDT balance to transfer', 400), must: /Недостаточно USDT для перевода/ },
    { label: 'an amount at or below zero', error: new FakeApiError('Amount must be greater than zero', 400), must: /больше нуля/ },
    { label: 'an order that can no longer be cancelled', error: new FakeApiError('Order not found or not cancellable', 404), must: /нельзя отменить/ },
    { label: 'an order that is no longer working', error: new FakeApiError('Order not found or no longer pending', 404), must: /не активен/ },
    { label: 'a position that is already closed', error: new FakeApiError('Position not found or not open', 404), must: /закрыта/ },
    { label: 'wrong sign-in details', error: new FakeApiError('Invalid email or password', 401), must: /почта или пароль/ },
    { label: 'a wrong confirmation code', error: new FakeApiError('Invalid authentication code', 401), must: /код подтверждения/i },
    { label: 'an expired session', error: new FakeApiError('Login session expired, please sign in again', 401), must: /Войдите заново/ },
    { label: 'a wrong current password', error: new FakeApiError('Current password is incorrect', 401), must: /Текущий пароль/ },
    { label: 'two-step already on', error: new FakeApiError('Two-factor authentication is already enabled', 400), must: /уже включена/ },
    { label: 'verification already submitted', error: new FakeApiError('A submission is already pending review', 400), must: /на проверке/ },
    { label: 'verification already done', error: new FakeApiError('Already verified', 400), must: /уже подтверждён/ },
    { label: 'a missing document photo', error: new FakeApiError('Document image is required', 400), must: /фото документа/ },
    { label: 'a revoked API key', error: new FakeApiError('API key not found', 404), must: /ключ/ },
    { label: 'a withdrawal already handled', error: new FakeApiError('Withdrawal request is already APPROVED', 400), must: /уже обработана/ },
    { label: 'a transaction hash for the wrong network', error: new FakeApiError('invalid transaction hash for this network', 400), must: /сети/ },
    { label: 'throttling', error: new FakeApiError('Too many login attempts, try again later', 429), must: /Слишком много попыток/ },
    { label: 'registration closed', error: new FakeApiError('Registration is currently closed', 403), must: /закрыта/ },
    { label: 'a price this account has no quote for', error: new FakeApiError('no mark', 409, { code: 'MARK_PRICE_UNAVAILABLE' }), must: /цена|Цена/ },
  ];

  it.each(cases)('$label survives as a sentence', ({ error, must, mustNot }) => {
    const shown = say(error);
    expect(shown).toMatch(must);
    expect(shown).not.toBe(FALLBACK);
    expect(shown).not.toMatch(NEVER_ON_SCREEN);
    if (mustNot) expect(shown).not.toMatch(mustNot);
  });

  it('a throttled request is still named as throttled when the sentence is unknown', () => {
    expect(say(new FakeApiError('slow down', 429))).toMatch(/Слишком много попыток/);
  });

  it('an unrecognised 5xx says the service is unavailable rather than pretending it worked', () => {
    const shown = say(new FakeApiError('boom', 503));
    expect(shown).toMatch(/временно недоступен/);
    expect(shown).not.toMatch(/успешно|выполнено/i);
  });

  it('the futures engine codes still each carry their own cause', () => {
    const margin = futuresOrderErrorMessage(new PrivateTradingError('x', 400, 'INSUFFICIENT_DEMO_MARGIN'), t, FALLBACK);
    const step = futuresOrderErrorMessage(new PrivateTradingError('x', 400, 'INVALID_PRICE_STEP'), t, FALLBACK);
    const stale = futuresOrderErrorMessage(new PrivateTradingError('x', 400, 'LATEST_MARK_STALE'), t, FALLBACK);
    const risk = futuresOrderErrorMessage(new PrivateTradingError('x', 400, 'RISK_LIMIT_EXCEEDED'), t, FALLBACK);
    const gone = futuresOrderErrorMessage(new PrivateTradingError('x', 400, 'ORDER_NOT_FOUND'), t, FALLBACK);
    for (const shown of [margin, step, stale, risk, gone]) {
      expect(shown).not.toBe(FALLBACK);
      expect(shown).not.toMatch(NEVER_ON_SCREEN);
    }
    expect(new Set([margin, step, stale, risk, gone]).size).toBe(5);
  });

  it('the real account transport reaches the same refusals through its code', () => {
    // An `ApiError` carrying the engine's code must read like the engine's
    // own refusal, not like the generic line: the account is being told why.
    const shown = futuresOrderErrorMessage(new FakeApiError('Insufficient margin', 400, { code: 'INSUFFICIENT_DEMO_MARGIN' }), t, FALLBACK);
    expect(shown).toBe(t('futures.orderError.insufficientMargin'));
  });
});

describe('3. operator and transport detail is stripped, the fact is kept', () => {
  it('a blocked account is stated without the operator note behind it', () => {
    const shown = say(new FakeApiError('Аккаунт заблокирован: Isolated fixture block', 403));
    expect(shown).not.toContain('Isolated fixture block');
    expect(shown).toMatch(/Доступ к аккаунту закрыт/);
    expect(shown).toMatch(/поддержку/);
  });

  it('the two-step hint no longer prints the route it used to name', () => {
    const shown = say(new FakeApiError('Start setup first with /account/2fa/setup', 400));
    expect(shown).not.toContain('/account/2fa/setup');
    expect(shown).toMatch(/двухфакторной/);
  });
});

describe('4. unknown is never rendered as zero, and a refusal is never a success', () => {
  it('the collateral note says the estimate is incomplete and names what is missing', () => {
    const note = RU['futures.collateralIncomplete'];
    expect(note).toContain('{assets}');
    expect(note).toMatch(/неполная/);
    expect(note).toMatch(/не вошли в сумму/);
    expect(note).not.toMatch(/граница/);
    // It must not claim the missing assets are worth nothing.
    expect(note).not.toMatch(/\b0\b|ноль|нул/);
  });

  it('no approved wording claims an action succeeded', () => {
    const suspicious = /успешно|выполнено|принято|подтверждено|готово/i;
    for (const [key, value] of Object.entries(RU)) {
      if (!key.startsWith('serverError.')) continue;
      expect(value).not.toMatch(suspicious);
    }
  });
});

describe('5. every locale can say all of it', () => {
  const LOCALES = { RU, EN, ZH, ES, HI, JA, KO };
  const serverErrorKeys = Object.keys(RU).filter((key) => key.startsWith('serverError.'));

  it('defines every refusal in all seven languages', () => {
    expect(serverErrorKeys.length).toBeGreaterThan(30);
    for (const [name, dictionary] of Object.entries(LOCALES)) {
      for (const key of serverErrorKeys) {
        const value = (dictionary as Record<string, string>)[key];
        expect(`${name}:${key}:${value ?? ''}`).toMatch(/:.+$/);
      }
    }
  });

  it('keeps the {asset} placeholder wherever the sentence names an asset', () => {
    for (const [name, dictionary] of Object.entries(LOCALES)) {
      for (const key of ['serverError.insufficientBalance', 'serverError.insufficientTransfer']) {
        expect(`${name} ${key}: ${(dictionary as Record<string, string>)[key]}`).toContain('{asset}');
      }
    }
  });

  it('uses no technical vocabulary in any language', () => {
    for (const [name, dictionary] of Object.entries(LOCALES)) {
      for (const key of serverErrorKeys) {
        expect(`${name} ${key}: ${(dictionary as Record<string, string>)[key]}`).not.toMatch(NEVER_ON_SCREEN);
      }
    }
  });
});

describe('6. no customer-facing screen renders a server message directly', () => {
  /**
   * The sweep, kept as a guard.
   *
   * Reading `.message` off a caught error is how every leak in this issue
   * happened, so outside the three modules that exist to translate one, no
   * customer-facing file may read it at all — not into a `setError`, not
   * into a local `const message` on its way there. A `console.` line is
   * fine: that is where the original belongs.
   *
   * The admin console is deliberately exempt. Its readers are the operators
   * who need the server's own words, and issue #144 says so explicitly.
   */
  const SRC = resolve(__dirname, '../..');
  const BOUNDARY = ['lib/customerError.ts', 'lib/futuresOrderErrors.ts', 'lib/privateTradingApi.ts'];
  const READS_MESSAGE = /\b(?:err|error|e)\.message\b/;

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return entry === '__tests__' ? [] : walk(full);
      return /\.tsx?$/.test(full) ? [full] : [];
    });

  it('leaves no file outside the display boundary reading a server message', () => {
    const offenders = walk(SRC)
      .map((file) => relative(SRC, file).split(sep).join('/'))
      .filter((file) => !/(^|\/)admin\//i.test(file) && !/Admin\w*\.tsx$/.test(file))
      .filter((file) => !BOUNDARY.includes(file))
      .flatMap((file) =>
        readFileSync(join(SRC, file), 'utf8')
          .split('\n')
          .map((line, index) => ({ file, line: index + 1, text: line.trim() }))
          .filter(({ text }) => READS_MESSAGE.test(text) && !text.includes('console.') && !text.startsWith('*') && !text.startsWith('//'))
      )
      .map(({ file, line, text }) => `${file}:${line} ${text}`);
    expect(offenders).toEqual([]);
  });

  it('would catch a leak if one came back', () => {
    // The guard above is only worth having if it fails on the shape it is
    // meant to stop, so the shape is asserted directly rather than trusted.
    expect(READS_MESSAGE.test("setError(err instanceof ApiError ? err.message : t('x'));")).toBe(true);
    expect(READS_MESSAGE.test("const message = err instanceof Error ? err.message : t('x');")).toBe(true);
    expect(READS_MESSAGE.test("toast.error(error instanceof Error ? error.message : t('x'));")).toBe(true);
    expect(READS_MESSAGE.test(".catch(e => setError(e.message))")).toBe(true);
    expect(READS_MESSAGE.test("setError(customerErrorText(err, t, t('x')));")).toBe(false);
  });
});
