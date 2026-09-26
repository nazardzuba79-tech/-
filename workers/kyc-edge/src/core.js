// VOLTEX KYC document edge — all logic, no `cloudflare:*` imports, so the
// Node contract tests can import it directly. `index.js` wires the runtime.
//
// Document path:  browser → this Worker → Cloudflare Email Routing → admin mailbox.
// Render/Neon see two small signed JSON calls (authorize, confirm) and never a
// document byte. Nothing is stored here: no KV / R2 / D1, no public URL.

import { queueKycNotification } from './notifications.js';

export const SERVICE = 'voltex-kyc-edge';
export const VERSION = 'kyc-edge-v1';

/** Server-side only. The browser never names a recipient or a sender. */
export const KYC_RECIPIENT = 'voltex.crypto@gmail.com';
export const KYC_SENDER = 'kyc@voltextech.net';

/** Workers Free has ~10 ms CPU per request; base64 + MIME costs ~2–3 ms/MB. */
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_DOCUMENT_BYTES + 64 * 1024;

const EXTENSION = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' };
const DOCUMENT_TYPES = new Set(['PASSPORT', 'ID_CARD', 'DRIVERS_LICENSE']);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUBMISSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>"',;:\\]+@[^\s@<>"',;:\\]+\.[^\s@<>"',;:\\]+$/;
const MESSAGE_ID = /^[A-Za-z0-9._%+=$#!~-]{1,160}@[A-Za-z0-9.-]{1,120}$/;

const RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RENDER_TIMEOUT_MS = 8_000;
const EMAIL_TIMEOUT_MS = 20_000;
const BODY_TIMEOUT_MS = 30_000;

const BASE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

// ---------------------------------------------------------------- validation

/** The file's real type from its first bytes; the browser's MIME is not trusted. */
export function sniffDocument(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return 'image/png';
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return 'application/pdf';
  return null;
}

function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length >= 1 && text.length <= max ? text : null;
}

export function validDateOfBirth(value, now = new Date()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  return date.getUTCFullYear() >= 1900 && date.getTime() < now.getTime();
}

/** Returns `{ fields }` or `{ error: { status, code } }`. Field order of checks is cheap-first. */
export function validateFields(form, now = new Date()) {
  const requestId = form.get('requestId');
  const country = form.get('country');
  const fullName = cleanText(form.get('fullName'), 200);
  const dateOfBirth = form.get('dateOfBirth');
  const documentType = form.get('documentType');
  if (typeof requestId !== 'string' || !UUID_V4.test(requestId)) return { error: { status: 400, code: 'kyc_bad_request' } };
  if (typeof country !== 'string' || !/^[A-Z]{2}$/.test(country)) return { error: { status: 400, code: 'kyc_bad_request' } };
  if (!fullName) return { error: { status: 400, code: 'kyc_bad_request' } };
  if (!validDateOfBirth(dateOfBirth, now)) return { error: { status: 400, code: 'kyc_bad_request' } };
  if (typeof documentType !== 'string' || !DOCUMENT_TYPES.has(documentType)) return { error: { status: 400, code: 'kyc_bad_request' } };
  return { fields: { requestId: requestId.toLowerCase(), country, fullName, dateOfBirth, documentType } };
}

/** Size, declared type, and magic bytes — all three must agree. */
export async function validateDocument(file) {
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') return { error: { status: 400, code: 'kyc_file_required' } };
  if (file.size <= 0) return { error: { status: 400, code: 'kyc_file_required' } };
  if (file.size > MAX_DOCUMENT_BYTES) return { error: { status: 413, code: 'kyc_file_too_large' } };
  const declared = String(file.type || '').toLowerCase();
  if (!EXTENSION[declared]) return { error: { status: 415, code: 'kyc_file_type' } };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const actual = sniffDocument(bytes);
  if (!actual) return { error: { status: 415, code: 'kyc_file_type' } };
  if (actual !== declared) return { error: { status: 415, code: 'kyc_file_mismatch' } };
  return { document: { bytes, mime: actual, size: bytes.length } };
}

// ---------------------------------------------------------------- encoding

const encoder = new TextEncoder();

