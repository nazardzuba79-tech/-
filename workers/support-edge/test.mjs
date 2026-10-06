// Contract tests for voltex-support-edge. Run: node test.mjs
// The Worker is plain JS with no Cloudflare-only imports, so it runs here
// against a recorded email binding and a counting rate limiter.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker, { LIMITS, MAX_BODY_BYTES, WINDOW_MAX, resetMemoryLimiter, composeText } from "./src/index.js";

const ORIGIN = "https://voltextech.net";
const ADMIN = "voltex.crypto@gmail.com";

function env(overrides = {}) {
  // Each case is a fresh visitor for the per-isolate window.
  resetMemoryLimiter();
  const sent = [];
  let limiterCalls = 0;
  const base = {
    SUPPORT_ADMIN_EMAIL: ADMIN,
    SUPPORT_FROM_EMAIL: "support-form@voltextech.net",
    ALLOWED_ORIGINS: "https://voltextech.net,https://www.voltextech.net",
    SUPPORT_EMAIL: { send: async (message) => { sent.push(message); return { messageId: "m-1" }; } },
    SUPPORT_RATE_LIMIT: { limit: async () => { limiterCalls++; return { success: true }; } },
  };
  const e = { ...base, ...overrides };
  return { env: e, sent, limiterCalls: () => limiterCalls };
}

const valid = { name: "VOLTEX Support QA", email: "qa-support@example.invalid", subject: "TECHNICAL", message: "Production support form test. No action required." };

function post(body, { origin = ORIGIN, type = "application/json", ip = "203.0.113.7", raw } = {}) {
  const headers = { "content-type": type, "cf-connecting-ip": ip };
  if (origin) headers.origin = origin;
  return new Request("https://support.voltextech.net/v1/support", { method: "POST", headers, body: raw ?? JSON.stringify(body) });
}

