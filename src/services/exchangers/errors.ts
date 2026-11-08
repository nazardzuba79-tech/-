/**
 * The only error type the BestChange integration («Обменники», #694) ever
 * throws. The BestChange API key travels in the request PATH, so any message
 * that embedded a URL, a fetch/undici error text or an upstream body could
 * leak it. Every BestChangeError therefore carries one of a few fixed
 * messages, no `cause`, and nothing derived from the request or the response.
 */
export type BestChangeErrorCode =
  /** No usable key is configured. No upstream request was made. */
  | 'not_configured'
  /** Upstream answered with a JSON error saying the key is invalid. */
  | 'key_rejected'
  /** Upstream answered HTTP 429. */
  | 'rate_limited'
  /** Any other upstream failure: network, timeout, 4xx/5xx, non-JSON, bad shape, too large. */
  | 'upstream'
  /** A programming error in the caller (bad lang / pair list). Never reaches upstream. */
  | 'invalid_request';

const MESSAGES: Readonly<Record<BestChangeErrorCode, string>> = {
  not_configured: 'BestChange API is not configured',
  key_rejected: 'BestChange API key was rejected',
  rate_limited: 'BestChange API rate limit reached',
  upstream: 'BestChange API is unavailable',
  invalid_request: 'BestChange API request is invalid',
};

export class BestChangeError extends Error {
  readonly code: BestChangeErrorCode;

  constructor(code: BestChangeErrorCode) {
    super(MESSAGES[code]);
    this.name = 'BestChangeError';
    this.code = code;
  }
}

export function isBestChangeError(value: unknown): value is BestChangeError {
  return value instanceof BestChangeError;
}