export function base64(bytes) {
  if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function base64url(bytes) {
  return base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(b64);
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Base64 as ASCII bytes in 76-char lines (RFC 2045), built without a giant JS string split. */
export function base64Lines(bytes) {
  const ascii = encoder.encode(base64(bytes));
  const lines = Math.ceil(ascii.length / 76);
  const out = new Uint8Array(ascii.length + lines * 2);
  let o = 0;
  for (let i = 0; i < ascii.length; i += 76) {
    const end = Math.min(i + 76, ascii.length);
    out.set(ascii.subarray(i, end), o);
    o += end - i;
    out[o++] = 13;
    out[o++] = 10;
  }
  return out;
}

/** RFC 2047 encoded-words, each ≤ 75 chars, folded; never splits a UTF-8 sequence. */
export function encodeHeaderWords(text) {
  const words = [];
  let chunk = '';
  for (const ch of text) {
    if (encoder.encode(chunk + ch).length > 45) { words.push(chunk); chunk = ''; }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${base64(encoder.encode(w))}?=`).join('\r\n ');
}

function rfc2822Date(date) {
  return date.toUTCString().replace('GMT', '+0000');
}

function concat(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function kycSubject(fullName, email) {
  return `[KYC] Новая заявка — ${fullName} — ${email}`;
}

export function kycBody({ email, fullName, country, dateOfBirth, documentType, userId, submissionId, submittedAt }) {
  return [
    `User email: ${email}`,
    `Full Name: ${fullName}`,
    `Country: ${country}`,
    `Date of Birth: ${dateOfBirth}`,
    `Document Type: ${documentType}`,
    `VOLTEX user ID: ${userId}`,
    `Submission ID: ${submissionId}`,
    `Submitted At: ${submittedAt}`,
    '',
    'Документ приложен к письму. Решение — в админ-панели VOLTEX: Верификация (KYC) → «Проверено» / «Отклонить».',
    'Это ручная (lightweight) проверка документов, а не сертифицированный KYC-провайдер.',
  ].join('\r\n');
}

/** The complete RFC 5322 message as bytes. Every header value is either fixed or encoded. */
export function buildKycMime({ from, to, submissionId, messageId, subject, text, document, date, boundary }) {
  const filename = `kyc-${submissionId}.${EXTENSION[document.mime]}`;
  const head = [
    `From: VOLTEX KYC <${from}>`,
    `To: <${to}>`,
    `Subject: ${encodeHeaderWords(subject)}`,
    `Date: ${rfc2822Date(date)}`,
    `Message-ID: <${messageId}>`,
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
    `X-Voltex-Kyc-Submission: ${submissionId}`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    '',
  ].join('\r\n');
  const attachmentHead = [
    `--${boundary}`,
    `Content-Type: ${document.mime}; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    'Content-Transfer-Encoding: base64',
    '',
    '',
  ].join('\r\n');
  return concat([
    encoder.encode(head),
    base64Lines(encoder.encode(text)),
    encoder.encode(attachmentHead),
    base64Lines(document.bytes),
    encoder.encode(`--${boundary}--\r\n`),
  ]);
}

// ---------------------------------------------------------------- keys

const keyCache = new Map();

async function signingMaterial(env) {
  const raw = env.KYC_EDGE_SIGNING_JWK;
  if (!raw) return null;
  const cached = keyCache.get(raw);
  if (cached) return cached;
  let jwk;
  try { jwk = JSON.parse(raw); } catch { return null; }
  if (jwk?.kty !== 'OKP' || jwk?.crv !== 'Ed25519' || typeof jwk.d !== 'string' || typeof jwk.x !== 'string') return null;
  const signKey = await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', d: jwk.d, x: jwk.x }, { name: 'Ed25519' }, false, ['sign']);
  const hkdf = await crypto.subtle.importKey('raw', fromBase64url(jwk.d), 'HKDF', false, ['deriveKey']);
  const receiptKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('voltex-kyc-receipt'), info: encoder.encode('v1') },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const material = { signKey, receiptKey, publicJwk: { kty: 'OKP', crv: 'Ed25519', x: jwk.x } };
  keyCache.set(raw, material);
  return material;
}

/** Signed string: `v1\n<unix-ms>\n<path>\n<body>`. Render verifies with the published public key. */
async function signedHeaders(material, path, body, now) {
  const ts = String(now);
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, material.signKey, encoder.encode(`v1\n${ts}\n${path}\n${body}`));
  return { 'x-voltex-kyc-edge-ts': ts, 'x-voltex-kyc-edge-sig': base64url(new Uint8Array(sig)) };
}

async function sealReceipt(material, payload) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, material.receiptKey, encoder.encode(JSON.stringify(payload))));
  return base64url(concat([iv, ct]));
}

async function openReceipt(material, receipt) {
  if (typeof receipt !== 'string' || receipt.length < 40 || receipt.length > 8192) return null;
  try {
    const bytes = fromBase64url(receipt);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, material.receiptKey, bytes.subarray(12));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- http helpers

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('origin');
  if (!origin || !allowedOrigins(env).includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, GET, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

function json(request, env, status, body) {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...corsHeaders(request, env) } });
}

