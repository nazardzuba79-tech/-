// Contract tests for the KYC edge. Run: node --test test.mjs
// Synthetic bytes only — no real document, name or date of birth.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify as nodeVerify, webcrypto } from 'node:crypto';
import {
  handle, sniffDocument, buildKycMime, encodeHeaderWords, kycSubject, base64Lines,
  KYC_RECIPIENT, MAX_DOCUMENT_BYTES, VERSION,
} from './src/core.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 2, 3, 4, 5]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const PDF = new TextEncoder().encode('%PDF-1.4\n% synthetic test document\n%%EOF\n');
const SYNTHETIC_NAME = 'Test Synthetic Person';
const SYNTHETIC_DOB = '1991-02-03';
const USER_EMAIL = 'qa-synthetic@example.test';
const SUBMISSION = '0b8f3c7e-1d2a-4f5b-9c6d-7e8f9a0b1c2d';
const TOKEN = 'Bearer eyJhbGciOiJIUzI1NiJ9.synthetic-session-token.signature';

const { privateKey } = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const JWK = await webcrypto.subtle.exportKey('jwk', privateKey);

function envFor(extra = {}) {
  return {
    KYC_EDGE_SIGNING_JWK: JSON.stringify(JWK),
    VOLTEX_API_ORIGIN: 'https://api.example.test',
    ALLOWED_ORIGINS: 'https://voltextech.net,https://localhost',
    ...extra,
  };
}

function uuid() { return webcrypto.randomUUID(); }

function harness({ authorize, confirm, send, cache = true } = {}) {
  const calls = { authorize: [], confirm: [], sent: [] };
  const store = new Map();
  const deps = {
    now: () => Date.parse('2026-09-26T12:00:00Z'),
    cache: cache ? {
      match: async (req) => (store.has(req.url) ? new Response(store.get(req.url)) : undefined),
      put: async (req, res) => { store.set(req.url, await res.text()); },
    } : null,
    sendEmail: async (from, to, raw) => {
      calls.sent.push({ from, to, raw: new TextDecoder().decode(raw) });
      if (send) return send(calls.sent.length);
      return undefined;
    },
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      const body = JSON.parse(init.body);
      const entry = { path, body, headers: init.headers, rawBody: init.body };
      if (path.endsWith('/internal/kyc/authorize')) {
        calls.authorize.push(entry);
        const r = authorize ? authorize(entry, calls) : { status: 200, data: { submissionId: SUBMISSION, userId: 'user-1', email: USER_EMAIL, alreadySubmitted: false } };
        return new Response(JSON.stringify(r.data ?? {}), { status: r.status });
      }
      if (path.endsWith('/internal/kyc/submission-confirmed')) {
        calls.confirm.push(entry);
        const r = confirm ? confirm(entry, calls) : { status: 201, data: { status: 'created' } };
        if (r === 'throw') throw new TypeError('network down');
        return new Response(JSON.stringify(r.data ?? {}), { status: r.status });
      }
      throw new Error(`unexpected fetch ${url}`);
    },
  };
  return { deps, calls, store };
}

function submitRequest({ bytes = JPEG, type = 'image/jpeg', fields = {}, auth = TOKEN, origin = 'https://voltextech.net', omit = [] } = {}) {
  const form = new FormData();
  const values = { requestId: fields.requestId ?? REQ, country: 'UA', fullName: SYNTHETIC_NAME, dateOfBirth: SYNTHETIC_DOB, documentType: 'PASSPORT', email: 'attacker@evil.test', to: 'attacker@evil.test', ...fields };
  for (const [k, v] of Object.entries(values)) if (!omit.includes(k)) form.append(k, v);
  if (!omit.includes('document')) form.append('document', new Blob([bytes], { type }), 'passport-AB123456.jpg');
  const probe = new Request('https://kyc.example.test/v1/submit', { method: 'POST', body: form });
  const headers = new Headers(probe.headers);
  return probe.arrayBuffer().then((buf) => {
    headers.set('content-length', String(buf.byteLength));
    if (auth) headers.set('authorization', auth);
    if (origin) headers.set('origin', origin);
    headers.set('cf-connecting-ip', `198.51.100.${Math.floor(Math.random() * 250)}`);
    return new Request('https://kyc.example.test/v1/submit', { method: 'POST', headers, body: buf });
  });
}

let REQ = uuid();
const ctx = { waitUntil: () => {} };

