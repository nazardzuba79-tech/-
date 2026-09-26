// VOLTEX support form edge — Cloudflare Worker.
//
// Browser → POST /v1/support → env.SUPPORT_EMAIL.send() → the owner's inbox.
// The owner answers from Gmail: Reply goes to the Reply-To, which is the
// validated address the user typed. Nothing is stored, nothing is polled,
// no timers are armed; Render and Neon are never contacted.

export const VERSION = "support-form-v1";
export const MAX_BODY_BYTES = 16 * 1024;
export const LIMITS = { name: 100, email: 254, message: 2000 };
export const SUBJECTS = {
  TECHNICAL: "Техническая проблема",
  KYC: "Вопрос по KYC",
  CARD: "Вопрос по карте",
  OTHER: "Другое",
};
// Per-isolate floor behind the Cloudflare rate-limit binding.
export const WINDOW_MS = 10 * 60 * 1000;
export const WINDOW_MAX = 5;

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
// Anything that could end a mail header or smuggle one in.
const HEADER_UNSAFE_RE = /[\u0000-\u001F\u007F\u0085\u2028\u2029]/;
// Message bodies keep line breaks and tabs; other control characters go.
const BODY_CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029]/g;

const BASE_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function json(body, status, cors) {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...cors } });
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean);
}

