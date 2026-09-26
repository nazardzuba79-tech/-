export const RETENTION_MS = 7 * 24 * 60 * 60_000;
export const VERSION = 'notifications-v1';
const TYPES = ['KYC_SUBMITTED', 'DEPOSIT_DISCOVERED'];
export const reply = (status, code, extra = {}) => Response.json({ status: code, ...extra }, {
  status, headers: { 'cache-control': 'no-store' },
});
export const configured = env => Boolean(env.TELEGRAM_BOT_TOKEN?.trim() && env.TELEGRAM_CHAT_ID?.trim());
export const logFailure = status => console.warn('[notifications]', status);
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const amount = value => typeof value === 'string' && /^(?:0|[1-9]\d{0,19})(?:\.\d{1,18})?$/.test(value);

export function validEvent(e, type, now = Date.now()) {
  if (!e || e.eventType !== type || !TYPES.includes(type)) return false;
  if (!text(e.eventId, 160) || !/^[A-Za-z0-9:_-]+$/.test(e.eventId)) return false;
  if (!Number.isSafeInteger(e.timestamp) || e.timestamp > now + 60_000 || e.timestamp <= now - RETENTION_MS) return false;
  if (type === 'KYC_SUBMITTED') {
    return (!e.email || (text(e.email, 254) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.email)))
      && (!e.fullName || text(e.fullName, 200)) && (!e.documentType || text(e.documentType, 40));
  }
  return amount(e.amount) && e.asset === 'USDT' && e.network === 'TRC20'
    && (!e.email || (text(e.email, 254) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.email)))
    && (e.accumulated === undefined || amount(e.accumulated))
    && (e.remaining === undefined || amount(e.remaining));
}

export function message(e) {
  if (e.eventType === 'KYC_SUBMITTED') return [
    '🔔 Новая KYC заявка', '', e.email && `Email: ${e.email}`,
    'Статус: ожидает проверки', e.fullName && `Full Name: ${e.fullName}`,
    e.documentType && `Document Type: ${e.documentType}`,
  ].filter(line => line !== false && line !== undefined && line !== null).join('\n');
  // These are discovery facts, not proof of finality, attribution or credit.
  const total = e.accumulated ?? e.amount;
  const ready = BigInt(total.split('.')[0]) >= 300n;
  return ['💰 Новое пополнение', '', `Сумма: ${e.amount} ${e.asset}`, `Сеть: ${e.network}`,
    `Статус: ${ready ? 'Готов к проверке' : e.email ? 'Накопление' : 'Непривязанный'}`,
    e.email && `Email: ${e.email}`, e.accumulated !== undefined && `Накоплено: ${e.accumulated} USDT`,
    e.remaining !== undefined && `Осталось до минимума: ${e.remaining} USDT`,
  ].filter(line => line !== false && line !== undefined && line !== null).join('\n');
}

export async function acceptEvent(event, type, env) {
  if (!validEvent(event, type)) return reply(400, 'INVALID_EVENT');
  if (!configured(env)) return reply(503, 'NOT_CONFIGURED');
  // Reject unknown fields: no documents, document text or arbitrary message bodies.
  const allowed = type === 'KYC_SUBMITTED'
    ? ['eventId', 'eventType', 'timestamp', 'email', 'fullName', 'documentType']
    : ['eventId', 'eventType', 'timestamp', 'amount', 'asset', 'network', 'email', 'accumulated', 'remaining'];
  if (Object.keys(event).some(key => !allowed.includes(key))) return reply(400, 'INVALID_EVENT');
  const id = env.EVENTS.idFromName(`${type}:${event.eventId}`);
  return env.EVENTS.get(id).fetch(new Request('https://internal/event', { method: 'POST', body: JSON.stringify(event) }));
}

