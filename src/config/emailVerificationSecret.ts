/**
 * The HMAC key for six-digit email-verification codes.
 *
 * This is deliberately its OWN secret, not a second use of JWT_SECRET.
 * The two keys protect different things and have different blast radii: a
 * leaked session-signing key lets an attacker mint sessions, while a leaked
 * verification key lets them derive valid codes for any pending
 * registration. Sharing one value means either leak costs you both, and it
 * means the verification key can never be rotated without invalidating every
 * live session. There is no fallback here for exactly that reason.
 *
 * Rules this enforces:
 *   - required; the process refuses to start without it
 *   - never falls back to JWT_SECRET
 *   - never has a hardcoded default
 *   - never generated at runtime (a per-boot key would invalidate every
 *     outstanding code on restart and differ across instances)
 *   - never echoed, so an error message can be pasted into an issue safely
 */

export const EMAIL_VERIFICATION_SECRET_ENV = 'EMAIL_VERIFICATION_SECRET';

const MISSING_MESSAGE = [
  `${EMAIL_VERIFICATION_SECRET_ENV} env var is required.`,
  'Email verification codes are HMAC-keyed with it, and it must be a dedicated',
  'secret — it deliberately does NOT fall back to JWT_SECRET. Set it to a long',
  'random string (see .env.example) before starting the backend.',
].join(' ');

const REUSED_JWT_MESSAGE = [
  `${EMAIL_VERIFICATION_SECRET_ENV} must not be the same value as JWT_SECRET.`,
  'Reusing the session-signing key for verification codes means either key',
  'leaking compromises both, and neither can be rotated independently.',
  'Generate a separate random value.',
].join(' ');

/**
 * Returns the secret, or throws with a message that names the variable and
 * never contains its value.
 *
 * Takes the environment as an argument so this is directly testable without
 * mutating the real `process.env` mid-suite.
 */
export function requireEmailVerificationSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env[EMAIL_VERIFICATION_SECRET_ENV];

  // Whitespace counts as missing: a variable set to "" or " " in a dashboard
  // is a misconfiguration, not a key.
  if (!secret || secret.trim().length === 0) {
    throw new Error(MISSING_MESSAGE);
  }

  if (env.JWT_SECRET && secret === env.JWT_SECRET) {
    throw new Error(REUSED_JWT_MESSAGE);
  }

  return secret;
}

/**
 * Startup gate. Called from src/index.ts before the server binds, so a
 * deployment missing the variable dies immediately and visibly rather than
 * accepting registrations it cannot ever verify.
 */
export function assertEmailVerificationSecretConfigured(env: NodeJS.ProcessEnv = process.env): void {
  requireEmailVerificationSecret(env);
}
