/**
 * Minimal BestChange API v2 transport for «Обменники» (#694).
 *
 * Contract (https://bestchange.app/en/openapi.yaml, docs/EXCHANGERS_694.md):
 *   https://<official host>/v2/<apiKey>/<path>
 * The key is a PATH segment, so it is part of every request URL. Rules here:
 *   - only the five official hosts from the OpenAPI `servers` list are contacted;
 *   - the URL is never logged, thrown, stored or returned. Every failure becomes a
 *     BestChangeError with a fixed message (see errors.ts); logs carry only a fixed
 *     reason plus `{ host, status }`;
 *   - `redirect: 'error'`, an 8 s timeout per attempt, a total time budget and a
 *     response-body size cap;
 *   - the next official mirror is tried ONLY for network faults, timeouts, HTTP 5xx
 *     and bodies that are not JSON. HTTP 429 → 'rate_limited', other 4xx → 'upstream',
 *     a JSON body with an `error` field → 'key_rejected' when it says the key is
 *     invalid (a non-issued key gets HTTP 200 {"error":"Invalid API key"}), else
 *     'upstream'. None of those are retried on a mirror (same key, same answer).
 *
 * This module only moves bytes; shapes are validated in parse.ts.
 */
import { BestChangeError } from './errors';

export const BESTCHANGE_API_HOSTS = [
  'bestchange.app',
  'mirror1.bestchange.app',
  'mirror2.bestchange.app',
  'mirror3.bestchange.app',
  'mirror4.bestchange.app',
] as const;

/** Lenient shape check: the real key format is undocumented (issued keys seen so far are 32 hex chars). */
export const BESTCHANGE_API_KEY_PATTERN = /^[A-Za-z0-9]{16,128}$/;

export function isPlausibleBestChangeKey(value: unknown): value is string {
  return typeof value === 'string' && BESTCHANGE_API_KEY_PATTERN.test(value);
}

/** BestChange documents up to 500 pairs per batched `rates` request. */
export const MAX_RATE_PAIRS = 500;

export type BestChangeLang = 'ru' | 'en';

export type RatePair = readonly [fromCurrencyId: number, toCurrencyId: number];

export interface BestChangeApi {
  getCurrencies(lang: BestChangeLang): Promise<unknown>;
  getChangers(lang: BestChangeLang): Promise<unknown>;
  /** ONE batched request `rates/a-b+c-d+…` for every pair. */
  getRates(pairs: readonly RatePair[]): Promise<unknown>;
}

export interface BestChangeClientOptions {
  apiKey: string;
  fetchFn?: typeof fetch;
  /** Per attempt. Default 8000 ms. */
  timeoutMs?: number;
  /** Across all mirror attempts of one call. Default 20000 ms. */
  totalBudgetMs?: number;
  /** Response body cap. Default 8 MiB (the changer list is the largest payload). */
  maxBytes?: number;
  now?: () => number;
}

class BodyTooLarge extends Error {}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLarge();
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) throw new BodyTooLarge();
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLarge();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

const INVALID_KEY_TEXT = [/invalid\s+(?:api\s+)?key/i, /(?:неверн|недействительн)\S*\s+(?:api\s+)?ключ/i];

function saysInvalidKey(error: unknown): boolean {
  return typeof error === 'string' && INVALID_KEY_TEXT.some((re) => re.test(error));
}

/** Fixed-string log line. Never pass a URL, key, error object or body here. */
function logFailure(reason: string, host: string, status?: number): void {
  console.warn(`[bestchange] ${reason}`, status === undefined ? { host } : { host, status });
}

export function createBestChangeClient(options: BestChangeClientOptions): BestChangeApi {
  if (!isPlausibleBestChangeKey(options.apiKey)) throw new BestChangeError('not_configured');
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const totalBudgetMs = options.totalBudgetMs ?? 20_000;
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  const now = options.now ?? (() => Date.now());
  const keySegment = encodeURIComponent(options.apiKey);

  async function request(path: string): Promise<unknown> {
    const startedAt = now();
    for (const host of BESTCHANGE_API_HOSTS) {
      const remaining = totalBudgetMs - (now() - startedAt);
      if (remaining <= 0) break;
      let response: Response;
      let text: string;
      try {
        response = await fetchFn(`https://${host}/v2/${keySegment}/${path}`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          redirect: 'error',
          signal: AbortSignal.timeout(Math.min(timeoutMs, remaining)),
        });
      } catch {
        logFailure('network error or timeout', host);
        continue;
      }
      const status = response.status;
      if (status >= 500) {
        logFailure('upstream server error', host, status);
        await response.body?.cancel().catch(() => undefined);
        continue;
      }
      if (status === 429) {
        logFailure('upstream rate limit', host, status);
        await response.body?.cancel().catch(() => undefined);
        throw new BestChangeError('rate_limited');
      }
      if (status < 200 || status >= 300) {
        logFailure('upstream refused the request', host, status);
        await response.body?.cancel().catch(() => undefined);
        throw new BestChangeError('upstream');
      }
      if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('json')) {
        logFailure('response is not JSON', host, status);
        await response.body?.cancel().catch(() => undefined);
        continue;
      }
      try {
        text = await readLimitedText(response, maxBytes);
      } catch (error) {
        if (error instanceof BodyTooLarge) {
          logFailure('response body too large', host, status);
          throw new BestChangeError('upstream');
        }
        logFailure('network error or timeout while reading', host, status);
        continue;
      }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        logFailure('response is not valid JSON', host, status);
        continue;
      }
      if (typeof body === 'object' && body !== null && !Array.isArray(body) && Object.prototype.hasOwnProperty.call(body, 'error')) {
        if (saysInvalidKey((body as { error?: unknown }).error)) {
          logFailure('API key rejected', host, status);
          throw new BestChangeError('key_rejected');
        }
        logFailure('upstream returned an error body', host, status);
        throw new BestChangeError('upstream');
      }
      return body;
    }
    throw new BestChangeError('upstream');
  }

  function langSegment(lang: BestChangeLang): string {
    if (lang !== 'ru' && lang !== 'en') throw new BestChangeError('invalid_request');
    return lang;
  }

  return {
    getCurrencies: async (lang) => request(`currencies/${langSegment(lang)}`),
    getChangers: async (lang) => request(`changers/${langSegment(lang)}`),
    getRates: async (pairs) => {
      if (!Array.isArray(pairs) || pairs.length === 0 || pairs.length > MAX_RATE_PAIRS) {
        throw new BestChangeError('invalid_request');
      }
      const parts: string[] = [];
      for (const pair of pairs) {
        const [from, to] = pair;
        if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from <= 0 || to <= 0) {
          throw new BestChangeError('invalid_request');
        }
        parts.push(`${from}-${to}`);
      }
      return request(`rates/${parts.join('+')}`);
    },
  };
}
