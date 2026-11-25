import { domainToASCII } from 'node:url';
import { stat, readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DISPOSABLE_EMAIL_SNAPSHOT } from './disposableEmailDomains.snapshot';

const SOURCE = 'https://raw.githubusercontent.com/disposable/disposable-email-domains/master/domains.txt';
const MAX_BYTES = 4 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
// The normal upstream list is not the strict/alias list. Protect these
// mainstream providers even if a future upstream refresh accidentally lists one.
const PERMANENT = new Set(['gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','msn.com','icloud.com','me.com','mac.com','proton.me','protonmail.com','pm.me','yahoo.com','aol.com','mail.ru','inbox.ru','list.ru','bk.ru','yandex.ru','yandex.com','ya.ru','rambler.ru','ukr.net']);
const CONFIRMED_DISPOSABLE = new Set(['euploading.com','mail.tm','mailinator.com','guerrillamail.com','10minutemail.com']);

function normalizeDomain(value: string): string | null {
  const domain = domainToASCII(value.trim().toLowerCase().replace(/\.$/, ''));
  return DOMAIN.test(domain) ? domain : null;
}

export function parseDisposableDomains(text: string): Set<string> | null {
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) return null;
  const result = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const value = line.trim();
    if (!value) continue;
    // Upstream publishes ASCII hostnames. Reject malformed/HTML responses as a whole.
    if (!DOMAIN.test(value)) return null;
    result.add(value);
  }
  if (result.size < 50000 || result.size > 250000) return null;
  return result;
}
let domains: Set<string> | null = null;
function currentDomains(): Set<string> {
  if (!domains) {
    const snapshot = parseDisposableDomains(DISPOSABLE_EMAIL_SNAPSHOT);
    if (!snapshot) throw new Error('Invalid bundled disposable email snapshot');
    domains = snapshot;
  }
  return domains;
}
function overrides(value: string | undefined): Set<string> {
  return new Set((value ?? '').split(',').map(normalizeDomain).filter((x): x is string => !!x));
}

/** Exact domains only for the aggregated list: do not block unrelated users
 * of shared DNS providers by guessing from a parent suffix. Confirmed
 * dedicated temporary providers also match their subdomains. */
export function isDisposableRegistrationEmail(email: unknown): boolean {
  if (typeof email !== 'string' || email.length > 320) return false;
  const address = email.trim();
  const at = address.lastIndexOf('@');
  if (at < 1 || address.indexOf('@') !== at) return false;
  const domain = normalizeDomain(address.slice(at + 1));
  if (!domain || PERMANENT.has(domain) || overrides(process.env.DISPOSABLE_EMAIL_ALLOW_DOMAINS).has(domain)) return false;
  const manual = overrides(process.env.DISPOSABLE_EMAIL_BLOCK_DOMAINS);
  if (manual.has(domain) || currentDomains().has(domain)) return true;
  for (const parent of CONFIRMED_DISPOSABLE) if (domain === parent || domain.endsWith('.' + parent)) return true;
  return false;
}

async function readBoundedResponse(response: Response): Promise<string> {
  if (!response.ok || !response.body) throw new Error('Invalid list response');
  const contentLength = Number(response.headers.get('content-length'));
  if (contentLength > MAX_BYTES) throw new Error('List too large');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) throw new Error('List too large');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, length).toString('utf8');
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function acceptableReplacement(next: Set<string> | null, current: Set<string>): next is Set<string> {
  return !!next && next.size >= current.size / 2;
}
let timer: ReturnType<typeof setInterval> | undefined;
let inFlight = false;
async function refresh(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const response = await fetch(SOURCE, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    const raw = await readBoundedResponse(response);
    const next = parseDisposableDomains(raw);
    if (!acceptableReplacement(next, currentDomains())) throw new Error('Invalid disposable domain list');
    domains = next; // swap only a completely validated list, never clear on failure
    const cache = process.env.DISPOSABLE_EMAIL_CACHE_PATH;
    if (cache) {
      const temp = cache + '.' + randomUUID() + '.tmp';
      try {
        await mkdir(dirname(cache), { recursive: true, mode: 0o700 });
        await writeFile(temp, raw, { mode: 0o600, flag: 'wx' });
        await rename(temp, cache);
      } finally {
        await unlink(temp).catch(() => {});
      }
    }
    console.info('[disposable-email] list refreshed:', next.size);
  } catch {
    // No registration details are logged or sent to the upstream provider.
    console.warn('[disposable-email] refresh or cache write failed; retaining validated list');
  } finally {
    inFlight = false;
  }
}

/** Called once from server lifecycle, not from registration requests. */
export function startDisposableEmailRefresh(): void {
  if (timer || process.env.NODE_ENV === 'test') return;
  currentDomains(); // bundled fallback is always available before refresh
  const cache = process.env.DISPOSABLE_EMAIL_CACHE_PATH;
  void (async () => {
    if (cache) {
      try {
        if ((await stat(cache)).size <= MAX_BYTES) {
          const next = parseDisposableDomains(await readFile(cache, 'utf8'));
          if (acceptableReplacement(next, currentDomains())) domains = next;
        }
      } catch { /* initial start / unreadable cache: use bundled list */ }
    }
    await refresh();
  })();
  timer = setInterval(() => void refresh(), DAY_MS);
  timer.unref();
}
export function stopDisposableEmailRefresh(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
