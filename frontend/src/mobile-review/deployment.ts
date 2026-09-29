/** Hosting-neutral endpoint descriptor; review builds still have no API transport. */
export function reviewDeployment(env: Record<string, string | undefined>) {
  const frontendOrigin = env.MOBILE_FRONTEND_ORIGIN || 'http://127.0.0.1:4178';
  const telegramOrigin = env.MOBILE_TELEGRAM_ORIGIN || frontendOrigin;
  const apiBase = env.MOBILE_API_BASE || '/api/v1';
  for (const raw of [frontendOrigin, telegramOrigin, new URL(apiBase, frontendOrigin).href]) {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) {
      throw new Error('Review configuration permits loopback endpoints only');
    }
  }
  return { frontendOrigin: new URL(frontendOrigin).origin, telegramOrigin: new URL(telegramOrigin).origin, apiBase };
}
