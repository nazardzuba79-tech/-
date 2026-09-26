/**
 * THE SUPPORT FORM, AS DATA AND ONE REQUEST.
 *
 * Support is a form, not a chat: name, email, topic, message → one POST to
 * the voltex-support-edge Cloudflare Worker (workers/support-edge), which
 * sends one text/plain email to the owner with the user's address as
 * Reply-To. The owner answers from their mailbox. Nothing is stored,
 * nothing is polled, and neither the Render API nor the database is involved.
 *
 * The browser never sees or chooses the recipient: the Worker fixes it, and
 * the Email Routing binding is locked to that one address.
 *
 * Pure on purpose (no import.meta, no DOM): the endpoint is passed in, so
 * the rules and the one request are testable as they ship.
 */

export type SupportSubject = 'TECHNICAL' | 'KYC' | 'CARD' | 'OTHER';
export const SUPPORT_SUBJECTS: SupportSubject[] = ['TECHNICAL', 'KYC', 'CARD', 'OTHER'];

/** Same limits the Worker enforces; the form stops at them first. */
export const SUPPORT_LIMITS = { name: 100, email: 254, message: 2000 } as const;

export interface SupportFormInput {
  name: string;
  email: string;
  subject: SupportSubject;
  message: string;
  /** Honeypot. People never see or fill it. */
  website?: string;
}

export type SupportField = 'name' | 'email' | 'subject' | 'message';

// Mirrors the Worker's check, which is the one that counts.
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
// eslint-disable-next-line no-control-regex
const HEADER_UNSAFE_RE = /[\u0000-\u001F\u007F\u0085\u2028\u2029]/;

export function invalidSupportFields(input: SupportFormInput): SupportField[] {
  const bad: SupportField[] = [];
  const name = input.name.trim();
  if (!name || name.length > SUPPORT_LIMITS.name || HEADER_UNSAFE_RE.test(name)) bad.push('name');
  const email = input.email.trim();
  if (!email || email.length > SUPPORT_LIMITS.email || HEADER_UNSAFE_RE.test(email) || !EMAIL_RE.test(email)) bad.push('email');
  if (!SUPPORT_SUBJECTS.includes(input.subject)) bad.push('subject');
  const message = input.message.trim();
  if (!message || message.length > SUPPORT_LIMITS.message) bad.push('message');
  return bad;
}

export type SupportSendOutcome =
  | { status: 'sent' }
  | { status: 'failed'; reason: 'invalid' | 'rate_limited' | 'not_configured' | 'delivery_failed' | 'network' | 'unexpected' };

type FetchLike = (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

/**
 * Exactly one POST. «Сообщение отправлено» is shown only when the Worker says
 * the email provider accepted the message (`200 { ok: true }`); everything
 * else — a refusal, a limit, a network error, a timeout — is a failure the
 * user sees, never a quiet success.
 */
export async function sendSupportRequest(
  input: SupportFormInput,
  opts: { endpoint: string; fetchImpl?: FetchLike; timeoutMs?: number },
): Promise<SupportSendOutcome> {
  const doFetch: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000) : null;
  try {
    const res = await doFetch(opts.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // No cookies or tokens: the form needs none, and the Worker reads none.
      credentials: 'omit',
      cache: 'no-store',
      signal: controller?.signal,
      body: JSON.stringify({
        name: input.name.trim(),
        email: input.email.trim(),
        subject: input.subject,
        message: input.message.trim(),
        website: input.website ?? '',
      }),
    });
    const body = (await res.json().catch(() => null)) as { ok?: unknown } | null;
    if (res.ok && body?.ok === true) return { status: 'sent' };
    if (res.status === 400 || res.status === 413 || res.status === 415) return { status: 'failed', reason: 'invalid' };
    if (res.status === 429) return { status: 'failed', reason: 'rate_limited' };
    if (res.status === 503) return { status: 'failed', reason: 'not_configured' };
    if (res.status === 502) return { status: 'failed', reason: 'delivery_failed' };
    return { status: 'failed', reason: 'unexpected' };
  } catch {
    return { status: 'failed', reason: 'network' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
