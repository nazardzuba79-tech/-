# KYC documents: Cloudflare edge → admin email (Render/Neon keep metadata only)

**This is manual, lightweight KYC document handling — not a certified KYC
provider.** Nothing checks that a document is genuine, matches the person, or
screens sanctions lists. The admin mailbox (`voltex.crypto@gmail.com`) is where
documents are kept in this model. A Gmail inbox is not a licensed KYC vault.
This design makes no regulatory-compliance claim.

## Before (up to main `d55dbb18`)

```
Browser ──multipart, up to 8 MB──▶ Render POST /kyc/submit (multer)
                                   ├─ writes uploads/kyc/<uuid>.<ext> on Render's disk
                                   ├─ Neon: KycSubmission.documentImagePath = that path
                                   └─ KycEmailService reads the file back from disk → SMTP attachment
Admin ──GET /kyc/:id/document──▶ Render streams the file (a 2nd pass of the bytes)
```

Per submission, the document crossed Render up to three times: upload, SMTP
attachment, admin preview. It also sat on a disk that a redeploy wipes.

## After

```
Browser (Settings → Verification, same form)
  │ photo re-encoded in the browser: long edge ≤ 2400 px, JPEG q 0.85, EXIF/GPS dropped
  │ PDF sent as is; 4 MB cap for both
  ▼
Cloudflare Worker  kyc.voltextech.net  (workers/kyc-edge, Workers Free)
  1. Bearer token present, origin allow-listed, per-IP limits (Rate Limiting binding 5/min +
     isolate window 8/10 min), Content-Length ≤ 4 MB + form
  2. fields + size + declared MIME + magic bytes (JPEG FF D8 FF / PNG 89 50 4E 47… / PDF %PDF-)
  3. POST api/v1/internal/kyc/authorize  ── signed, carries the user's bearer ──▶ Render
        Render: session valid? APPROVED → 409; another PENDING → 409; per-user limit;
        submissionId = HMAC(userId, requestId) (server-decided, stable per attempt)
        writes NOTHING
  4. Email Routing `send_email` (binding locked to voltex.crypto@gmail.com)
        From kyc@voltextech.net; Subject «[KYC] Новая заявка — <ФИО> — <email>»
        body: email, name, country, DOB, type, user id, submission id, time
        attachment kyc-<submissionId>.<jpg|png|pdf>  (never the user's file name)
  5. only after the provider accepted it:
     POST api/v1/internal/kyc/submission-confirmed  ── signed, ~0.4 KB ──▶ Render
        one transaction, user row locked: create KycSubmission (id = submissionId,
        documentImagePath NULL, documentDelivery EMAIL, emailMessageId, mime, size),
        user.kycStatus = PENDING, audit KYC_SUBMITTED
Admin ─▶ /admin/kyc shows «Документ отправлен на email администратора» + Message-ID;
         no document request. «Проверено» → APPROVED, «Отклонить» (+ причина) → REJECTED.
```

The old `POST /kyc/submit` answers **410** (`kyc_upload_moved`) with no multer
and no disk write. `GET /kyc/:id/document` serves only legacy rows that still
have a file, and returns 404 `kyc_document_emailed` for new rows.

### Per real submission

| | Before | After |
|---|---|---|
| Render document ingress | up to 8 MB | **0** (2 JSON calls: ~0.2 KB + ~0.4 KB) |
| Render document egress (SMTP + admin preview) | 1–2 × file | **0** |
| Render disk writes | 1 file | **0** |
| Neon | row + file path | one metadata row (< 2 KB, no binary) |
| Cloudflare | — | 1 Worker request with the file |
| Email | 1 message (sent from Render) | 1 message + attachment (sent from Cloudflare) |
| Idle work | — | none: no polling, no timers; Render fetches the edge public key only when a signed call arrives (cached 10 min) |

## Trust and secrets

- **Edge → Render:** the Worker signs `v1\n<ts>\n<path>\n<body>` with an Ed25519
  key. The private key exists only as the Worker secret `KYC_EDGE_SIGNING_JWK`.
  The deploy workflow creates it once inside the CI runner and pipes it
  straight into `wrangler secret put`. It is never printed, committed, or
  given to Render.
