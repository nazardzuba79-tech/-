# voltex-kyc-edge

Cloudflare Worker (Workers Free) that receives a KYC document from the VOLTEX
verification form and emails it to the admin mailbox through Cloudflare
Email Routing. The VOLTEX API (Render) and Neon receive only small signed
metadata calls. The document is never stored anywhere of ours.

This is manual, lightweight KYC document handling. It is not a certified KYC
provider. Full design, failure cases and limits: [`docs/KYC_EDGE.md`](../../docs/KYC_EDGE.md).

## Routes

- `POST /v1/submit` — multipart: `requestId, country, fullName, dateOfBirth, documentType, document`; `Authorization: Bearer <VOLTEX session>`
- `POST /v1/confirm` — `{ receipt }`: retries only the metadata call after an accepted email
- `GET /v1/public-key` — Ed25519 public JWK that Render uses to verify this Worker
- `GET /health`

Everything else is 404. Every response is `Cache-Control: no-store`.

## Bindings / secrets

- `KYC_MAIL`: `send_email`, locked to `voltex.crypto@gmail.com` (must be a verified destination address)
- `KYC_EDGE_SIGNING_JWK` (secret): created once by the deploy workflow inside the runner
- `VOLTEX_API_ORIGIN`, `ALLOWED_ORIGINS` (vars)

## Test / deploy

```bash
node --test test.mjs
```

Deploy: `.github/workflows/deploy-kyc-edge.yml` (push to `main` touching this folder, or manual).
