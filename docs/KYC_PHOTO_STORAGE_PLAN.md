# KYC photos in the admin panel — storage audit and plan (2026-10-16)

> **Owner decision, 2026-10-16: rejected.** Do not create or connect
> Cloudflare R2 or any other store for passports and selfies, and do not load
> photos into the admin panel automatically. The current path stays: user →
> KYC edge → attachment in the admin mailbox; the admin opens the attachments
> in the comparison screen by hand. This is **not a release blocker**. No
> extra forwarding of documents to Telegram either (§7). The audit and Option
> A below are kept only as the record of what was considered and why it was
> rejected. Handling rules for the mailbox: `docs/KYC_DOCUMENT_POLICY.md`.

Owner question: can the admin open a KYC application and see the document
photo next to the selfie automatically, without saving e-mail attachments,
without a new paid service and without public URLs?

**Answer: not with the storage that exists today.** Showing the pictures
automatically means keeping them somewhere the admin panel can read. No such
place exists, and creating one is a new store of personal data, which needs
the owner's separate approval. Until then the admin panel keeps the working
manual comparison (attachments opened locally, nothing uploaded). This
document is the exact plan for when the owner decides.

## 1. What exists now (audited in the repository)

| Place | KYC images? | Notes |
|---|---|---|
| Admin mailbox (Cloudflare Email Routing → `voltex.crypto@gmail.com`) | **Yes** — every document, new document photo and selfie | The only copy. Access = whoever can open the mailbox. |
| Cloudflare KYC edge (`workers/kyc-edge`) | No | `wrangler.toml`: no KV / D1 / R2 / Durable Objects; only a 24 h "email accepted" marker (timestamp + Message-ID) in the Cache API. |
| Render API (`render.yaml`: `plan: free`) | No | The upload path is closed (`src/api/routes/kyc.ts`). The free plan has no persistent disk; legacy rows with `documentImagePath` point to files that do not survive a redeploy — that is why the admin card already handles «Документ не найден … (404)». |
| Neon PostgreSQL | No | Only metadata: type, size, Message-ID, times, consent version, audit log. The migration of PR #530 has no binary column (tested). |
| Other Workers (`deposit-catalogue`, `market-edge`, `notification-edge`, `support-edge`) | No | Durable Objects / e-mail only; nothing KYC. |

An earlier hand-off entry mentions an R2 bucket used for database backups
(`r2-20261007T002652Z`), so R2 is probably already enabled on the Cloudflare
account. That cannot be confirmed from the repository; the owner should check
the dashboard (Storage & databases → R2).

## 2. Options

| Option | Verdict |
|---|---|
| A. Private Cloudflare R2 bucket, reachable only through the KYC Worker | **Rejected by the owner (2026-10-16).** Was the recommendation if a new store were approved. |
| B. PostgreSQL (Neon) `bytea` | Not recommended: images in the main database, backups grow, Neon plan storage limits, every DB reader is near the pictures. |
| C. Render disk | Not possible on the free plan (no persistent disk). |
| **D. Keep e-mail + manual comparison (current)** | **Chosen by the owner (2026-10-16).** Works today; no new store; the admin opens the attachments by hand (or drops / pastes them into the panes). |

## 3. Option A in detail

**Write path** (same request that sends the e-mail today): after Render
authorises the upload, the Worker stores the bytes in a private bucket
`voltex-kyc-private` under an unguessable key
`k/<submissionId>/<deliveryId>` — the e-mail is still sent (it remains the
backup copy and the admin notification). Optional extra layer: AES-GCM with a
Worker secret before `put`, so a leaked bucket token alone does not reveal
images (R2 already encrypts at rest).

**Read path** (admin opens the comparison screen):

1. The admin panel asks Render for a viewing ticket for one file. Render checks
   the session and `role = ADMIN`, that the file belongs to the submission
   being viewed, writes `KYC_FILE_VIEWED` to the audit log, and signs a ticket:
   file key, admin id, session id, expiry ≤ 60 s.
2. The panel fetches the image from the Worker with that ticket in a header
   (not in the URL). The Worker verifies the signature (Render's public key,
   pinned like the existing edge key in the other direction), the expiry and
   that the ticket names this file, then streams the object.