- **Render** needs **no new secret**. It verifies signatures with the public key
  from `https://kyc.voltextech.net/v1/public-key`, fetched over HTTPS on
  demand and cached for 10 minutes. The owner may pin it instead with
  `KYC_EDGE_PUBLIC_KEY` (the JWK `x`); a pinned key is the only one accepted.
- The internal routes accept only the vendor content type
  `application/vnd.voltex.kyc-edge+json` with a valid signature (±5 min). A
  user or admin JWT alone cannot reach them. `authorize` also requires the
  user's own session, so the edge cannot act for a user without that user's
  token.
- The recipient is fixed in code **and** by the binding's `destination_address`.
  The browser cannot choose To/From/Reply-To; unknown form fields are ignored.
- There are no SMTP/API credentials in the frontend or the Worker. Cloudflare
  Email Routing sends to a *verified destination address* for free on every
  plan.

## Idempotency and failure cases

One browser attempt has one `requestId` (random, kept across retries of the
same attempt and reset when an answer or the file changes). Render maps it to
one `submissionId`, which is also the KycSubmission primary key.

| Case | Result |
|---|---|
| Upload/validation fails at the edge | 4xx, nothing sent, no row |
| Email provider refuses | 502 `kyc_email_failed`, **no confirm call, no row**; the user can retry |
| Email accepted, confirm fails (Render down) | 202 + sealed receipt (AES-GCM, only the edge can open it; no PII readable in the browser). The edge retries in the background (2 s, 8 s). The browser shows «На рассмотрении» and re-sends **only the receipt** (0/5/15/45 s, and on the next visit). The document is never re-uploaded |
| Double click / concurrent retry | one in-flight send per submissionId per isolate + the form's own guard → one email |
| Browser retry after the email was accepted | the edge remembers the delivery (Cache API, 24 h) → no second email; Render's `alreadySubmitted` covers the rest |
| Repeated or racing confirm | unique primary key + user row `FOR UPDATE` → exactly one row; a second attempt while one is PENDING becomes `duplicate_pending` (no second PENDING) |
| Already APPROVED / PENDING | authorize → 409 before any email |

The remaining gap: if one colo's Cache entry is lost **and** the first
response never reached the browser **and** the confirm also failed, a retry of
the same attempt can send a second email. It carries the same Submission ID, and
there is still at most one row.

## Limits and privacy

- 4 MB per document, the same on client and edge. Workers Free allows about
  10 ms CPU per request, and base64 + MIME costs about 2–3 ms/MB. Compressed
  photos are typically 0.3–1.5 MB.
- The edge logs identifiers and sizes only: never a name, DOB, email, or
  document bytes. The Render routes log no body.
- Every edge response is `Cache-Control: no-store`, `nosniff`,
  `no-referrer`. There is no KV/R2/D1 and no public URL. Nothing is stored at
  the edge except a 24 h "email accepted" marker (a timestamp and Message-ID)
  keyed by submission id.
- The platform may replace the Message-ID. The edge records the one that
  `send()` reports; the admin can search Gmail with `rfc822msgid:<id>`, or by
  the Submission ID in the body.

## Deploy / operate

- Worker: `.github/workflows/deploy-kyc-edge.yml` runs on a push to `main` that
  touches `workers/kyc-edge/**`, or on a manual run. It tests, deploys,
  creates the signing key if it is missing (it never rotates an existing
  one), then smoke-tests `/health`, `/v1/public-key`, 401 without a session,
  404, CORS and `no-store`.
- PR checks: `.github/workflows/kyc-edge.yml`. It runs the Worker contract
  tests, a wrangler dry-run, the additive migration on PostgreSQL 16, the API
  and PostgreSQL suites, both builds, and `scripts/qa-kyc-edge.cjs` in
  Chromium at 320/360/390/430/1440.
- Requirement outside git: `voltex.crypto@gmail.com` must be a **verified
  destination address** in Cloudflare Email Routing for `voltextech.net`.
  The owner verified it on 2026-09-26 (see the support-edge entry in
  `docs/AI_HANDOFF.md`). If it is ever removed, sends fail with a provider error
  (`E_RECIPIENT_NOT_ALLOWED`), users see «Документ не отправлен», and no row is created.
- To rotate the signing key: delete the `KYC_EDGE_SIGNING_JWK` secret and
  re-run the deploy workflow. Render re-fetches the public key at most once
  a minute after a signature mismatch. If `KYC_EDGE_PUBLIC_KEY` is pinned,
  update it as well.
