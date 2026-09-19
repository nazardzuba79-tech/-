import type { Key } from './i18n/locales/keys';

/**
 * The one place a server failure turns into words a customer reads.
 *
 * THE PROBLEM THIS SOLVES. `ApiError.message` is whatever the route put in
 * `body.error`, and across this backend that is, variously:
 *
 *   'Order not found or not cancellable'      — English, in a Russian UI
 *   'Start setup first with /account/2fa/setup' — an endpoint path, on screen
 *   'Аккаунт заблокирован: Isolated fixture block' — an operator's own note
 *   'Required; String must contain at least 8…' — a flattened Zod report
 *   'Request failed (500)'                    — the client's own boilerplate
 *
 * A component that renders `err.message` cannot tell those apart, so all of
 * them reach the screen. This module reads the server's answer and answers
 * the customer in the interface language instead.
 *
 * WHAT IT DOES NOT DO. It does not soften or suppress refusals. A refusal is
 * the most useful thing the server can say, and every refusal this backend
 * makes is mapped below and kept — not enough balance stays not enough
 * balance, an order that can no longer be cancelled still says so. Nothing
 * here turns a failure into a success, an unavailable action into an
 * available one, or an unknown value into a zero.
 *
 * THE ORDER, most specific first:
 *
 *   1. a `code` the caller has wording for, then one this module knows;
 *   2. the server's sentence, matched against the phrases the routes emit;
 *   3. the transport status, for the two cases that need no sentence
 *      (throttled, or the server broke);
 *   4. the caller's own localized fallback.
 *
 * Step 4 is reached when the server said something no route in this
 * repository is known to say. That original goes to the console, never to
 * the screen: an unmapped sentence is a gap in the table below, and the
 * honest thing to show meanwhile is the caller's plain refusal line.
 */

export type Translate = (key: Key, params?: Record<string, string | number>) => string;

/** Machine-readable reasons the routes attach alongside the message. */
const CODE_KEY: Record<string, Key> = {
  NOT_FOUND: 'serverError.notFound',
  MARK_PRICE_UNAVAILABLE: 'serverError.priceUnavailable',
  CARD_VALUATION_UNAVAILABLE: 'serverError.priceUnavailable',
  CARD_NOT_ELIGIBLE: 'serverError.cardNotEligible',
  CARD_APPLICATION_REQUIRED: 'serverError.cardApplicationRequired',
  CARD_APPLICATION_ALREADY_EXISTS: 'serverError.cardApplicationExists',
  INVALID_CARD_PRODUCT: 'serverError.checkFields',
};

/**
 * The exact sentences the routes return, matched on the trimmed message.
 *
 * Every entry here is a real string from `src/api/routes` or the services
 * behind them. The point of matching the whole sentence rather than a
 * keyword is that a near-miss falls through to the caller's fallback, which
 * is safe, instead of to a confident translation of something else.
 */
const PHRASE_KEY: Record<string, Key> = {
  // auth
  'Invalid email or password': 'serverError.invalidCredentials',
  'Login session expired, please sign in again': 'serverError.sessionExpired',
  'Invalid authentication code': 'serverError.invalidCode',
  'Registration failed': 'register.error.failed',
  'Registration is currently closed': 'register.error.closed',
  Unauthorized: 'serverError.signInRequired',
  // account and security
  'Current password is incorrect': 'serverError.passwordIncorrect',
  'Two-factor authentication is already enabled': 'serverError.twoFaAlreadyOn',
  'Two-factor authentication is not enabled': 'serverError.twoFaNotOn',
  'Start setup first with /account/2fa/setup': 'serverError.twoFaSetupFirst',
  'Session not found': 'serverError.sessionNotFound',
  'User not found': 'serverError.accountNotFound',
  'No fields to update': 'serverError.nothingToUpdate',
  'Missing image': 'serverError.imageRequired',
  // verification
  'Document image is required': 'serverError.documentRequired',
  'Document file missing': 'serverError.documentMissing',
  'Already verified': 'serverError.alreadyVerified',
  'A submission is already pending review': 'serverError.reviewPending',
  'Upload failed': 'serverError.uploadFailed',
  // api keys
  'API key not found': 'serverError.apiKeyNotFound',
  // money movement
  'Amount must be greater than zero': 'serverError.amountAboveZero',
  'Withdrawal request not found': 'serverError.withdrawalNotFound',
  'Failed to submit withdrawal request': 'serverError.withdrawFailed',
  'invalid transaction hash for this network': 'serverError.invalidTxHash',
  // orders and positions
  'Order not found or not cancellable': 'serverError.orderNotCancellable',
  'Order not found or no longer pending': 'serverError.orderNotPending',
  'Position not found or not open': 'serverError.positionClosed',
  'Position not found': 'serverError.positionClosed',
  // catalogue and support
  'Product not found': 'serverError.notFound',
  'Conversation not found': 'serverError.notFound',
  'Not found': 'serverError.notFound',
  'Purchase failed': 'serverError.purchaseFailed',
  'Strategy unavailable': 'serverError.dataUnavailable',
  'Strategy performance temporarily unavailable': 'serverError.dataUnavailable',
  'Strategy identity temporarily unavailable': 'serverError.dataUnavailable',
  'Portfolio service unavailable': 'serverError.dataUnavailable',
  'Market-wide data is temporarily unavailable': 'serverError.dataUnavailable',
  'Internal server error': 'serverError.unavailable',
  'Операция временно недоступна': 'serverError.unavailable',
  'Проверьте параметры запроса': 'serverError.checkFields',
  'Этот аккаунт торгует только в симуляции': 'serverError.practiceOnly',
};

