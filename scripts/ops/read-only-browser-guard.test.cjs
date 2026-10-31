'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createPolicy, installReadOnlyGuard, createReadOnlyContext } = require('./read-only-browser-guard.cjs');
const options = {
  documents: ['https://voltextech.net/banking'],
  resources: ['https://voltextech.net/assets/'],
  apiReads: ['https://api.voltextech.net/api/v1/me', 'https://api.voltextech.net/api/v1/banking/config'],
};
const allow = createPolicy(options);
test('known safe documents/assets/API reads only', () => {
  assert.equal(allow('GET', options.documents[0]), true);
  assert.equal(allow('GET', 'https://voltextech.net/assets/chunk.js'), true);
  assert.equal(allow('OPTIONS', options.apiReads[0]), true);
  assert.equal(allow('GET', options.apiReads[1]), true);
  assert.equal(allow('GET', 'https://api.voltextech.net/api/v1/admin/users'), false);
});
test('mutations, lookalike origins, encoded commands and unreviewed GETs fail closed', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'CONNECT']) {
    assert.equal(allow(method, options.apiReads[0]), false, method);
  }
  for (const path of ['https://voltextech.net.evil.invalid/assets/a.js',
    'https://voltextech.net@evil.invalid/assets/a.js',
    'https://voltextech.net/assets/../api/v1/banking/state',
    'https://voltextech.net/assets/%73tate',
    'https://api.voltextech.net/api/v1/banking/state',
    'https://api.voltextech.net/api/v1/wallet/portfolio-snapshot',
    'https://voltextech.net/assets/%ZZ']) assert.equal(allow('GET', path), false, path);
});
test('dangerous GET cannot be accidentally allowlisted', () => {
  for (const name of ['state', 'portfolio-snapshot', 'publish', 'draft', 'countdown']) {
    const url = `https://api.voltextech.net/api/v1/banking/${name}`;
    assert.equal(createPolicy({ documents: [], apiReads: [url] })('GET', url), false);
  }
});
test('refuses an already navigated context', async () => {
  await assert.rejects(installReadOnlyGuard({ pages: () => [{}] }, options), /EMPTY_CONTEXT/);
});
test('real Chromium blocks snapshot POST and accrual GET before either reaches server', async () => {
  const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
  const reached = [];
  const server = http.createServer((req, res) => {
    reached.push(`${req.method} ${req.url}`);
    res.setHeader('Content-Type', req.url === '/' ? 'text/html' : 'application/json');
    res.end(req.url === '/' ? '<!doctype html><title>read guard</title>' : '{"ok":true}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const control = await browser.newContext({ serviceWorkers: 'block' });
    const controlPage = await control.newPage();
    await controlPage.goto(base);
    await controlPage.evaluate(async () => {
      await fetch('/api/v1/wallet/portfolio-snapshot', { method: 'POST' });
      await fetch('/api/v1/banking/state');
    });
    assert.ok(reached.includes('POST /api/v1/wallet/portfolio-snapshot'));
    assert.ok(reached.includes('GET /api/v1/banking/state'));
    await control.close();
    reached.length = 0;
    const guard = await createReadOnlyContext(browser, {
      documents: [base + '/'], apiReads: [base + '/api/v1/banking/config'],
    });
    const { context } = guard;
    const page = await context.newPage();
    await page.goto(base);
    const result = await page.evaluate(async () => {
      const paths = [['GET', '/api/v1/banking/config'], ['POST', '/api/v1/wallet/portfolio-snapshot'],
        ['GET', '/api/v1/banking/state'], ['PUT', '/api/v1/admin/listings/example/draft']];
      return Promise.all(paths.map(async ([method, path]) => {
        try { return (await fetch(path, { method })).ok; } catch { return false; }
      }));
    });
    assert.deepEqual(result, [true, false, false, false]);
    assert.deepEqual(reached.filter(x => x.includes('/api/')), ['GET /api/v1/banking/config']);
    assert.equal(guard.blocked.filter(x => x.path.includes('/api/')).length, 3);
    assert.ok(guard.blocked.every(x => Object.keys(x).join(',') === 'method,path'));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('factory enforces blocked service workers and closes context on setup failure', async () => {
  let supplied, closed = false;
  const browser = { newContext: async options => {
    supplied = options;
    return { pages: () => [], close: async () => { closed = true; } };
  } };
  await assert.rejects(createReadOnlyContext(browser, options, { serviceWorkers: 'allow' }), /WEBSOCKET_GUARD_UNAVAILABLE/);
  assert.equal(supplied.serviceWorkers, 'block');
  assert.equal(closed, true);
});