test('Telegram receives existing identity only AFTER email and confirmation; no extra Render reads', async () => {
  const h = harness(); const events = []; const tasks = [];
  const env = envFor({ NOTIFICATIONS: { notify: async event => {
    assert.equal(h.calls.sent.length, 1); assert.equal(h.calls.confirm.length, 1);
    events.push(event); return { status: 'SENT' };
  } } });
  const response = await handle(await submitRequest(), env, { waitUntil: p => tasks.push(p) }, h.deps);
  await Promise.all(tasks);
  assert.equal(response.status, 201); assert.equal(events.length, 1);
  assert.equal(events[0].email, USER_EMAIL); assert.equal(events[0].eventType, 'KYC_SUBMITTED');
  assert.equal(h.calls.authorize.length, 1); assert.equal(h.calls.confirm.length, 1);
  assert.deepEqual(Object.keys(events[0]).sort(), ['documentType', 'email', 'eventId', 'eventType', 'fullName', 'timestamp']);
});
test('Telegram failure cannot break successful KYC; ignored/non-submitted KYC emits nothing', async () => {
  const tasks = []; let calls = 0;
  const env = envFor({ NOTIFICATIONS: { notify: async () => { calls++; throw new Error('synthetic outage'); } } });
  let h = harness();
  assert.equal((await handle(await submitRequest(), env, { waitUntil: p => tasks.push(p) }, h.deps)).status, 201);
  await Promise.all(tasks); assert.equal(calls, 1);
  h = harness({ confirm: () => ({ status: 200, data: { status: 'ignored_approved' } }) });
  await handle(await submitRequest(), env, ctx, h.deps); assert.equal(calls, 1);
  h = harness({ send: () => { throw new Error('email rejected'); } });
  assert.equal((await handle(await submitRequest(), env, ctx, h.deps)).status, 502); assert.equal(calls, 1);
});

test('sniffs JPEG, PNG, PDF and rejects everything else', () => {
  assert.equal(sniffDocument(JPEG), 'image/jpeg');
  assert.equal(sniffDocument(PNG), 'image/png');
  assert.equal(sniffDocument(PDF), 'application/pdf');
  assert.equal(sniffDocument(new TextEncoder().encode('<html>')), null);
  assert.equal(sniffDocument(new Uint8Array(0)), null);
});

for (const [label, bytes, type, ext] of [['JPEG', JPEG, 'image/jpeg', 'jpg'], ['PNG', PNG, 'image/png', 'png'], ['PDF', PDF, 'application/pdf', 'pdf']]) {
  test(`valid ${label}: one email to the fixed recipient, then one signed confirm`, async () => {
    REQ = uuid();
    const h = harness();
    const res = await handle(await submitRequest({ bytes, type }), envFor(), ctx, h.deps);
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.deepEqual(body, { status: 'PENDING', submissionId: SUBMISSION, confirmed: true });
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://voltextech.net');
    assert.equal(h.calls.sent.length, 1);
    const mail = h.calls.sent[0];
    assert.equal(mail.to, KYC_RECIPIENT);
    assert.equal(mail.from, 'kyc@voltextech.net');
    assert.match(mail.raw, /^To: <voltex\.crypto@gmail\.com>\r$/m);
    assert.doesNotMatch(mail.raw, /evil\.test/);
    assert.match(mail.raw, new RegExp(`filename="kyc-${SUBMISSION}\\.${ext}"`));
    assert.doesNotMatch(mail.raw, /AB123456/, 'the browser file name never reaches the email');
    assert.match(mail.raw, new RegExp(`Message-ID: <${SUBMISSION}@voltextech\\.net>`));
    // authorize before email, confirm after it
    assert.equal(h.calls.authorize.length, 1);
    assert.equal(h.calls.confirm.length, 1);
    const auth = h.calls.authorize[0];
    assert.equal(auth.headers.authorization, TOKEN);
    assert.equal(auth.body.documentMimeType, type);
    assert.equal('email' in auth.body, false, 'browser email is not forwarded');
    const confirm = h.calls.confirm[0].body;
    assert.equal(confirm.submissionId, SUBMISSION);
    assert.equal(confirm.userId, 'user-1');
    assert.equal(confirm.emailMessageId, `${SUBMISSION}@voltextech.net`);
    assert.equal(confirm.documentSizeBytes, bytes.length);
    assert.equal('document' in confirm, false);
    assert.ok(JSON.stringify(confirm).length < 1024, 'metadata callback stays tiny');
    assert.equal(h.calls.confirm[0].headers.authorization, undefined, 'confirm carries no user token');
  });
}

