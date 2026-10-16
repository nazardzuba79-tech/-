# KYC documents: Cloudflare edge → admin email (the API keeps metadata only)

> **Where things run (2026-10-16).** This document was written when the API ran
> on Render with Neon PostgreSQL; read «Render» below as **the VOLTEX API** and
> «Neon» as **its PostgreSQL**. Since the Hetzner cutover the API and its
> PostgreSQL run on Hetzner (`docs/VOLTEX_CURRENT_STATE.md`; Render services
> suspended, Neon kept only as old/rollback infrastructure). Verified read-only
> on 2026-10-16: `https://api.voltextech.net/health` reports commit `57a154a0`
> (branch `release/hetzner-api-baseline-3e64ae89`, started 2026-10-09), so a
> merge to `main` does **not** update the API. **UNVERIFIED** from this
> repository (needs the operator's SSH): the Compose project directory, the
> container names, the image and the database identity on that server.
> Releasing: `docs/KYC_RELEASE_RUNBOOK.md`. Document handling rules:
> `docs/KYC_DOCUMENT_POLICY.md`.

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

- Worker: `.github/workflows/deploy-kyc-edge.yml`. A push to `main` that
  touches the Workers only **verifies** them (contract tests, synthetic
  notification tests, both `wrangler deploy --dry-run`; no token). Deploying
  is a **manual run from `main`** (owner decision 2026-10-16) with the API
  commit the operator deployed on Hetzner: the run checks read-only that
  `api.voltextech.net/health` reports exactly that commit, that the commit
  carries the materials routes and migration, and that the live API answers
  415 (not 404) on `internal/kyc/authorize`, `internal/kyc/materials/authorize`
  and `internal/kyc/materials/confirmed`; then it deploys the notification
  Worker, the KYC edge, creates the signing key if it is missing (it never
  rotates an existing one), and smoke-tests `/health`, `/v1/public-key`, 401
  without a session on `/v1/submit` and `/v1/materials`, 404, CORS and
  `no-store`. Mode `notification-only` deploys the Telegram Worker alone
  (e.g. after a JWT secret rotation) without the KYC checks. The deploy job
  uses the GitHub environment `kyc-workers-production`; required reviewers
  can be added to it in the repository settings.
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
  run the deploy workflow by hand. The API re-fetches the public key at most once
  a minute after a signature mismatch. If `KYC_EDGE_PUBLIC_KEY` is pinned,
  update it as well.

## Additional materials: a new document photo and/or a selfie (2026-10-15)

While a submission is PENDING the admin can ask for more instead of rejecting:
a new photo of the document (reason: blurry, hard to read, cropped, not enough
light, or own text), an ordinary selfie for a manual face comparison (no
document in hand; optional comment), or both.

- **Storage is unchanged.** The files take the same road as the document:
  browser → `POST /v1/materials` on this Worker → admin mailbox. Subjects
  «[KYC] Новое фото документа — …» / «[KYC] Селфи для подтверждения личности — …»,
  attachment `kyc-<submissionId>-document|selfie-<delivery8>.<ext>`, header
  `X-Voltex-Kyc-Material: <requestId>; part=…`. Render/Neon keep only the
  request, what arrived (type, size, Message-ID, time), the selfie consent
  (time + wording version `kyc-selfie-v1`) and every decision in `AuditLog`.
  Keeping the pictures on a server (encrypted, with retention) would be a
  separate decision for the owner; nothing here does it.
- **Table** `KycMaterialRequest` (additive migration
  `20261015090000_kyc_material_requests`; `KycStatus` enum unchanged).
  `User.kycStatus` stays `PENDING` for the whole cycle; the finer stage is
  derived (`src/services/kycMaterials.ts`): На проверке → Требуется новое фото
  документа / Требуется селфи / Требуются документ и селфи → Дополнительные
  материалы получены → Повторная проверка → Подтверждено / Отклонено.
- **Admin API** (`requireAdmin`): `POST /kyc/:id/material-requests`
  (`clientRequestId` makes a repeat the same request; a new one supersedes the
  open one; submission row locked) and
  `POST /kyc/material-requests/:id/acknowledge`. A decision
  (`POST /kyc/:id/review`) closes open requests; received data is kept.
- **Edge ↔ Render**, both signed like the submission calls:
  `/internal/kyc/materials/authorize` (session + ownership: someone else's
  request answers exactly like a missing one; closed / not requested / already
  received → 409; a selfie needs consent and is JPEG/PNG only) and
  `/internal/kyc/materials/confirmed` (delivery id recomputed with HMAC, row
  locked, idempotent). Sealed receipts (`kind: 'material'`) reuse `/v1/confirm`.
- **Admin Telegram** event `KYC_MATERIALS_RECEIVED` through the private
  binding (`KycNotifications.notifyMaterials`: email, name, part, complete —
  no file, no id). Until the notification Worker with that method is
  deployed, the call fails quietly and the upload is unaffected.
- **Comparison screen** in the admin: document left, selfie right, zoom,
  rotate, pan, fullscreen. The admin opens the saved attachments locally
  (object URLs, never uploaded); a legacy on-server document loads itself.
  There is no face recognition, no similarity score, no automatic decision.
- **Quality checks** in the browser only: format, size, the image decodes,
  minimum resolution (document 1000×600, selfie 640×480). They say nothing
  about authenticity; the admin decides.
- Tests: `src/api/routes/__tests__/kycMaterials*.test.ts`,
  `workers/kyc-edge/test.mjs`, `workers/notification-edge/*.test.mjs`,
  `frontend/src/lib/__tests__/kycEdgeClient.test.ts`,
  `adminKycReviewSafety.test.ts`; browser: `scripts/qa-kyc-materials.cjs`
  (12 scenarios, PostgreSQL, Chromium's synthetic camera, synthetic files).
- **Deploying it** means: the migration and the API on Hetzner (by the
  operator; the repository `Dockerfile` start command runs `prisma migrate
  deploy` — whether the Hetzner Compose uses it is UNVERIFIED), the
  Workers (a manual run of `deploy-kyc-edge.yml`, notification Worker first),
  and the frontend (Cloudflare Pages). A merge to `main` does none of the
  first two. Order, checks and rollback: `docs/KYC_RELEASE_RUNBOOK.md`.

### Release order, compatibility and rollback

Superseded on 2026-10-16: the earlier text here assumed that a merge to `main`
starts Render's API deploy with `prisma migrate deploy`. It does not — the API
is on Hetzner and is updated by hand. The step-by-step order (PostgreSQL backup
→ migration → API → Workers → frontend → checks), its preflight and the
rollback are in `docs/KYC_RELEASE_RUNBOOK.md`.

Compatibility that still holds (every piece is additive):

| Live first | Effect until the rest arrives |
|---|---|
| API + migration | Old frontend ignores the new optional fields; old Workers never call the new routes. |
| Frontend | The user page looks as before (nobody has a request yet); in the admin, «Отправить запрос» and the two new queue filters fail with an error until the API has the routes — nothing is written. |
| KYC edge Worker | Prevented: the manual deploy refuses to run until the live API answers on the materials routes. |
| KYC edge before notification Worker | Prevented: the deploy job deploys the notification Worker first. |

### Retention, access, consent withdrawal — owner/legal decision

What is kept where: the pictures only in the KYC mailbox (as the original
documents already are); in PostgreSQL only metadata (type, size, Message-ID,
times, consent version) and the audit log; nothing at the edge beyond a 24 h
"email accepted" marker. This change adds no storage, no paid service and no
biometric processing. Open points to settle before release:

1. How long document photos and selfies stay in the mailbox (the period the
   company's AML obligations require; a selfie may warrant a shorter one once
   the decision is made), and who deletes them.
2. Who can open the mailbox (2FA, named people only) — the access control for
   these files is the mailbox's.
3. Withdrawing selfie consent: today a manual procedure — the user writes to
   support; the admin finds the letter by `rfc822msgid:<Message-ID>` from the
   request history, deletes it and records it; the request can be closed by a
   new request or a decision. An in-app button would be a separate change.
4. The comparison screen stays manual — **owner's decision, 2026-10-16**: no
   Cloudflare R2 or any other new store for passports and selfies, no
   automatic loading into the admin panel. The admin saves the attachments and
   opens them (or drops / pastes them into the panes). Not a release blocker.
   The audit and the rejected option: `docs/KYC_PHOTO_STORAGE_PLAN.md`.
5. Telegram: VOLTEX's own `KYC_MATERIALS_RECEIVED` notice is text only (no
   file, see below). The owner's mailbox also forwards to Telegram (the
   owner's own mechanism, unchanged). The rules for both, and what to do if
   that forwarding carries attachments: `docs/KYC_DOCUMENT_POLICY.md`.
