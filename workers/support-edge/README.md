# voltex-support-edge

Cloudflare Worker (Workers Free) behind the site's Support form.

```
Browser → POST https://support.voltextech.net/v1/support
        → env.SUPPORT_EMAIL.send()  (Cloudflare Email Routing)
        → voltex.crypto@gmail.com   (Reply-To: the user's address)
```

One submission = one request = one email. Nothing is stored, nothing is
polled, no timers or cron; Render and Neon are never contacted. The owner
answers with Gmail's Reply, which goes straight to the user.

## Contract

`POST /v1/support`, JSON `{ name, email, subject, message, website }`:

| Result | Status | Body |
|---|---|---|
| provider accepted | 200 | `{ ok: true }` |
| invalid field / honeypot | 400 | `{ ok: false, error: "invalid", fields }` |
| foreign or missing Origin | 403 | `origin_not_allowed` |
| body over 16 KiB | 413 | `too_large` |
| not JSON | 415 | `unsupported_media_type` |
| rate limited | 429 | `rate_limited` |
| provider refused | 502 | `delivery_failed` |
| binding/addresses missing | 503 | `not_configured` |

`GET /health` → `{ ok, service, version, configured }` (no addresses).

## Security

- Recipient only from `SUPPORT_ADMIN_EMAIL` in `wrangler.toml`, and the
  `send_email` binding is locked to that `destination_address`.
- Users set only name, email, subject (one of four) and message; `to`,
  `from`, `cc`, `bcc`, `headers` in the body are ignored.
- CR/LF and other control characters are rejected in name and email;
  the message keeps line breaks and is sent as text/plain only.
- Limits: name 100, email 254, message 2000, body 16 KiB; honeypot field;
  per-IP limit (Cloudflare rate-limit binding, 3/min) plus a per-isolate
  window (5 per 10 min); allowed Origins only.
- Logs carry the result and error code only — never the name, address or text.

## Prerequisite (one-time, Cloudflare dashboard)

Sending to a verified destination address is free on every plan, but the
address must be verified: **Email → Email Routing → Destination addresses**
must list `voltex.crypto@gmail.com` as *Verified* (Cloudflare sends a
confirmation link to that inbox). Until then the provider refuses and the
form says so (502 → «Не удалось отправить сообщение…»).

## Deploy

Workflow `.github/workflows/support-form.yml` (secret `CLOUDFLARE_API_TOKEN`):
verify on every PR; deploy on a push to `main` that touches this folder, on
a push whose commit message contains `[deploy-support-edge]`, or manually.

Local tests: `node workers/support-edge/test.mjs`.
