/**
 * Test-only environment.
 *
 * EMAIL_VERIFICATION_SECRET is mandatory in the real backend and has no
 * fallback (see src/config/emailVerificationSecret.ts). Supplying a fixed
 * value here is what lets the suite exercise the verification flow without
 * relaxing that requirement in application code — the production validation
 * is unchanged and is itself covered by
 * src/config/__tests__/emailVerificationSecret.test.ts.
 *
 * Deliberately different from JWT_SECRET: the config gate rejects the two
 * being equal, and the suite should run against the same shape production
 * must have.
 *
 * `setupFiles` runs before each test file's module registry is built, so a
 * suite that imports the service at module scope already has this set. Any
 * test that needs the variable absent deletes it locally and restores it.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-this-long';
process.env.EMAIL_VERIFICATION_SECRET =
  process.env.EMAIL_VERIFICATION_SECRET || 'test-email-verification-secret-distinct-from-jwt';