async function call(req, e) {
  const res = await worker.fetch(req, e);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

const logs = [];
const realLog = console.log;
console.log = (...args) => { logs.push(args.join(" ")); };

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("valid guest submission → 200, exactly one email", async () => {
  const t = env();
  const r = await call(post(valid), t.env);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  assert.equal(t.sent.length, 1);
  assert.equal(r.headers.get("access-control-allow-origin"), ORIGIN);
});

test("recipient is always SUPPORT_ADMIN_EMAIL; Reply-To is the validated user address", async () => {
  const t = env();
  await call(post({ ...valid, email: "  User@Example.com " }), t.env);
  const m = t.sent[0];
  assert.equal(m.to, ADMIN);
  assert.equal(m.replyTo, "User@Example.com");
  assert.deepEqual(m.from, { email: "support-form@voltextech.net", name: "VOLTEX Support" });
  assert.equal(m.html, undefined, "text/plain only");
});

test("the user cannot choose the recipient, sender or extra headers", async () => {
  const t = env();
  const r = await call(post({ ...valid, to: "attacker@evil.test", from: "ceo@voltextech.net", replyTo: "x@evil.test",
    cc: "a@evil.test", bcc: "b@evil.test", headers: { Bcc: "c@evil.test" } }), t.env);
  assert.equal(r.status, 200);
  const m = t.sent[0];
  assert.equal(m.to, ADMIN);
  assert.equal(m.replyTo, valid.email);
  assert.equal(m.from.email, "support-form@voltextech.net");
  assert.equal(m.cc, undefined);
  assert.equal(m.bcc, undefined);
  assert.equal(m.headers, undefined);
  assert.ok(!JSON.stringify(m).includes("evil.test"));
});

test("body has the owner's layout: name, email, subject label, message, date", async () => {
  const text = composeText({ ...valid, message: "Line 1\nLine 2" }, Date.parse("2026-09-26T15:40:12.345Z"));
  assert.equal(text, [
    "VOLTEX Support", "", "Имя:", "VOLTEX Support QA", "", "Email:", "qa-support@example.invalid", "",
    "Тема:", "Техническая проблема", "", "Сообщение:", "Line 1\nLine 2", "", "Дата:", "2026-09-26 15:40 UTC", "",
  ].join("\n"));
  const t = env();
  await call(post({ ...valid, subject: "CARD" }), t.env);
  assert.equal(t.sent[0].subject, "VOLTEX Support — Вопрос по карте — VOLTEX Support QA");
});

test("invalid email is rejected, nothing sent", async () => {
  for (const email of ["", "no-at-sign", "a@b", "a b@example.com", "a@example.com, b@example.com", "<a@example.com>", "a@-example.com", "x".repeat(250) + "@example.com"]) {
    const t = env();
    const r = await call(post({ ...valid, email }), t.env);
    assert.equal(r.status, 400, email);
    assert.deepEqual(r.body.fields, ["email"], email);
    assert.equal(t.sent.length, 0);
  }
});

test("empty or whitespace message is rejected", async () => {
  for (const message of ["", "   \n\t  ", undefined, 42]) {
    const t = env();
    const r = await call(post({ ...valid, message }), t.env);
    assert.equal(r.status, 400);
    assert.deepEqual(r.body.fields, ["message"]);
    assert.equal(t.sent.length, 0);
  }
});

test("oversized message and oversized body are rejected", async () => {
  let t = env();
  let r = await call(post({ ...valid, message: "x".repeat(LIMITS.message + 1) }), t.env);
  assert.equal(r.status, 400);
  assert.deepEqual(r.body.fields, ["message"]);
  t = env();
  r = await call(post({ ...valid, message: "x".repeat(LIMITS.message) }), t.env);
  assert.equal(r.status, 200);
  t = env();
  r = await call(post(null, { raw: JSON.stringify({ ...valid, pad: "y".repeat(MAX_BODY_BYTES) }) }), t.env);
  assert.equal(r.status, 413);
  assert.equal(t.sent.length, 0);
  t = env();
  r = await call(post({ ...valid, name: "n".repeat(LIMITS.name + 1) }), t.env);
  assert.equal(r.status, 400);
  assert.deepEqual(r.body.fields, ["name"]);
});

test("subject must be one of the four", async () => {
  for (const subject of ["", "technical", "SALES", "__proto__", "toString", null]) {
    const t = env();
    const r = await call(post({ ...valid, subject }), t.env);
    assert.equal(r.status, 400, String(subject));
    assert.deepEqual(r.body.fields, ["subject"]);
    assert.equal(t.sent.length, 0);
  }
});

test("header injection through name or email is rejected", async () => {
  const cases = [
    { name: "Ivan\r\nBcc: victim@example.com" },
    { name: "Ivan\nSubject: hi" },
    { name: "Ivan\u2028X" },
    { email: "a@example.com\r\nBcc: victim@example.com" },
    { email: "a@example.com\nX: y" },
  ];
  for (const c of cases) {
    const t = env();
    const r = await call(post({ ...valid, ...c }), t.env);
    assert.equal(r.status, 400, JSON.stringify(c));
    assert.equal(t.sent.length, 0);
  }
});

test("message keeps line breaks but loses other control characters; HTML stays inert text", async () => {
  const t = env();
  await call(post({ ...valid, message: "Hi\r\nthere\u0000\u0007 <script>alert(1)</script>" }), t.env);
  const text = t.sent[0].text;
  assert.ok(text.includes("Hi\nthere <script>alert(1)</script>"));
  assert.ok(!/[\u0000\u0007\r]/.test(text));
  assert.equal(t.sent[0].html, undefined);
});

test("honeypot filled → rejected, nothing sent", async () => {
  const t = env();
  const r = await call(post({ ...valid, website: "http://spam.test" }), t.env);
  assert.equal(r.status, 400);
  assert.equal(t.sent.length, 0);
});

test("rate limit: the Cloudflare binding says no → 429, nothing sent", async () => {
  const t = env({ SUPPORT_RATE_LIMIT: { limit: async () => ({ success: false }) } });
  const r = await call(post(valid), t.env);
  assert.equal(r.status, 429);
  assert.equal(t.sent.length, 0);
});

test("rate limit: per-isolate window holds even without the binding", async () => {
  resetMemoryLimiter();
  const t = env({ SUPPORT_RATE_LIMIT: undefined });
  for (let i = 0; i < WINDOW_MAX; i++) assert.equal((await call(post(valid, { ip: "198.51.100.9" }), t.env)).status, 200);
  assert.equal((await call(post(valid, { ip: "198.51.100.9" }), t.env)).status, 429);
  // Another visitor is not affected.
  assert.equal((await call(post(valid, { ip: "198.51.100.10" }), t.env)).status, 200);
  assert.equal(t.sent.length, WINDOW_MAX + 1);
  resetMemoryLimiter();
});

test("provider accepts → 200; provider rejects → 502 and never ok:true", async () => {
  const failing = env({ SUPPORT_EMAIL: { send: async () => { const e = new Error("Recipient not allowed"); e.code = "E_RECIPIENT_NOT_ALLOWED"; throw e; } } });
  const r = await call(post(valid, { ip: "192.0.2.50" }), failing.env);
  assert.equal(r.status, 502);
  assert.deepEqual(r.body, { ok: false, error: "delivery_failed", code: "E_RECIPIENT_NOT_ALLOWED" });
  const odd = env({ SUPPORT_EMAIL: { send: async () => { throw Object.assign(new Error("x"), { code: "bad code with user@example.com" }); } } });
  const r2 = await call(post(valid, { ip: "192.0.2.52" }), odd.env);
  assert.deepEqual(r2.body, { ok: false, error: "delivery_failed", code: "UNKNOWN" });
});

test("not configured → 503, and nothing pretends to work", async () => {
  for (const o of [{ SUPPORT_EMAIL: undefined }, { SUPPORT_ADMIN_EMAIL: "" }, { SUPPORT_FROM_EMAIL: undefined }]) {
    const t = env(o);
    const r = await call(post(valid, { ip: "192.0.2.51" }), t.env);
    assert.equal(r.status, 503);
    assert.equal(r.body.ok, false);
  }
});

test("browser origins: allowed origin preflight 204; foreign or missing origin refused", async () => {
  const t = env();
  const pre = await worker.fetch(new Request("https://support.voltextech.net/v1/support", { method: "OPTIONS", headers: { origin: ORIGIN } }), t.env);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(pre.headers.get("access-control-allow-methods"), "POST, OPTIONS");
  assert.equal((await call(post(valid, { origin: "https://evil.test" }), t.env)).status, 403);
  assert.equal((await call(post(valid, { origin: "" }), t.env)).status, 403);
  assert.equal((await call(post(valid, { type: "text/plain" }), t.env)).status, 415);
  assert.equal(t.sent.length, 0);
});

test("health says whether mail is configured, and nothing else", async () => {
  const r = await call(new Request("https://support.voltextech.net/health"), env().env);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ["configured", "ok", "service", "version"]);
  assert.equal(r.body.configured, true);
  assert.ok(!JSON.stringify(r.body).includes("@"));
  assert.equal((await call(new Request("https://support.voltextech.net/other"), env().env)).status, 404);
});