test('records the Message-ID the provider reports (the platform may replace ours)', async () => {
  REQ = uuid();
  const h = harness({ send: () => ({ messageId: '<Pl4tf0rmAssigned123@voltextech.net>' }) });
  const res = await handle(await submitRequest(), envFor(), ctx, h.deps);
  assert.equal(res.status, 201);
  assert.equal(h.calls.confirm[0].body.emailMessageId, 'Pl4tf0rmAssigned123@voltextech.net');
  const bogus = harness({ send: () => ({ messageId: 'not a message id' }) });
  REQ = uuid();
  await handle(await submitRequest(), envFor(), ctx, bogus.deps);
  assert.equal(bogus.calls.confirm[0].body.emailMessageId, `${SUBMISSION}@voltextech.net`, 'falls back to our own id');
});
test('the confirm signature verifies with the published public key', async () => {
  REQ = uuid();
  const h = harness();
  await handle(await submitRequest(), envFor(), ctx, h.deps);
  const keyRes = await handle(new Request('https://kyc.example.test/v1/public-key'), envFor(), ctx, h.deps);
  const { key } = await keyRes.json();
  assert.equal(key.d, undefined, 'private part never published');
  const pub = createPublicKey({ key, format: 'jwk' });
  const c = h.calls.confirm[0];
  const message = `v1\n${c.headers['x-voltex-kyc-edge-ts']}\n/api/v1/internal/kyc/submission-confirmed\n${c.rawBody}`;
  const sig = Buffer.from(c.headers['x-voltex-kyc-edge-sig'], 'base64url');
  assert.equal(nodeVerify(null, Buffer.from(message), pub, sig), true);
  assert.equal(nodeVerify(null, Buffer.from(message + 'x'), pub, sig), false);
});

test('oversized file → 413 before Render or email', async () => {
  REQ = uuid();
  const h = harness();
  const big = new Uint8Array(MAX_DOCUMENT_BYTES + 1); big.set(JPEG);
  const res = await handle(await submitRequest({ bytes: big }), envFor(), ctx, h.deps);
  assert.equal(res.status, 413);
  assert.equal(h.calls.authorize.length + h.calls.sent.length + h.calls.confirm.length, 0);
});

test('wrong MIME → 415', async () => {
  const h = harness();
  const res = await handle(await submitRequest({ bytes: new TextEncoder().encode('hello'), type: 'text/plain' }), envFor(), ctx, h.deps);
  assert.equal(res.status, 415);
  assert.equal((await res.json()).code, 'kyc_file_type');
  assert.equal(h.calls.sent.length, 0);
});

test('fake MIME / bad magic bytes → 415, nothing sent', async () => {
  const h = harness();
  const html = await handle(await submitRequest({ bytes: new TextEncoder().encode('<svg onload=alert(1)>'), type: 'image/png' }), envFor(), ctx, h.deps);
  assert.equal(html.status, 415);
  assert.equal((await html.json()).code, 'kyc_file_type');
  const mismatch = await handle(await submitRequest({ bytes: JPEG, type: 'application/pdf' }), envFor(), ctx, h.deps);
  assert.equal(mismatch.status, 415);
  assert.equal((await mismatch.json()).code, 'kyc_file_mismatch');
  assert.equal(h.calls.authorize.length + h.calls.sent.length, 0);
});

test('unauthenticated → 401, no Render call, no email', async () => {
  const h = harness();
  const res = await handle(await submitRequest({ auth: null }), envFor(), ctx, h.deps);
  assert.equal(res.status, 401);
  assert.equal(h.calls.authorize.length + h.calls.sent.length, 0);
});

test('revoked session (Render 401) → 401, no email', async () => {
  const h = harness({ authorize: () => ({ status: 401, data: { error: 'Session has been signed out' } }) });
  const res = await handle(await submitRequest(), envFor(), ctx, h.deps);
  assert.equal(res.status, 401);
  assert.equal(h.calls.sent.length, 0);
});

test('already pending / already approved → 409, no email', async () => {
  for (const code of ['kyc_already_pending', 'kyc_already_verified']) {
    const h = harness({ authorize: () => ({ status: 409, data: { code } }) });
    const res = await handle(await submitRequest(), envFor(), ctx, h.deps);
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, code);
    assert.equal(h.calls.sent.length + h.calls.confirm.length, 0);
  }
});