function corsFor(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

/** Validates the four user fields; returns the clean values or the names of the bad fields. */
export function validate(input) {
  const bad = [];
  const src = input && typeof input === "object" && !Array.isArray(input) ? input : {};

  const rawName = typeof src.name === "string" ? src.name : "";
  const name = rawName.trim().replace(/[  ]+/g, " ");
  if (!name || name.length > LIMITS.name || HEADER_UNSAFE_RE.test(rawName.trim())) bad.push("name");

  const rawEmail = typeof src.email === "string" ? src.email.trim() : "";
  if (!rawEmail || rawEmail.length > LIMITS.email || HEADER_UNSAFE_RE.test(rawEmail) || !EMAIL_RE.test(rawEmail)) bad.push("email");

  const subject = typeof src.subject === "string" && Object.prototype.hasOwnProperty.call(SUBJECTS, src.subject) ? src.subject : null;
  if (!subject) bad.push("subject");

  const rawMessage = typeof src.message === "string" ? src.message : "";
  const message = rawMessage.replace(/\r\n?/g, "\n").replace(BODY_CONTROL_RE, "").trim();
  if (!message || message.length > LIMITS.message) bad.push("message");

  if (bad.length) return { ok: false, fields: bad };
  return { ok: true, value: { name, email: rawEmail, subject, message } };
}

/** Plain-text body in the owner's requested layout. */
export function composeText(v, now) {
  const date = new Date(now).toISOString().replace("T", " ").replace(/:\d\d\.\d+Z$/, " UTC");
  return [
    "VOLTEX Support",
    "",
    "Имя:",
    v.name,
    "",
    "Email:",
    v.email,
    "",
    "Тема:",
    SUBJECTS[v.subject],
    "",
    "Сообщение:",
    v.message,
    "",
    "Дата:",
    date,
    "",
  ].join("\n");
}

export function composeEmail(env, v, now) {
  return {
    to: env.SUPPORT_ADMIN_EMAIL,
    from: { email: env.SUPPORT_FROM_EMAIL, name: "VOLTEX Support" },
    replyTo: v.email,
    subject: `VOLTEX Support — ${SUBJECTS[v.subject]} — ${v.name}`,
    text: composeText(v, now),
  };
}

const hits = new Map();

/** Best-effort per-isolate window; the Cloudflare binding is the shared limit. */
export function memoryLimited(key, now) {
  const recent = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= WINDOW_MAX) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {
    for (const [k, list] of hits) if (!list.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  }
  return false;
}

export function resetMemoryLimiter() {
  hits.clear();
}

async function limited(env, key, now) {
  if (env.SUPPORT_RATE_LIMIT && typeof env.SUPPORT_RATE_LIMIT.limit === "function") {
    try {
      const { success } = await env.SUPPORT_RATE_LIMIT.limit({ key });
      if (!success) return true;
    } catch {
      // The binding failing open is fine: the per-isolate window still applies.
    }
  }
  return memoryLimited(key, now);
}

function log(event) {
  // Categories only: never the name, the address or the message text.
  console.log(JSON.stringify({ service: "voltex-support-edge", ...event }));
}

export function configured(env) {
  return Boolean(
    env.SUPPORT_EMAIL && typeof env.SUPPORT_EMAIL.send === "function" &&
    typeof env.SUPPORT_ADMIN_EMAIL === "string" && EMAIL_RE.test(env.SUPPORT_ADMIN_EMAIL) &&
    typeof env.SUPPORT_FROM_EMAIL === "string" && EMAIL_RE.test(env.SUPPORT_FROM_EMAIL),
  );
}

async function readBody(request) {
  const declared = Number(request.headers.get("content-length") || "0");
  if (declared > MAX_BODY_BYTES) return { tooLarge: true };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return { tooLarge: true };
  try {
    return { data: JSON.parse(text) };
  } catch {
    return { data: null };
  }
}

export async function handleSupport(request, env, now = Date.now()) {
  const origin = request.headers.get("origin") || "";
  const allowed = origin !== "" && allowedOrigins(env).includes(origin);
  const cors = allowed ? corsFor(origin) : { vary: "Origin" };

  if (request.method === "OPTIONS") {
    return allowed ? new Response(null, { status: 204, headers: cors }) : new Response(null, { status: 403, headers: cors });
  }
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, cors);
  if (!allowed) return json({ ok: false, error: "origin_not_allowed" }, 403, cors);
  if (!String(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
    return json({ ok: false, error: "unsupported_media_type" }, 415, cors);
  }
  if (!configured(env)) {
    log({ result: "not_configured" });
    return json({ ok: false, error: "not_configured" }, 503, cors);
  }

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (await limited(env, ip, now)) {
    log({ result: "rate_limited" });
    return json({ ok: false, error: "rate_limited" }, 429, cors);
  }

  const body = await readBody(request);
  if (body.tooLarge) return json({ ok: false, error: "too_large" }, 413, cors);
  if (!body.data || typeof body.data !== "object") return json({ ok: false, error: "invalid", fields: [] }, 400, cors);
  // Honeypot: a field people never see. Anything in it is a bot.
  if (typeof body.data.website === "string" && body.data.website.trim() !== "") {
    log({ result: "honeypot" });
    return json({ ok: false, error: "invalid", fields: [] }, 400, cors);
  }

  const checked = validate(body.data);
  if (!checked.ok) return json({ ok: false, error: "invalid", fields: checked.fields }, 400, cors);

  try {
    await env.SUPPORT_EMAIL.send(composeEmail(env, checked.value, now));
  } catch (err) {
    const raw = err && typeof err.code === "string" ? err.code : "UNKNOWN";
    // The provider's error code (e.g. E_RECIPIENT_NOT_ALLOWED) says what to
    // fix; it carries no address or message text, so the caller may see it.
    const code = /^[A-Z0-9_]{1,40}$/.test(raw) ? raw : "UNKNOWN";
    log({ result: "failed", subject: checked.value.subject, code });
    return json({ ok: false, error: "delivery_failed", code }, 502, cors);
  }
  log({ result: "sent", subject: checked.value.subject });
  return json({ ok: true }, 200, cors);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      if (request.method !== "GET" && request.method !== "HEAD") return json({ ok: false, error: "method_not_allowed" }, 405, {});
      return json({ ok: true, service: "voltex-support-edge", version: VERSION, configured: configured(env) }, 200, {});
    }
    if (url.pathname === "/v1/support") return handleSupport(request, env);
    return json({ ok: false, error: "not_found" }, 404, {});
  },
};