/**
 * Sentences built around a value.
 *
 * `asset` is carried through because the asset is the whole point of the
 * message — "not enough balance" without naming the coin sends the customer
 * to check the wrong one. It is a ticker the customer already chose, not
 * server internals. The blocked-account reason is deliberately NOT carried
 * through: it is written by an operator for operators (production has one
 * reading `Isolated fixture block`) and belongs in the admin console.
 */
const PATTERN_KEY: { shape: RegExp; key: Key; params?: (match: RegExpMatchArray) => Record<string, string> }[] = [
  { shape: /^Insufficient ([A-Z0-9]{2,12}) balance to transfer$/, key: 'serverError.insufficientTransfer', params: (m) => ({ asset: m[1] }) },
  { shape: /^Insufficient ([A-Z0-9]{2,12}) balance$/, key: 'serverError.insufficientBalance', params: (m) => ({ asset: m[1] }) },
  { shape: /^Withdrawal request is already \w+$/, key: 'serverError.withdrawalAlreadyHandled' },
  { shape: /^Too many registration attempts/, key: 'register.error.tooManyAttempts' },
  { shape: /^Too many/, key: 'serverError.tooManyAttempts' },
  { shape: /^Аккаунт заблокирован/, key: 'serverError.accountBlocked' },
];

/** Statuses that say enough on their own when the sentence was unknown. */
const STATUS_KEY: { matches: (status: number) => boolean; key: Key }[] = [
  { matches: (s) => s === 429, key: 'serverError.tooManyAttempts' },
  { matches: (s) => s >= 500, key: 'serverError.unavailable' },
];

export interface CustomerErrorOptions {
  /** Wording this caller has for a server `code`, tried before the shared table. */
  byCode?: Record<string, Key>;
  /** Where the withheld original is reported. Defaults to the console. */
  report?: (detail: { message: string; status?: number; code?: string }) => void;
}

interface ServerFailure {
  message: string;
  status?: number;
  code?: string;
}

/** What we can learn about a thrown value without assuming its class. */
function readFailure(error: unknown): ServerFailure {
  const shaped = error as { status?: unknown; body?: Record<string, unknown> } | null | undefined;
  const status = typeof shaped?.status === 'number' ? shaped.status : undefined;
  const body = shaped?.body;
  const code = body && typeof body.code === 'string' ? body.code : undefined;
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return { message: message.trim(), status, code };
}

/**
 * The message to show for `error`, or `fallback` when the server said
 * something this module does not recognise.
 *
 * `fallback` must already be localized. It is the answer whenever the
 * server's own words cannot be shown, so a caller that passes raw text here
 * has simply moved the leak one line up.
 */
export function customerErrorText(error: unknown, t: Translate, fallback: string, options: CustomerErrorOptions = {}): string {
  const { message, status, code } = readFailure(error);

  if (code) {
    const key = options.byCode?.[code] ?? CODE_KEY[code];
    if (key) return t(key);
  }

  if (message) {
    const phrase = PHRASE_KEY[message];
    if (phrase) return t(phrase);
    for (const rule of PATTERN_KEY) {
      const match = message.match(rule.shape);
      if (match) return t(rule.key, rule.params?.(match));
    }
  }

  // Past this point the server's own answer was not recognised, so it goes
  // to the console whatever we end up showing. An unmapped sentence is a gap
  // in the tables above, and a gap nobody can see never gets closed.
  if (message || code) {
    const report =
      options.report ??
      ((detail) => {
        console.warn('[customer-error] unmapped server failure', detail.status ?? '', detail.code ?? '', detail.message);
      });
    report({ message, status, code });
  }

  if (status !== undefined) {
    const rule = STATUS_KEY.find((entry) => entry.matches(status));
    if (rule) return t(rule.key);
  }

  return fallback;
}
