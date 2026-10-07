/** Built-bundle, offline-only visual QA. Never forwards an API request or write. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const dist = path.resolve('frontend/dist');
const out = path.resolve(process.env.QA_OUT || 'output/auth-business-class');
const slogan = 'Копируйте сделки лучших трейдеров мира.';
const report = { head: process.env.QA_HEAD_SHA || process.env.GITHUB_SHA || null, fixtureOnly: true, cases: [], behavior: [], fixtureRequests: [], expectedFixtureErrors: [], errors: [], failed: [], denied: [], writes: [], result: 'FAIL' };
fs.mkdirSync(out, { recursive: true });
const app = express();
app.use('/api', (_req, res) => res.status(405).end());
app.use(express.static(dist));
app.use((_req, res) => res.sendFile(path.join(dist, 'index.html')));
(async () => {
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  async function openContext(width, lang = 'ru', fixtures = []) {
    const ctx = await browser.newContext({ viewport: { width, height: width > 760 ? 960 : 844 }, serviceWorkers: 'block', deviceScaleFactor: 1 });
    await ctx.addInitScript(language => {
      localStorage.setItem('exchange_lang', language);
      window.__authCLS = 0;
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__authCLS += entry.value;
      }).observe({ type: 'layout-shift', buffered: true });
    }, lang);
    const fulfilled = [];
    await ctx.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (!['GET', 'HEAD'].includes(req.method())) {
        const fixture = fixtures[0];
        if (url.origin === origin && req.method() === 'POST' && fixture?.path === url.pathname) {
          fixtures.shift();
          assert.deepEqual(req.postDataJSON(), fixture.request, 'real callback sends the expected fixture payload');
          fulfilled.push({ url: req.url(), status: fixture.status });
          report.fixtureRequests.push({ path: url.pathname, method: req.method(), status: fixture.status, forwarded: false });
          return route.fulfill({ status: fixture.status, contentType: 'application/json', body: JSON.stringify(fixture.body) });
        }
        report.writes.push({ path: url.pathname, method: req.method() });
        return route.abort();
      }
      if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '/* local fallback font */' });
      if (url.origin === origin && !url.pathname.startsWith('/api')) return route.continue();
      report.denied.push(url.origin + url.pathname);
      return route.abort();
    });
    await ctx.routeWebSocket('**/*', socket => { report.denied.push(socket.url()); socket.close(); });
    const page = await ctx.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const expected = fulfilled.find(fixture => fixture.url === message.location().url && fixture.status >= 400 && message.text().startsWith(`Failed to load resource: the server responded with a status of ${fixture.status}`));
      if (expected) report.expectedFixtureErrors.push({ path: new URL(expected.url).pathname, status: expected.status });
      else report.errors.push(message.text());
    });
    page.on('requestfailed', request => { if (request.failure()?.errorText !== 'net::ERR_ABORTED') report.failed.push(request.url()); });
    return { ctx, page };
  }
  async function waitForVisual(page) {
    await page.locator('.vx-auth-form').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.querySelectorAll('.vx-auth-brand img')].every(img => img.complete && img.naturalWidth > 0));
    await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
  }
  async function measure(page) {
    return page.evaluate(() => {
      const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
      const brand = document.querySelector('.vx-auth-brand');
      const img = brand.querySelector('img');
      const headline = brand.querySelector('.vx-auth-hero h2');
      const overlayStyles = [...brand.querySelectorAll('.vx-auth-brand-inner,.vx-auth-brand-head,.vx-auth-hero,.vx-auth-hero h2')].flatMap(node => [null, '::before', '::after'].map(pseudo => {
        const style = getComputedStyle(node, pseudo);
        return { selector: node.className || node.tagName, pseudo, content: style.content, background: style.backgroundColor, image: style.backgroundImage, border: style.borderWidth, radius: style.borderRadius, shadow: style.boxShadow, blur: style.backdropFilter, stroke: style.webkitTextStrokeWidth };
      })).filter(style => !style.pseudo || !['none', 'normal'].includes(style.content));
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        brand: rect(brand), form: rect(document.querySelector('.vx-auth-form')), photo: rect(img),
        src: img.currentSrc.split('/').pop(), natural: { width: img.naturalWidth, height: img.naturalHeight }, fit: getComputedStyle(img).objectFit,
        bannerDecoration: {
          before: getComputedStyle(brand, '::before').content,
          after: getComputedStyle(brand, '::after').content,
          imageBackground: getComputedStyle(img).backgroundColor,
          imageBorder: getComputedStyle(img).borderWidth,
          imageRadius: getComputedStyle(img).borderRadius,
          imageShadow: getComputedStyle(img).boxShadow,
          imageBlur: getComputedStyle(img).backdropFilter,
        },
        headline: headline ? { ...rect(headline), text: headline.textContent.trim(), lines: Math.round(headline.getBoundingClientRect().height / parseFloat(getComputedStyle(headline).lineHeight)) } : null,
        overlayStyles, cls: window.__authCLS,
        clipped: [...document.querySelectorAll('.vx-auth h1,.vx-auth h2,.vx-auth p,.vx-auth input,.vx-auth button,.vx-auth-tabs a')].filter(n => n.clientWidth && n.scrollWidth > n.clientWidth + 1).map(n => n.className),
        submit: { tag: document.querySelector('.vx-auth-submit').tagName, color: getComputedStyle(document.querySelector('.vx-auth-submit')).backgroundColor },
      };
    });
  }
  try {
    const matrix = [
      ...[1920, 1440, 1366, 430, 390, 360, 320].map(width => ({ width, lang: 'ru' })),
      ...['en', 'zh', 'es', 'hi', 'ja', 'ko'].flatMap(lang => [1440, 320].map(width => ({ width, lang }))),
    ];
    for (const { width, lang } of matrix) {
      for (const routeName of ['login', 'register']) {
        const { ctx, page } = await openContext(width, lang);
        await page.goto(`${origin}/${routeName}?next=%2Fwallet`, { waitUntil: 'networkidle' });
        await waitForVisual(page);
        const measurements = await measure(page);
        const label = `${lang} ${routeName} ${width}`;
        report.cases.push({ width, lang, route: routeName, ...measurements });
        assert.equal(measurements.overflow, false, `${label} overflow`);
        assert.deepEqual(measurements.clipped, [], `${label} clipped content`);
        assert.ok(measurements.cls < .02, `${label} CLS ${measurements.cls}`);
        assert.equal(measurements.submit.tag, 'BUTTON', `${label} real submit`);
        if (width > 760) assert.ok(Math.abs(measurements.brand.width - width * (lang === 'ru' ? .55 : .5)) <= 1, `${label} desktop column ratio`);
        else {
          assert.ok(measurements.brand.height <= 295, `${label} mobile hero stays compact`);
          assert.ok(measurements.form.y < 650, `${label} mobile form is on first screen`);
        }
        if (lang === 'ru') {
          assert.equal(measurements.src, 'selected-cabin-banner.webp');
          assert.deepEqual(measurements.natural, { width: 919, height: 941 });
          assert.equal(measurements.fit, 'contain', `${label} complete uncropped banner`);
          assert.deepEqual(measurements.bannerDecoration, {
            before: 'none', after: 'none', imageBackground: 'rgba(0, 0, 0, 0)',
            imageBorder: '0px', imageRadius: '0px', imageShadow: 'none', imageBlur: 'none',
          }, `${label} no white card or pseudo-element over the approved raster`);
          assert.equal(measurements.headline, null, `${label} no duplicate slogan over raster`);
          assert.equal(await page.locator('.vx-auth-banner').count(), 1);
          assert.equal(await page.locator('.vx-auth-brand-banner :is(a,button,input,select,textarea,h1,h2,svg)').count(), 0, 'banner has no interactive or duplicate logo/text layers');
          assert.match(await page.locator('.vx-auth-banner').getAttribute('alt'), /Копируйте сделки лучших трейдеров мира/);
          if (width <= 760) assert.equal(measurements.brand.height, 250, 'Russian banner preserves compact mobile image area');
        } else {
          assert.equal(await page.locator('.vx-auth-brand-localized').count(), 1);
          assert.equal(await page.locator('.vx-auth-banner').count(), 0, `${label} embedded Russian slogan not served to other locales`);
          assert.equal(await page.locator('.vx-auth-brand h2').count(), 1, `${label} one localized headline`);
          assert.notEqual(measurements.headline.text, slogan);
          assert.ok(measurements.src.startsWith('business-class-'), `${label} existing localized photo retained`);
          if (width <= 760) assert.equal(measurements.src, 'business-class-mobile.webp');
          for (const style of measurements.overlayStyles) {
            assert.equal(style.background, 'rgba(0, 0, 0, 0)', `${label} ${style.selector} ${style.pseudo} no white backing`);
            assert.equal(style.image, 'none', `${label} no overlay image on slogan wrappers`);
            assert.equal(style.border, '0px', `${label} no panel border`);
            assert.equal(style.radius, '0px', `${label} no panel rounding`);
            assert.equal(style.shadow, 'none', `${label} no panel shadow`);
            assert.equal(style.blur, 'none', `${label} no glass backing`);
            assert.equal(style.stroke, '0px', `${label} no text outline`);
          }
        }
        assert.equal(await page.locator('h1').count(), 1, 'route form keeps the only h1');
        assert.equal(await page.locator('.vx-auth-brand :is(.vx-auth-community,.vx-auth-social,.vx-auth-avatars,.vx-auth-carousel,.vx-auth-pagination)').count(), 0, 'unwanted blocks removed from DOM');
        assert.doesNotMatch(await page.locator('.vx-auth-brand').textContent(), /Сообщество VOLTEX|Рынки\. Идеи\. Возможности\.|Карта, которая всегда с вами|TEST|DEMO|NOT TRADABLE/);
        assert.equal(await page.locator('.vx-auth-tabs a').first().getAttribute('href'), '/login?next=%2Fwallet');
        assert.equal(await page.locator('.vx-auth-tabs a').last().getAttribute('href'), '/register?next=%2Fwallet');
        assert.equal(await page.locator('input[type="email"]').count(), 1, 'one real email field');
        assert.equal(await page.locator('input[type="password"]').count(), 1, 'one real password field');
        await page.screenshot({ path: path.join(out, `${routeName}-${width}${lang === 'ru' ? '' : `-${lang}`}.png`), fullPage: true });
        await page.locator('input[type="email"]').fill('fixture@example.invalid');
        await page.locator('input[type="password"]').fill('FixtureOnly123!');
        await page.locator('.vx-auth-toggle').click();
        assert.equal(await page.locator('input[value="FixtureOnly123!"]').getAttribute('type'), 'text');
        await page.locator('.vx-auth-toggle').click();
        assert.equal(await page.locator('input[value="FixtureOnly123!"]').getAttribute('type'), 'password');
        await page.locator('.vx-auth-tabs a').nth(routeName === 'login' ? 1 : 0).click();
        await page.waitForURL(`${origin}/${routeName === 'login' ? 'register' : 'login'}?next=%2Fwallet`);
        await page.locator(routeName === 'login' ? '#reg-email' : '#login-email').waitFor();
        assert.equal(await page.locator('.vx-auth-tabs a[aria-current="page"]').count(), 1);
        assert.equal(await page.locator('.vx-auth-tabs a[aria-current="page"]').getAttribute('href'), `/${routeName === 'login' ? 'register' : 'login'}?next=%2Fwallet`);
        console.log('PASS', label, JSON.stringify({ src: measurements.src, cls: measurements.cls, overflow: measurements.overflow }));
        await ctx.close();
      }
    }
    // Single-use fixtures exercise real callbacks without creating accounts,
    // sessions or reaching a backend. Unmatched writes still fail closed.
    const credentials = { email: 'fixture@example.invalid', password: 'FixtureOnly123!' };
    const fixtures = [
      { path: '/api/v1/auth/login', request: credentials, status: 401, body: { error: 'Invalid email or password' } },
      { path: '/api/v1/auth/login', request: credentials, status: 200, body: { requires2fa: true, pendingToken: 'offline-pending-fixture' } },
      { path: '/api/v1/auth/login/2fa', request: { pendingToken: 'offline-pending-fixture', code: '000000' }, status: 401, body: { error: 'Invalid authentication code' } },
      { path: '/api/v1/auth/register', request: credentials, status: 400, body: { error: 'Registration failed' } },
    ];
    const { ctx, page } = await openContext(320, 'ru', fixtures);
    await page.goto(`${origin}/login?next=%2Fwallet`, { waitUntil: 'networkidle' });
    await waitForVisual(page);
    await page.locator('#login-email').fill(credentials.email);
    await page.locator('#login-password').fill(credentials.password);
    await page.locator('.vx-auth-submit').click();
    await page.getByRole('alert').filter({ hasText: 'Неверная почта или пароль.' }).waitFor();
    assert.equal(await page.locator('.vx-auth-submit').isEnabled(), true, 'login can retry after rejection');
    assert.equal(await page.evaluate(() => localStorage.getItem('exchange_token')), null, 'rejected login creates no session');
    report.behavior.push('offline login rejection, visible localized error and retry');
    await page.locator('.vx-auth-submit').click();
    await page.locator('#login-2fa').waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('exchange_token')), null, '2FA challenge creates no session');
    await page.locator('#login-2fa').fill('000000');
    await page.locator('.vx-auth-submit').click();
    await page.getByRole('alert').filter({ hasText: 'Код подтверждения не подошёл.' }).waitFor();
    assert.equal(await page.locator('.vx-auth-submit').isEnabled(), true, '2FA can retry after rejection');
    assert.equal(await page.evaluate(() => localStorage.getItem('exchange_token')), null, 'rejected 2FA creates no session');
    const twoFaMeasurements = await measure(page);
    assert.equal(twoFaMeasurements.overflow, false, '2FA error has no overflow');
    assert.deepEqual(twoFaMeasurements.clipped, [], '2FA error is not clipped');
    await page.screenshot({ path: path.join(out, 'login-2fa-error-320.png'), fullPage: true });
    await page.locator('.vx-auth-alt .vx-auth-forgot').click();
    await page.locator('#login-password').waitFor();
    assert.equal(await page.getByRole('alert').count(), 0, 'back from 2FA clears prior code error');
    report.behavior.push('offline 2FA challenge/rejection/retry/back, no premature session');
    await page.locator('.vx-auth-tabs a').last().click();
    await page.waitForURL(`${origin}/register?next=%2Fwallet`);
    await page.locator('#reg-email').waitFor();
    assert.equal(await page.locator('.vx-auth-submit').isDisabled(), true, 'empty registration remains disabled');
    await page.locator('#reg-email').fill(credentials.email);
    await page.locator('#reg-password').fill('short');
    assert.equal(await page.locator('.vx-auth-submit').isDisabled(), true, 'weak registration remains disabled');
    await page.locator('#reg-password').fill(credentials.password);
    assert.equal(await page.locator('.vx-auth-submit').isEnabled(), true, 'valid registration becomes enabled');
    await page.locator('.vx-auth-submit').click();
    await page.getByRole('alert').filter({ hasText: 'Не удалось создать аккаунт.' }).waitFor();
    assert.equal(await page.locator('.vx-auth-submit').isEnabled(), true, 'registration can retry after rejection');
    assert.equal(await page.evaluate(() => localStorage.getItem('exchange_token')), null, 'rejected registration creates no session');
    assert.equal(new URL(page.url()).search, '?next=%2Fwallet', 'return target survives rejected auth');
    const registerMeasurements = await measure(page);
    assert.equal(registerMeasurements.overflow, false, 'registration error has no overflow');
    assert.deepEqual(registerMeasurements.clipped, [], 'registration error is not clipped');
    await page.screenshot({ path: path.join(out, 'register-error-320.png'), fullPage: true });
    report.behavior.push('registration validity, offline rejection, visible error and retry');
    assert.equal(fixtures.length, 0, 'all explicit fixtures consumed once');
    await ctx.close();
    for (const key of ['errors', 'failed', 'denied', 'writes']) assert.deepEqual(report[key], [], key);
    report.result = 'PASS';
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
