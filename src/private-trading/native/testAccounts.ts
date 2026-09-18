/** Server-configured test identities only. Never accept IDs from a request,
 * email, balance amount or role. Empty by default; no existing account is opted in. */
export function nativeTestAccountIds(): ReadonlySet<string> {
  const raw = process.env.PRIVATE_TRADING_TEST_USER_IDS ?? '';
  if (raw.length > 10_000) return new Set();
  const ids = raw.split(',').map(id => id.trim()).filter(Boolean);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // Invalid configuration fails closed, rather than partially enabling a typo.
  if (ids.length > 100 || ids.some(id => !uuid.test(id))) return new Set();
  return new Set(ids);
}

export function isNativeTestAccount(userId: string | null | undefined): boolean {
  return typeof userId === 'string' && nativeTestAccountIds().has(userId);
}