test("logs carry categories only — never the name, address or message", async () => {
  logs.length = 0;
  resetMemoryLimiter();
  const t = env();
  await call(post({ ...valid, message: "секрет пользователя 12345" }, { ip: "192.0.2.60" }), t.env);
  const failing = env({ SUPPORT_EMAIL: { send: async () => { throw Object.assign(new Error(`bad ${valid.email}`), { code: "E_X" }); } } });
  await call(post(valid, { ip: "192.0.2.61" }), failing.env);
  const all = logs.join("\n");
  assert.ok(all.includes('"result":"sent"'));
  assert.ok(all.includes('"code":"E_X"'));
  for (const secret of ["VOLTEX Support QA", "qa-support@example.invalid", "секрет пользователя", ADMIN]) assert.ok(!all.includes(secret), secret);
});

test("source: no timers, no storage, no calls to Render or Neon", () => {
  const src = readFileSync(new URL("./src/index.js", import.meta.url), "utf8");
  assert.ok(!/setInterval|setTimeout|scheduled\s*\(|\bcron\b/.test(src));
  // The only `fetch(` is the Worker's own handler: it calls nothing outbound.
  assert.deepEqual(src.match(/fetch\(/g), ["fetch("]);
  assert.match(src, /async fetch\(request, env\)/);
  assert.ok(!/onrender|neon\.tech|DATABASE_URL|KV|D1|R2/.test(src));
  const toml = readFileSync(new URL("./wrangler.toml", import.meta.url), "utf8");
  assert.match(toml, /destination_address = "voltex\.crypto@gmail\.com"/);
  assert.ok(!/\[triggers\]|crons/.test(toml));
});

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); realLog(`ok   ${name}`); } catch (e) { failed++; realLog(`FAIL ${name}\n     ${e.message}`); }
}
realLog(`${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
