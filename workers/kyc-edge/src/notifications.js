// No new Render calls: uses only the identity already authorized for this
// submission. Service binding is private; no browser notification endpoint.
export function queueKycNotification(env, ctx, event, outcome) {
  queue(ctx, outcome, () => env.NOTIFICATIONS.notify(event), env);
}

// An additional material (new document photo or selfie) reached the admin
// mailbox. Same binding; until the notification Worker exposes this method the
// call fails here, is logged without detail, and the upload is unaffected.
export function queueKycMaterialNotification(env, ctx, event, outcome) {
  queue(ctx, outcome, () => env.NOTIFICATIONS.notifyMaterials(event), env);
}

function queue(ctx, outcome, send, env) {
  if (!['created', 'exists'].includes(outcome)) return;
  const task = (async () => {
    try {
      if (!env.NOTIFICATIONS) { console.warn('[notifications]', 'NOT_CONFIGURED'); return; }
      const result = await send();
      if (!['SENT', 'DUPLICATE'].includes(result?.status)) console.warn('[notifications]', 'DELIVERY_UNAVAILABLE');
    } catch { console.warn('[notifications]', 'DELIVERY_UNAVAILABLE'); }
  })();
  // waitUntil keeps the best-effort send alive without delaying KYC success.
  if (ctx?.waitUntil) ctx.waitUntil(task);
}