function fail(request, env, status, code) {
  return json(request, env, status, { error: code, code });
}

function withTimeout(promise, ms, code) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(code), { code })), ms); }),
  ]).finally(() => clearTimeout(timer));
}

function log(event, detail = {}) {
  // Identifiers and sizes only — never a name, date of birth, email or document byte.
  console.log(JSON.stringify({ svc: SERVICE, event, ...detail }));
}

// ---------------------------------------------------------------- rate limit (per isolate + optional binding)

const windows = new Map();

function isolateAllows(key, limit, windowMs, now) {
  const recent = (windows.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) { windows.set(key, recent); return false; }
  recent.push(now);
  windows.set(key, recent);
  if (windows.size > 5000) windows.clear();
  return true;
}

async function rateAllowed(env, key, now) {
  if (!isolateAllows(key, 8, 10 * 60_000, now)) return false;
  if (env.KYC_RATE_LIMIT && typeof env.KYC_RATE_LIMIT.limit === 'function') {
    try {
      const { success } = await env.KYC_RATE_LIMIT.limit({ key });
      return success !== false;
    } catch {
      return true; // the isolate window still applies
    }
  }
  return true;
}

// ---------------------------------------------------------------- render calls

async function callRender(env, deps, material, path, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  const signature = await signedHeaders(material, `/api/v1${path}`, body, deps.now());
  const res = await deps.fetch(`${String(env.VOLTEX_API_ORIGIN).replace(/\/$/, '')}/api/v1${path}`, {
    method: 'POST',
    // A vendor type, so the API's global JSON parser leaves the raw bytes for
    // the signature check.
    headers: { 'content-type': 'application/vnd.voltex.kyc-edge+json', ...signature, ...extraHeaders },
    body,
    signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
}

async function confirmWithRender(env, deps, material, confirm) {
  try {
    const { status, data } = await callRender(env, deps, material, '/internal/kyc/submission-confirmed', confirm);
    return status >= 200 && status < 300 ? { ok: true, result: data?.status ?? null } : { ok: false, status };
  } catch {
    return { ok: false, status: 0 };
  }
}

// ---------------------------------------------------------------- idempotency

const inFlight = new Map();

function idemKey(request, submissionId) {
  return new Request(new URL(`/__idem/${submissionId}`, request.url).toString());
}

async function rememberedDelivery(deps, request, submissionId) {
  if (!deps.cache) return null;
  try {
    const hit = await deps.cache.match(idemKey(request, submissionId));
    return hit ? await hit.json() : null;
  } catch {
    return null;
  }
}

async function rememberDelivery(deps, request, submissionId, value) {
  if (!deps.cache) return;
  try {
    await deps.cache.put(idemKey(request, submissionId), new Response(JSON.stringify(value), {
      headers: { 'content-type': 'application/json', 'cache-control': 'max-age=86400' },
    }));
  } catch { /* best effort; the DB unique key is the real guard */ }
}

// ---------------------------------------------------------------- handlers

async function handleSubmit(request, env, ctx, deps) {
  const now = deps.now();
  const origin = request.headers.get('origin');
  if (origin && !allowedOrigins(env).includes(origin)) return fail(request, env, 403, 'kyc_origin_forbidden');

  const auth = request.headers.get('authorization') || '';
  if (!/^Bearer [A-Za-z0-9._~+/=-]{20,4096}$/.test(auth)) return fail(request, env, 401, 'kyc_auth_required');

  // Browsers always send Content-Length for a FormData body; without it the
  // runtime would buffer an unbounded stream before any check could run.
  const length = Number(request.headers.get('content-length') || '0');
  if (!Number.isFinite(length) || length <= 0) return fail(request, env, 411, 'kyc_bad_request');
  if (length > MAX_BODY_BYTES) return fail(request, env, 413, 'kyc_file_too_large');
  if (!String(request.headers.get('content-type') || '').toLowerCase().startsWith('multipart/form-data')) {
    return fail(request, env, 400, 'kyc_bad_request');
  }

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (!(await rateAllowed(env, `submit:${ip}`, now))) return fail(request, env, 429, 'kyc_rate_limited');

  const material = await signingMaterial(env);
  if (!material || !env.VOLTEX_API_ORIGIN || !deps.sendEmail) return fail(request, env, 503, 'kyc_edge_not_configured');

  let form;
  try {
    form = await withTimeout(request.formData(), BODY_TIMEOUT_MS, 'kyc_timeout');
  } catch (err) {
    return fail(request, env, err?.code === 'kyc_timeout' ? 408 : 400, err?.code === 'kyc_timeout' ? 'kyc_timeout' : 'kyc_bad_request');
  }

  const checked = validateFields(form, new Date(now));
  if (checked.error) return fail(request, env, checked.error.status, checked.error.code);
  const doc = await validateDocument(form.get('document'));
  if (doc.error) return fail(request, env, doc.error.status, doc.error.code);
  const { fields } = checked;
  const { document } = doc;

  // 1. Who is this, really? Render checks the session and the KYC state and
  //    names the submission. The browser's userId/email are never used.
  let authz;
  try {
    authz = await callRender(env, deps, material, '/internal/kyc/authorize', {
      requestId: fields.requestId,
      country: fields.country,
      fullName: fields.fullName,
      dateOfBirth: fields.dateOfBirth,
      documentType: fields.documentType,
      documentMimeType: document.mime,
      documentSizeBytes: document.size,
    }, { authorization: auth });
  } catch {
    return fail(request, env, 503, 'kyc_service_unavailable');
  }
  if (authz.status === 401) return fail(request, env, 401, 'kyc_auth_required');
  if (authz.status === 409 || authz.status === 429 || authz.status === 400 || authz.status === 403) {
    const code = typeof authz.data?.code === 'string' ? authz.data.code : 'kyc_bad_request';
    return fail(request, env, authz.status, code);
  }
  if (authz.status !== 200) return fail(request, env, 503, 'kyc_service_unavailable');
  const { submissionId, userId, email, alreadySubmitted } = authz.data || {};
  if (typeof submissionId !== 'string' || !SUBMISSION_ID.test(submissionId) || typeof userId !== 'string' || typeof email !== 'string' || !EMAIL.test(email)) {
    return fail(request, env, 503, 'kyc_service_unavailable');
  }
  if (alreadySubmitted) {
    log('submit_duplicate', { submissionId });
    return json(request, env, 200, { status: 'PENDING', submissionId, confirmed: true, duplicate: true });
  }

  // One email per submissionId: concurrent double-submits in this isolate
  // share the first attempt; a retry after success skips the send.
  const running = inFlight.get(submissionId);
  if (running) {
    const shared = await running.catch(() => null);
    if (!shared) return fail(request, env, 502, 'kyc_email_failed');
    return json(request, env, shared.confirmed ? 201 : 202, shared);
  }
  const attempt = deliverAndConfirm(request, env, ctx, deps, material, { fields, document, submissionId, userId, email, now });
  inFlight.set(submissionId, attempt);
  try {
    const outcome = await attempt;
    return json(request, env, outcome.confirmed ? 201 : 202, outcome);
  } catch (err) {
    log('email_failed', { submissionId, code: String(err?.code || err?.name || 'error').slice(0, 60) });
    return fail(request, env, 502, 'kyc_email_failed');
  } finally {
    inFlight.delete(submissionId);
  }
}

async function deliverAndConfirm(request, env, ctx, deps, material, { fields, document, submissionId, userId, email, now }) {
  const submittedAt = new Date(now).toISOString();
  const messageId = `${submissionId}@voltextech.net`;

  const remembered = await rememberedDelivery(deps, request, submissionId);
  let emailAcceptedAt = remembered?.emailAcceptedAt;
  let emailMessageId = typeof remembered?.emailMessageId === 'string' ? remembered.emailMessageId : messageId;
  if (!emailAcceptedAt) {
    const raw = buildKycMime({
      from: KYC_SENDER,
      to: KYC_RECIPIENT,
      submissionId,
      messageId,
      subject: kycSubject(fields.fullName, email),
      text: kycBody({ ...fields, email, userId, submissionId, submittedAt }),
      document,
      date: new Date(now),
      boundary: `voltex-kyc-${crypto.randomUUID()}`,
    });
    // Throws when the provider refuses — no confirm call, no Neon row.
    const sent = await withTimeout(deps.sendEmail(KYC_SENDER, KYC_RECIPIENT, raw), EMAIL_TIMEOUT_MS, 'kyc_email_timeout');
    emailAcceptedAt = new Date(deps.now()).toISOString();
    // The platform may assign its own Message-ID; record the one it reports.
    const reported = typeof sent?.messageId === 'string' ? sent.messageId.trim().replace(/^<|>$/g, '') : '';
    if (MESSAGE_ID.test(reported)) emailMessageId = reported;
    await rememberDelivery(deps, request, submissionId, { emailAcceptedAt, emailMessageId });
    log('email_accepted', { submissionId, bytes: document.size, mime: document.mime });
  }

  const confirm = {
    submissionId,
    requestId: fields.requestId,
    userId,
    country: fields.country,
    fullName: fields.fullName,
    dateOfBirth: fields.dateOfBirth,
    documentType: fields.documentType,
    documentMimeType: document.mime,
    documentSizeBytes: document.size,
    emailMessageId,
    emailAcceptedAt,
  };
  const first = await confirmWithRender(env, deps, material, confirm);
  const notification = {
    eventId: submissionId, eventType: 'KYC_SUBMITTED', timestamp: Date.parse(emailAcceptedAt),
    email, fullName: fields.fullName, documentType: fields.documentType,
  };
  if (first.ok) {
    log('confirmed', { submissionId, result: first.result });
    queueKycNotification(env, ctx, notification, first.result);
    return { status: 'PENDING', submissionId, confirmed: true };
  }

  // The document is delivered; only the tiny metadata call is missing. Hand
  // the browser a sealed receipt (unreadable outside this Worker) so it can
  // retry that call — never the upload — and keep retrying here briefly.
  log('confirm_deferred', { submissionId, status: first.status });
  const receipt = await sealReceipt(material, { v: 1, exp: now + RECEIPT_TTL_MS, confirm, notification });
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil((async () => {
      for (const delay of [2_000, 8_000]) {
        await new Promise((r) => setTimeout(r, delay));
        const retry = await confirmWithRender(env, deps, material, confirm);
        if (retry.ok) {
          log('confirmed_late', { submissionId });
          queueKycNotification(env, ctx, notification, retry.result);
          return;
        }
      }
    })());
  }
  return { status: 'PENDING', submissionId, confirmed: false, receipt };
}

async function handleConfirm(request, env, ctx, deps) {
  const now = deps.now();
  const origin = request.headers.get('origin');
  if (origin && !allowedOrigins(env).includes(origin)) return fail(request, env, 403, 'kyc_origin_forbidden');
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (!(await rateAllowed(env, `confirm:${ip}`, now))) return fail(request, env, 429, 'kyc_rate_limited');
  const material = await signingMaterial(env);
  if (!material || !env.VOLTEX_API_ORIGIN) return fail(request, env, 503, 'kyc_edge_not_configured');
  if (Number(request.headers.get('content-length') || '0') > 16_384) return fail(request, env, 413, 'kyc_bad_request');
  let body;
  try { body = await request.json(); } catch { return fail(request, env, 400, 'kyc_bad_request'); }
  const sealed = await openReceipt(material, body?.receipt);
  if (!sealed || sealed.v !== 1 || typeof sealed.exp !== 'number' || sealed.exp < now || !sealed.confirm) {
    return fail(request, env, 400, 'kyc_receipt_invalid');
  }
  const result = await confirmWithRender(env, deps, material, sealed.confirm);
  if (!result.ok) return fail(request, env, 503, 'kyc_service_unavailable');
  log('confirmed_receipt', { submissionId: sealed.confirm.submissionId });
  // Old pre-notification receipts remain valid; no extra identity lookup.
  if (sealed.notification) queueKycNotification(env, ctx, sealed.notification, result.result);
  return json(request, env, 200, { status: 'PENDING', submissionId: sealed.confirm.submissionId, confirmed: true });
}

/**
 * deps: { sendEmail(from, to, rawBytes) → Promise, fetch, cache?, now() }
 */
export async function handle(request, env, ctx, deps) {
  const url = new URL(request.url);
  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'cache-control': 'no-store', ...corsHeaders(request, env) } });
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      const material = await signingMaterial(env);
      return json(request, env, 200, { ok: true, service: SERVICE, version: VERSION, configured: !!material && !!deps.sendEmail });
    }
    if (request.method === 'GET' && url.pathname === '/v1/public-key') {
      const material = await signingMaterial(env);
      if (!material) return fail(request, env, 503, 'kyc_edge_not_configured');
      return json(request, env, 200, { alg: 'Ed25519', key: material.publicJwk });
    }
    if (request.method === 'POST' && url.pathname === '/v1/submit') return await handleSubmit(request, env, ctx, deps);
    if (request.method === 'POST' && url.pathname === '/v1/confirm') return await handleConfirm(request, env, ctx, deps);
    return fail(request, env, 404, 'not_found');
  } catch (err) {
    log('unhandled', { path: url.pathname, name: String(err?.name || 'Error').slice(0, 40) });
    return fail(request, env, 500, 'kyc_edge_error');
  }
}