test('invalid fields → 400 before Render', async () => {
  const h = harness();
  for (const fields of [{ country: 'ukraine' }, { dateOfBirth: '2999-01-01' }, { dateOfBirth: '1990-02-31' }, { documentType: 'SELFIE' }, { fullName: '   ' }, { requestId: 'not-a-uuid' }]) {
    const res = await handle(await submitRequest({ fields }), envFor(), ctx, h.deps);
    assert.equal(res.status, 400, JSON.stringify(fields));
  }
  const noFile = await handle(await submitRequest({ omit: ['document'] }), envFor(), ctx, h.deps);
  assert.equal(noFile.status, 400);
  assert.equal(h.calls.authorize.length, 0);
});

test('email provider rejects → 502, no confirm (no Neon row)', async () => {
  REQ = uuid();
  const h = harness({ send: () => { throw Object.assign(new Error('rejected'), { code: 'E_RECIPIENT_NOT_ALLOWED' }); } });
  const res = await handle(await submitRequest(), envFor(), ctx, h.deps);
  assert.equal(res.status, 502);
  assert.equal((await res.json()).code, 'kyc_email_failed');
  assert.equal(h.calls.confirm.length, 0);
});

test('Render down on authorize → 503, no email', async () => {
  const h = harness({ authorize: () => ({ status: 502, data: {} }) });
  const res = await handle(await submitRequest(), envFor(), ctx, h.deps);
  assert.equal(res.status, 503);
  assert.equal(h.calls.sent.length, 0);
});

test('metadata callback fails after email accepted → 202 + sealed receipt; receipt retry confirms without the document', async () => {
  REQ = uuid();
  let down = true;
  const h = harness({ confirm: () => (down ? 'throw' : { status: 201, data: { status: 'created' } }) });
  const waits = [];
  const notifications = [];
  const env = envFor({ NOTIFICATIONS: { notify: async event => { notifications.push(event); return { status: 'SENT' }; } } });
  const res = await handle(await submitRequest(), env, { waitUntil: (p) => waits.push(p) }, h.deps);
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.confirmed, false);
  assert.equal(typeof body.receipt, 'string');
  assert.doesNotMatch(body.receipt, /Synthetic|1991/, 'receipt is sealed, not readable');
  assert.equal(h.calls.sent.length, 1);
  assert.equal(waits.length, 1, 'a short background retry is scheduled');
  assert.equal(notifications.length, 0, 'no event before successful confirmation');

  down = false;
  const retry = await handle(new Request('https://kyc.example.test/v1/confirm', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://voltextech.net', 'content-length': '10' },
    body: JSON.stringify({ receipt: body.receipt }),
  }), env, ctx, h.deps);
  assert.equal(retry.status, 200);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].email, USER_EMAIL, 'authenticated identity preserved in sealed receipt, no lookup');
  assert.equal((await retry.json()).submissionId, SUBMISSION);
  assert.equal(h.calls.sent.length, 1, 'no second email');
  assert.equal(h.calls.confirm.at(-1).body.submissionId, SUBMISSION);

  const tampered = body.receipt.slice(0, -4) + (body.receipt.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  const bad = await handle(new Request('https://kyc.example.test/v1/confirm', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ receipt: tampered }),
  }), envFor(), ctx, h.deps);
  assert.equal(bad.status, 400);
});

test('double click (concurrent, same requestId) → one email', async () => {
  REQ = uuid();
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = harness({ send: () => gate });
  const a = handle(await submitRequest(), envFor(), ctx, h.deps);
  const b = handle(await submitRequest(), envFor(), ctx, h.deps);
  await new Promise((r) => setTimeout(r, 20));
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.status, 201);
  assert.equal(rb.status, 201);
  assert.equal(h.calls.sent.length, 1);
});

test('browser retry after the email was accepted → no second email', async () => {
  REQ = uuid();
  let fails = 1;
  const h = harness({ confirm: () => (fails-- > 0 ? { status: 503, data: {} } : { status: 200, data: { status: 'exists' } }) });
  const first = await handle(await submitRequest(), envFor(), ctx, h.deps);
  assert.equal(first.status, 202);
  const second = await handle(await submitRequest(), envFor(), ctx, h.deps);
  assert.equal(second.status, 201);
  assert.equal(h.calls.sent.length, 1);
});

test('retry after Render already recorded it (alreadySubmitted) → no email', async () => {
  const h = harness({ authorize: () => ({ status: 200, data: { submissionId: SUBMISSION, userId: 'user-1', email: USER_EMAIL, alreadySubmitted: true } }) });
  const res = await handle(await submitRequest(), envFor(), ctx, h.deps);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).duplicate, true);
  assert.equal(h.calls.sent.length, 0);
});

