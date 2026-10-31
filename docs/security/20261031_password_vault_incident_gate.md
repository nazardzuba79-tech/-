# Credential vault exposure — code-only safety candidate (31 Oct 2026)

## Confirmed
Authenticated production Admin Users UI exposes recovered customer passwords. On main, registration and account password changes write recoverably encrypted copies in AdminPasswordVault, and both admin listing endpoints read/decrypt that vault for the owner. bcrypt hashes for normal authentication already exist.

## Changes
- Registration/password changes stop making new reversible password copies.
- Both legacy and paged admin user lists never access or decrypt vault rows and return password:null only for legacy compatibility.
- Desktop/mobile user list renders a constant dash, never a server-supplied password.
- Registration and owner-admin regression tests verify no vault write/read.
- Existing vault table and data remain untouched. No data export or mutation occurs in this review-only candidate.

## Release gates / NO-GO
1. Exact-head CI with auth/register/change-password/2FA and admin page test suites, TS compile and browser QA at 1440/390.
2. Confirm all API paths, logs, backups, CDN caches and audit payloads cannot disclose secrets. Do not store actual secrets in test evidence.
3. Deploy API and frontend together only through an attested, narrow, owner-approved release (production Pages source differs from main); frontend alone is insufficient.
4. Separately review and approve a *controlled* cleanup/retention decision for historical AdminPasswordVault records, after independently confirmed restore and incident assessment. No automatic deletion in this PR.
5. Assess session revocation, forced password reset, user notification, admin MFA and key rotation based on verified exposure.
6. Avoid reverting this security fix during rollback; retain it in any rollback image.

No merge, deploy, data migration or production financial write performed.
