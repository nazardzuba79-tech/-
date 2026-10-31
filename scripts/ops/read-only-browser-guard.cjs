'use strict';

// For operator QA only. This is not exchange middleware and grants no access.
// Install on an EMPTY browser context before creating/navigating a page.
const FORBIDDEN_READS = /(?:^|\/)(?:portfolio-snapshot|state|calculate|publish|countdown|draft|delete)(?:\/|$)/i;

function createPolicy({ documents, resources = [], apiReads }) {
  const exact = new Set([...documents, ...apiReads].map(value => {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) throw new Error('Invalid allowlist URL');
    return url.href;
  }));
  const prefixes = resources.map(value => {
    const url = new URL(value);
    if (!url.pathname.endsWith('/') || url.username || url.password || url.search || url.hash) {
      throw new Error('Resource prefixes require a clean directory URL');
    }
    return url;
  });
  return (method, value) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) return false;
    let url;
    try { url = new URL(value); } catch { return false; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { return false; }
    // GET is not synonymous with read-only. These known commands stay refused
    // even if a caller accidentally puts them in an allowlist.
    if (FORBIDDEN_READS.test(pathname) || /\\|\/{2}|%/.test(pathname)
      || /(?:^|\/)\.{1,2}(?:\/|$)/.test(pathname)) return false;
    url.hash = ''; url.search = '';
    if (exact.has(url.href)) return true;
    return prefixes.some(p => url.origin === p.origin && pathname.startsWith(p.pathname));
  };
}

async function installReadOnlyGuard(context, options) {
  if (context.pages().length) throw new Error('READ_ONLY_GUARD_REQUIRES_EMPTY_CONTEXT');
  if (typeof context.routeWebSocket !== 'function') throw new Error('WEBSOCKET_GUARD_UNAVAILABLE');
  const allowed = createPolicy(options);
  const blocked = [];
  // No sockets/financial commands, service workers or credential export in QA.
  // Caller must create its context with serviceWorkers: 'block'.
  await context.routeWebSocket('**/*', socket => socket.close());
  await context.route('**/*', async route => {
    const request = route.request();
    if (allowed(request.method(), request.url())) return route.continue();
    let pathname = 'INVALID_URL';
    try { pathname = new URL(request.url()).pathname; } catch {}
    blocked.push({ method: request.method(), path: pathname }); // never tokens, query, headers or bodies
    await route.abort('blockedbyclient');
  });
  return { blocked };
}

async function createReadOnlyContext(browser, options, contextOptions = {}) {
  // Create rather than attach: service workers must never bypass interception.
  const context = await browser.newContext({ ...contextOptions, serviceWorkers: 'block' });
  try {
    const guard = await installReadOnlyGuard(context, options);
    return { context, ...guard };
  } catch (error) {
    await context.close();
    throw error;
  }
}

module.exports = { createPolicy, installReadOnlyGuard, createReadOnlyContext };