async function boundedBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('body');
  let size = 0; const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) { await reader.cancel(); throw new Error('body'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export async function handle(request, env) {
  const path = new URL(request.url).pathname;
  if (request.method === 'GET' && path === '/health') return reply(200, configured(env) ? 'CONFIGURED' : 'NOT_CONFIGURED', {
    service: 'voltex-notification-edge', version: VERSION,
    depositSigningConfigured: Boolean(env.DEPOSIT_SIGNING_PUBLIC_KEY),
  });
  if (request.method !== 'POST' || path !== '/v1/deposit') return reply(404, 'NOT_FOUND');
  // No browser entry point; even a non-browser caller must sign the exact body.
  if (request.headers.has('origin') || request.headers.has('sec-fetch-site')) return reply(403, 'FORBIDDEN');
  const ts = request.headers.get('x-voltex-timestamp') || '';
  const signature = request.headers.get('x-voltex-signature') || '';
  if (!/^\d{13}$/.test(ts) || Math.abs(Date.now() - Number(ts)) > 5 * 60_000 || !/^[A-Za-z0-9_-]{86}$/.test(signature)) return reply(401, 'UNAUTHORIZED');
  if (!env.DEPOSIT_SIGNING_PUBLIC_KEY) return reply(503, 'NOT_CONFIGURED');
  try {
    const body = await boundedBody(request);
    const key = await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: env.DEPOSIT_SIGNING_PUBLIC_KEY }, { name: 'Ed25519' }, false, ['verify']);
    const sig = Uint8Array.from(atob(signature.replace(/-/g, '+').replace(/_/g, '/') + '=='), c => c.charCodeAt(0));
    if (!await crypto.subtle.verify('Ed25519', key, sig, new TextEncoder().encode(`voltex-notifications-v1\n${ts}\n${path}\n${body}`))) return reply(401, 'UNAUTHORIZED');
    return await acceptEvent(JSON.parse(body), 'DEPOSIT_DISCOVERED', env);
  } catch {
    // Never log request bodies, Telegram URLs, credentials or exception messages.
    logFailure('EVENT_REJECTED_OR_UNAVAILABLE');
    return reply(503, 'UNAVAILABLE');
  }
}

/** One Durable Object per event; durable claim BEFORE the external side effect.
 * At most one attempt, including ambiguous timeouts and process crashes.
 * Stored shape is deliberately limited to the four owner-approved fields.
 */
export class Delivery {
  constructor(state, env, send = (input, init) => fetch(input, init), now = Date.now) {
    this.state = state; this.env = env; this.send = send; this.now = now;
  }
  async fetch(request) {
    const event = await request.json();
    if (!validEvent(event, event.eventType, this.now())) return reply(400, 'INVALID_EVENT');
    if (!configured(this.env)) return reply(503, 'NOT_CONFIGURED');
    const record = { eventId: event.eventId, eventType: event.eventType, status: 'ATTEMPTED', timestamp: this.now() };
    const previous = await this.state.storage.transaction(async tx => {
      const existing = await tx.get('event');
      if (existing) return existing;
      await tx.put('event', record);
      await tx.setAlarm(Math.max(record.timestamp, event.timestamp) + RETENTION_MS);
      return null;
    });
    if (previous) return reply(200, 'DUPLICATE', { deliveryStatus: previous.status });
    let status = 'UNKNOWN';
    try {
      const response = await this.send(`https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: this.env.TELEGRAM_CHAT_ID, text: message(event), link_preview_options: { is_disabled: true } }),
        signal: AbortSignal.timeout(5_000), redirect: 'manual',
      });
      const result = await response.json();
      status = response.ok && result?.ok === true && Number.isSafeInteger(result?.result?.message_id) ? 'SENT' : 'FAILED';
    } catch { /* ambiguous outcome: NEVER retry sendMessage */ }
    if (status !== 'SENT') logFailure(status);
    await this.state.storage.put('event', { ...record, status });
    return reply(status === 'SENT' ? 200 : 502, status);
  }
  async alarm() {
    // One-shot retention cleanup, including when no new events arrive.
    // No self-reschedule, polling, external calls or message retries.
    await this.state.storage.deleteAll();
  }
}