3. Response headers: `Cache-Control: no-store, private`,
   `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`,
   `Referrer-Policy: no-referrer`, no CORS for any origin but the admin site.
4. The panel turns the bytes into a `blob:` URL that lives only while the
   screen is open (exactly how the legacy on-server document is shown today),
   so nothing lands in the browser cache or history.

No public bucket, no `r2.dev` domain, no custom domain on the bucket, no
presigned S3 URLs.

**Deletion and retention:** an R2 lifecycle rule deletes objects after the
retention period the owner sets (Cloudflare documents expiry rules by prefix;
deletion happens "typically within 24 hours" of expiry). Optionally the
Worker deletes a selfie as soon as the decision is made. Every view and every
deletion is in the audit log. Consent text changes to say the selfie is stored
for verification for N days (new consent version `kyc-selfie-v2`).

**Logs:** the Worker keeps logging identifiers only (as tested today); object
keys contain no name, e-mail or document number.

## 4. Cost (official pricing page, "Last updated Oct 1, 2026")

Free every month (Standard storage only): 10 GB-month of storage, 1 million
Class A operations (writes), 10 million Class B operations (reads); egress is
free. Above that: $0.015 per GB-month, $4.50 per million Class A,
$0.36 per million Class B; usage is rounded up to the next billing unit.
Deleting objects is a free operation; Standard storage has no minimum storage
duration. R2 needs an "R2 subscription" on the account (the get-started page:
"Complete the checkout flow to add an R2 subscription"); billing is
usage-based.

Estimate (files are ≤ 4 MB, typically 0.3–1.5 MB after the browser re-encodes
them): 1 000 applications a month × 3 files × 1 MB ≈ 3 GB written per month.
With a 90-day retention the bucket holds about 9 GB → inside the 10 GB free
tier; operations are a few thousand a month, far below the free limits. At ten
times that volume: about 90 GB → roughly $1.20 a month for storage. These are
estimates from the published prices, not a quote.

## 5. Risks

- **A new store of identity documents and faces**: breach exposure, legal
  duties (retention, deletion on request, access records) — owner/legal
  decision.
- **Admin account compromise** exposes images: mitigated by 2FA for admins,
  60-second tickets, the view audit log; not eliminated.
- **Key management**: a second signing key (Render → Worker) and, if used, the
  encryption secret; rotation steps must be written before release.
- **Worker CPU on Workers Free (~10 ms)**: storing is a streamed `put`
  (cheap); optional AES-GCM over 4 MB must be measured before it is enabled.
- **Render free plan cold starts** delay the ticket by seconds on the first
  view.
- **Deletion correctness**: lifecycle expiry is asynchronous (≤ 24 h typical);
  per-object deletion on decision should be tested.

## 6. What the owner would have decided (item 1 answered: no)

1. Approve a new private store for KYC images (R2 bucket) — **no (2026-10-16)**; items 3–5 therefore do not apply.
2. Retention period for documents and for selfies (and whether selfies are
   deleted right after the decision).
3. Confirm the R2 subscription on the Cloudflare account and who may hold R2
   tokens.
4. New consent wording (stored for N days) and privacy notice.
5. Whether e-mail copies stay (backup/notification) or e-mail becomes a
   notice without attachments.

Work after approval (estimate): Worker write/read paths and tests, Render
ticket route + audit, admin panel auto-load, consent v2 in 7 languages,
lifecycle configuration, browser QA — about 2–3 days of work, then a staged
release like the one in `docs/KYC_EDGE.md`.

## 7. Telegram (owner's note, 2026-10-16)

Two different things, not to be confused:

- **VOLTEX's own Telegram notice** (`workers/notification-edge`, event
  `KYC_MATERIALS_RECEIVED`): text only — e-mail, name, which part arrived,
  whether the request is complete. The Worker accepts a fixed list of fields,
  rejects any other, and has no call that sends a photo or a file. Unchanged.
- **The owner's mailbox forwarding to Telegram**: an existing mechanism of the
  owner's, outside this repository; not changed and not duplicated. Whether it
  forwards the letters' **attachments** (the photos) or only a notice cannot
  be told from the repository; `docs/KYC_DOCUMENT_POLICY.md` says what follows
  in either case.

No new bot, forwarding, URL or other transfer of documents to Telegram is
added.