test('foreign origin → 403; CORS preflight answers only allowed origins', async () => {
  const h = harness();
  const res = await handle(await submitRequest({ origin: 'https://evil.test' }), envFor(), ctx, h.deps);
  assert.equal(res.status, 403);
  const ok = await handle(new Request('https://kyc.example.test/v1/submit', { method: 'OPTIONS', headers: { origin: 'https://voltextech.net' } }), envFor(), ctx, h.deps);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://voltextech.net');
  const no = await handle(new Request('https://kyc.example.test/v1/submit', { method: 'OPTIONS', headers: { origin: 'https://evil.test' } }), envFor(), ctx, h.deps);
  assert.equal(no.headers.get('access-control-allow-origin'), null);
});

test('rate limit binding refusal → 429 before Render', async () => {
  const h = harness();
  const res = await handle(await submitRequest(), envFor({ KYC_RATE_LIMIT: { limit: async () => ({ success: false }) } }), ctx, h.deps);
  assert.equal(res.status, 429);
  assert.equal(h.calls.authorize.length, 0);
});

test('missing signing key → 503 not configured; health reports it', async () => {
  const h = harness();
  const res = await handle(await submitRequest(), envFor({ KYC_EDGE_SIGNING_JWK: undefined }), ctx, h.deps);
  assert.equal(res.status, 503);
  const health = await (await handle(new Request('https://kyc.example.test/health'), envFor({ KYC_EDGE_SIGNING_JWK: undefined }), ctx, h.deps)).json();
  assert.deepEqual(health, { ok: true, service: 'voltex-kyc-edge', version: VERSION, configured: false });
});

test('unknown routes → 404, GET submit → 404', async () => {
  const h = harness();
  assert.equal((await handle(new Request('https://kyc.example.test/v1/submit'), envFor(), ctx, h.deps)).status, 404);
  assert.equal((await handle(new Request('https://kyc.example.test/upload/abc'), envFor(), ctx, h.deps)).status, 404);
});

test('logs carry identifiers only — no name, DOB, email or document bytes', async () => {
  REQ = uuid();
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    const h = harness({ confirm: () => ({ status: 503, data: {} }) });
    await handle(await submitRequest(), envFor(), ctx, h.deps);
    const bad = harness({ send: () => { throw new Error(`relay said no for ${SYNTHETIC_NAME}`); } });
    REQ = uuid();
    await handle(await submitRequest(), envFor(), ctx, bad.deps);
  } finally {
    console.log = orig;
  }
  const all = lines.join('\n');
  assert.ok(lines.length >= 2);
  for (const secret of [SYNTHETIC_NAME, SYNTHETIC_DOB, USER_EMAIL, '/9j/']) assert.equal(all.includes(secret), false, secret);
});

test('header injection through the name cannot add headers', () => {
  const subject = kycSubject('Evil\r\nBcc: x@evil.test', USER_EMAIL);
  const encoded = encodeHeaderWords(subject);
  assert.doesNotMatch(encoded, /\r\n(?! )/);
  assert.doesNotMatch(encoded, /Bcc:/);
  for (const line of encoded.split('\r\n')) assert.ok(line.length <= 76, line);
});

test('MIME: 76-char base64 lines and a 4 MB build stays cheap', () => {
  const lines = new TextDecoder().decode(base64Lines(new Uint8Array(1000))).split('\r\n').filter(Boolean);
  assert.ok(lines.every((l) => l.length <= 76));
  const big = new Uint8Array(MAX_DOCUMENT_BYTES); big.set(JPEG);
  const t = performance.now();
  const raw = buildKycMime({
    from: 'kyc@voltextech.net', to: KYC_RECIPIENT, submissionId: SUBMISSION, messageId: `${SUBMISSION}@voltextech.net`,
    subject: kycSubject(SYNTHETIC_NAME, USER_EMAIL), text: 'synthetic', document: { bytes: big, mime: 'image/jpeg', size: big.length },
    date: new Date('2026-09-26T12:00:00Z'), boundary: 'b',
  });
  const ms = performance.now() - t;
  console.error(`# mime build 4 MB: ${ms.toFixed(1)} ms (Node; informational)`);
  assert.ok(raw.length < 6 * 1024 * 1024, 'fits the 25 MiB verified-destination limit with a wide margin');
});
