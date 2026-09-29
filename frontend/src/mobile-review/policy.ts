export const isLoopback = (hostname: string) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
export const isReviewPath = (path: string) => ['/pwa', '/pwa/', '/telegram', '/telegram/', '/mobile-review.html'].includes(path);

export function assertReviewOrigin(location: Pick<Location, 'hostname' | 'pathname'>) {
  if (!isLoopback(location.hostname) || !isReviewPath(location.pathname)) throw new Error('Mobile review is available on loopback only.');
}

/** No authority can be produced by a fixture or by Telegram's frontend user object. */
export function tradingAllowed(state: { online: boolean; active: boolean; authoritative: boolean; review: boolean }) {
  return state.online && state.active && state.authoritative && !state.review;
}

export function reviewWrite(): never { throw new Error('Trading is disabled in local review.'); }

/** Defense in depth: even an accidentally imported shared transport cannot leave the tab. */
export function lockReviewTransport() {
  window.fetch = async () => { throw new Error('Network APIs are disabled in local review.'); };
  const blocked = class { constructor() { throw new Error('Network streams are disabled in local review.'); } };
  window.WebSocket = blocked as unknown as typeof WebSocket;
  window.EventSource = blocked as unknown as typeof EventSource;
  window.XMLHttpRequest = blocked as unknown as typeof XMLHttpRequest;
  navigator.sendBeacon = () => false;
}
