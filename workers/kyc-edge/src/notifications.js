// No new Render calls: uses only the identity already authorized for this
// submission. Service binding is private; no browser notification endpoint.
export function queueKycNotification(env, ctx, event, outcome) {
  if (!['created', 'exists'].includes(outcome)) return;
  const task = (async () => {
    try {
      if (!env.NOTIFICATIONS) { console.warn('[notifications]', 'NOT_CONFIGURED'); return; }
      const result = await env.NOTIFICATIONS.notify(event);
      if (!['SENT', 'DUPLICATE'].includes(result?.status)) console.warn('[notifications]', 'DELIVERY_UNAVAILABLE');
    } catch { console.warn('[notifications]', 'DELIVERY_UNAVAILABLE'); }
  })();
  // waitUntil keeps the best-effort send alive without delaying KYC success.
  if (ctx?.waitUntil) ctx.waitUntil(task);
}
