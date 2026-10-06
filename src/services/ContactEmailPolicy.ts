import { createHash } from 'crypto';

// Runtime policy survives account deletion without retaining addresses in source.
// Matching is exact after case/whitespace normalization; no domain-wide blocking.
export function isBlockedContactEmail(email: unknown): boolean {
  if (typeof email !== 'string' || email.length > 320) return false;
  const configured = process.env.BLOCKED_CONTACT_EMAIL_SHA256;
  if (!configured) return false;
  const hash = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  return configured.split(',').some(value => value.trim().toLowerCase() === hash);
}
