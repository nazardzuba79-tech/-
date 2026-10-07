/** Built-bundle, offline-only visual QA. Never forwards an API request or write. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const dist = path.resolve('frontend/dist');
const out = path.resolve(process.env.QA_OUT || 'output/auth-business-class');
const slogan = 'Копируйте сделки лучших трейдеров мира.';
const report = { head: process.env.QA_HEAD_SHA || process.env.GITHUB_SHA || null, fixtureOnly: true, cases: [], responsive: [], behavior: [], fixtureRequests: [], expectedFixtureErrors: [], errors: [], failed: [], denied: [], writes: [], result: 'FAIL' };
// Coordinates in the unchanged 919x941 source, not the <img> element box.
const protectedRasterRegions = {
  logo: [50, 35, 225, 75], slogan: [50, 120, 540, 212],
  faceAndHair: [440, 150, 865, 540], phoneAndHand: [245, 450, 395, 665],
  cardAndHand: [495, 665, 805, 875], blackCard: [145, 737, 285, 798],
};
fs.mkdirSync(out, { recursive: true });
const app = express();
app.use('/api', (_req, res) => res.status(405).end());
app.use(express.static(dist));
app.use((_req, res) => res.sendFile(path.join(dist, 'index.html')));
(async () => {
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  async function openContext(width, lang = 'ru', fixtures = [], height = width > 760 ? 900 : 844) {
    const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', deviceScaleFactor: 1 });
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
    await page.evaluate(() => Promise.all([...new Set([...document.querySelectorAll('.vx-auth-avatar')].map(node => getComputedStyle(node).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1]).filter(Boolean))].map(src => new Promise((resolve, reject) => {
      const avatar = new Image();
      avatar.onload = () => avatar.naturalWidth === 432 && avatar.naturalHeight === 144 ? resolve() : reject(new Error('Unexpected local avatar sprite dimensions'));
      avatar.onerror = () => reject(new Error('Local avatar sprite did not load'));
      avatar.src = src;
    }))));
    await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
  }
  async function measure(page) {
    return page.evaluate(() => {
      const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
      const brand = document.querySelector('.vx-auth-brand');
      const img = brand.querySelector('img');
      const imageStyle = getComputedStyle(img);
      const visible = node => !!node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
      const brandVisible = visible(brand);
      const decoration = node => {
        const style = getComputedStyle(node);
        return { background: style.backgroundColor, image: style.backgroundImage, border: style.borderWidth, radius: style.borderRadius, shadow: style.boxShadow, blur: style.backdropFilter };
      };
      const extras = [...document.querySelectorAll('.vx-auth-extras')].filter(visible).map(node => ({
        ...rect(node), inBrand: !!node.closest('.vx-auth-brand'), text: node.textContent.trim(),
        wrappers: [node, ...node.querySelectorAll('.vx-auth-community,.vx-auth-community-copy,.vx-auth-avatars,.vx-auth-card-caption')].map(child => ({ selector: child.className, ...decoration(child) })),
        community: rect(node.querySelector('.vx-auth-community')),
        title: node.querySelector('.vx-auth-community-copy strong').textContent.trim(),
        subtitle: node.querySelector('.vx-auth-community-copy span').textContent.trim(),
        caption: { ...rect(node.querySelector('.vx-auth-card-caption')), number: node.querySelector('.vx-auth-card-number').textContent.trim(), label: node.querySelector('.vx-auth-card-label').textContent.trim() },
        avatars: [...node.querySelectorAll('.vx-auth-avatar')].map(avatar => ({ ...rect(avatar), image: getComputedStyle(avatar).backgroundImage, position: getComputedStyle(avatar).backgroundPosition, size: getComputedStyle(avatar).backgroundSize, radius: getComputedStyle(avatar).borderRadius })),
        avatarGroupHidden: node.querySelector('.vx-auth-avatars').getAttribute('aria-hidden'),
        line: { ...rect(node.querySelector('.vx-auth-card-line')), hidden: node.querySelector('.vx-auth-card-line').getAttribute('aria-hidden') },
        ink: [...node.querySelectorAll('.vx-auth-community,.vx-auth-card-caption')].map(rect),
      }));
      // object-fit:contain can leave bands INSIDE a full-size <img>. Measure the
      // actual painted raster, including its object-position, rather than only
      // getBoundingClientRect(). This deliberately rejects the former defect.
      let paintedRaster = null;
      if (brandVisible) {
        const imageRect = img.getBoundingClientRect();
        const px = value => parseFloat(value) || 0;
        const box = {
          x: imageRect.x + px(imageStyle.borderLeftWidth) + px(imageStyle.paddingLeft),
          y: imageRect.y + px(imageStyle.borderTopWidth) + px(imageStyle.paddingTop),
          width: imageRect.width - px(imageStyle.borderLeftWidth) - px(imageStyle.borderRightWidth) - px(imageStyle.paddingLeft) - px(imageStyle.paddingRight),
          height: imageRect.height - px(imageStyle.borderTopWidth) - px(imageStyle.borderBottomWidth) - px(imageStyle.paddingTop) - px(imageStyle.paddingBottom),
        };
        const contain = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
        const scale = imageStyle.objectFit === 'cover' ? Math.max(box.width / img.naturalWidth, box.height / img.naturalHeight)
          : imageStyle.objectFit === 'none' ? 1 : imageStyle.objectFit === 'scale-down' ? Math.min(1, contain) : contain;
        const width = imageStyle.objectFit === 'fill' ? box.width : img.naturalWidth * scale;
        const height = imageStyle.objectFit === 'fill' ? box.height : img.naturalHeight * scale;
        const position = imageStyle.objectPosition.split(/\s+/);
        const offset = (value, spare) => value.endsWith('%') ? spare * parseFloat(value) / 100 : parseFloat(value);
        const x = box.x + offset(position[0], box.width - width);
        const y = box.y + offset(position[1] || position[0], box.height - height);
        paintedRaster = { x, y, width, height, right: x + width, bottom: y + height, scaleX: width / img.naturalWidth, scaleY: height / img.naturalHeight };
      }
      const headline = brand.querySelector('.vx-auth-hero h2');
      const overlayStyles = [...brand.querySelectorAll('.vx-auth-brand-inner,.vx-auth-brand-head,.vx-auth-hero,.vx-auth-hero h2')].flatMap(node => [null, '::before', '::after'].map(pseudo => {
        const style = getComputedStyle(node, pseudo);
        return { selector: node.className || node.tagName, pseudo, content: style.content, background: style.backgroundColor, image: style.backgroundImage, border: style.borderWidth, radius: style.borderRadius, shadow: style.boxShadow, blur: style.backdropFilter, stroke: style.webkitTextStrokeWidth };
      })).filter(style => !style.pseudo || !['none', 'normal'].includes(style.content));
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        viewport: { width: innerWidth, height: innerHeight },
        pageHeight: document.documentElement.scrollHeight,
        brandVisible, paintedRaster, extras,
        body: rect(document.querySelector('.vx-auth-body')),
        footer: rect(document.querySelector('.vx-auth-foot')),
        support: rect(document.querySelector('.vx-auth-support')),
        security: rect(document.querySelector('.vx-auth-security')),
        brand: rect(brand), form: rect(document.querySelector('.vx-auth-form')), photo: rect(img),
        src: img.currentSrc.split('/').pop(), natural: { width: img.naturalWidth, height: img.naturalHeight }, fit: getComputedStyle(img).objectFit,
        bannerDecoration: {
          before: getComputedStyle(brand, '::before').content,
          beforeImage: getComputedStyle(brand, '::before').backgroundImage,
          beforeHeight: getComputedStyle(brand, '::before').height,
          beforeBackground: getComputedStyle(brand, '::before').backgroundColor,
          after: getComputedStyle(brand, '::after').content,
          imageBackground: getComputedStyle(img).backgroundColor,
          imageBorder: getComputedStyle(img).borderWidth,
          imageRadius: getComputedStyle(img).borderRadius,
          imageShadow: getComputedStyle(img).boxShadow,
          imageBlur: getComputedStyle(img).backdropFilter,
        },
        headline: headline ? { ...rect(headline), text: headline.textContent.trim(), lines: Math.round(headline.getBoundingClientRect().height / parseFloat(getComputedStyle(headline).lineHeight)) } : null,
        overlayStyles, cls: window.__authCLS,
        clipped: [...document.querySelectorAll('.vx-auth h1,.vx-auth h2,.vx-auth p,.vx-auth input,.vx-auth button,.vx-auth-tabs a,.vx-auth-community-copy strong,.vx-auth-community-copy > span,.vx-auth-card-label')].filter(n => n.clientWidth && n.scrollWidth > n.clientWidth + 1).map(n => n.className),
        submit: { tag: document.querySelector('.vx-auth-submit').tagName, color: getComputedStyle(document.querySelector('.vx-auth-submit')).backgroundColor },
      };
    });
  }
  async function assertExtras(page, measurements, label, lang = 'ru') {
    const { extras, brand, paintedRaster: painted, viewport } = measurements;
    assert.equal(extras.length, 1, `${label} exactly one visible community/caption pair`);
    const block = extras[0];
    assert.equal(await page.locator('.vx-auth-extras :is(a,button,input,select,textarea)').count(), 0, `${label} restored blocks are static, not a carousel or control`);
    assert.equal(await page.locator('.vx-auth-community-badge,.vx-auth-carousel,.vx-auth-pagination').count(), 0, `${label} no unsupported counter badge or carousel`);
    assert.doesNotMatch(block.text, /1[,.]2|млн|million|[0-9]\s*[Mm]\+|TEST|DEMO|NOT TRADABLE/, `${label} no unsupported investor count or new advertising labels`);
    assert.equal(block.avatars.length, 3, `${label} three decorative avatars`);
    assert.equal(block.avatarGroupHidden, 'true', `${label} decorative faces are not presented as client testimonials`);
    const positions = new Set();
    for (const avatar of block.avatars) {
      assert.match(avatar.image, /\/auth\/community-v4\.webp["']?\)/, `${label} existing local avatar sprite`);
      assert.equal(avatar.size, '300% 100%', `${label} three distinct sprite tiles`);
      assert.equal(avatar.radius, '50%', `${label} circular avatar`);
      assert.ok(Math.abs(avatar.width - avatar.height) < 1, `${label} undistorted avatar tile`);
      positions.add(avatar.position);
    }
    assert.equal(positions.size, 3, `${label} each existing face has its own sprite position`);
    assert.ok(block.avatars[1].x < block.avatars[0].right && block.avatars[2].x < block.avatars[1].right, `${label} compact overlapping avatar row`);
    assert.equal(block.caption.number, '01', `${label} static card caption number`);
    assert.ok(block.caption.label.length > 5, `${label} localized card caption remains populated`);
    assert.equal(block.line.hidden, 'true', `${label} caption rule is decorative`);
    assert.ok(block.line.width >= 16 && block.line.height <= 2, `${label} short thin caption rule`);
    assert.ok(block.caption.y >= block.community.bottom, `${label} card caption follows community`);
    assert.ok(block.x >= -1 && block.right <= viewport.width + 1, `${label} restored blocks fit viewport`);
    for (const style of block.wrappers) {
      assert.equal(style.background, 'rgba(0, 0, 0, 0)', `${label} ${style.selector} no colored/white card`);
      assert.equal(style.image, 'none', `${label} ${style.selector} no background panel image`);
      assert.equal(style.border, '0px', `${label} ${style.selector} no common border`);
      assert.equal(style.radius, '0px', `${label} ${style.selector} no rounded card`);
      assert.equal(style.shadow, 'none', `${label} ${style.selector} no raised card shadow`);
      assert.equal(style.blur, 'none', `${label} ${style.selector} no glass card`);
    }
    if (lang === 'ru') {
      assert.equal(block.title, 'Сообщество VOLTEX');
      assert.equal(block.subtitle, 'Рынки. Идеи. Возможности.');
      assert.equal(block.caption.label.toLocaleLowerCase('ru'), 'карта, которая всегда с вами');
    } else {
      assert.doesNotMatch(block.text, /[А-Яа-яЁё]/, `${label} no Russian copy in another locale`);
      assert.match(block.title, /VOLTEX/, `${label} localized community heading retains the brand`);
      assert.doesNotMatch(block.text, /authShell\./, `${label} no untranslated localization keys`);
    }
    if (block.inBrand) {
      assert.equal(measurements.brandVisible, true, `${label} desktop blocks are on a visible photo`);
      assert.ok(block.x >= brand.x - 1 && block.right <= brand.right + 1 && block.y >= brand.y && block.bottom <= brand.bottom + 1, `${label} both blocks remain within photo`);
      assert.ok(block.y > brand.y + brand.height * .6, `${label} both blocks use the lower photo area`);
      if (lang === 'ru') {
        for (const [name, [left, top, right, bottom]] of Object.entries(protectedRasterRegions)) {
          const region = { x: painted.x + left * painted.scaleX, y: painted.y + top * painted.scaleY, right: painted.x + right * painted.scaleX, bottom: painted.y + bottom * painted.scaleY };
          for (const ink of block.ink) {
            const overlapX = Math.min(ink.right, region.right) - Math.max(ink.x, region.x);
            const overlapY = Math.min(ink.bottom, region.bottom) - Math.max(ink.y, region.y);
            assert.ok(overlapX <= 1 || overlapY <= 1, `${label} restored copy does not cover ${name}: ${JSON.stringify({ ink, region })}`);
          }
        }
      }
    } else {
      assert.ok(block.y >= measurements.form.bottom && block.y >= measurements.support.bottom && block.y >= measurements.security.bottom, `${label} compact blocks follow the form, support and security`);
      assert.ok(block.bottom <= measurements.footer.y + 1, `${label} compact blocks do not overlap legal links`);
      assert.ok(block.height <= 165, `${label} compact extras never become a tall promotion`);
      assert.equal(await page.locator('.vx-auth-work > .vx-auth-extras').isVisible(), true, `${label} compact extras stay in ordinary document flow`);
    }
  }
  async function assertRussianGeometry(page, measurements, label) {
    const { viewport, brand, paintedRaster: painted } = measurements;
    const scroll = await page.evaluate(() => ({ page: window.scrollY, work: document.querySelector('.vx-auth-work').scrollTop }));
    assert.equal(measurements.overflow, false, `${label} no horizontal overflow`);
    assert.deepEqual(measurements.clipped, [], `${label} no clipped form text or controls`);
    await assertExtras(page, measurements, label);
    const compact = viewport.width <= 760 || viewport.width / viewport.height <= 1.5;
    if (compact) {
      assert.equal(measurements.brandVisible, false, `${label} compact raster is absent, not a tiny letterboxed poster`);
      assert.equal(brand.height, 0, `${label} hidden banner reserves no height`);
      const logo = page.locator('.vx-auth-head .vx-auth-compact-logo');
      assert.equal(await logo.isVisible(), true, `${label} original VOLTEX logo remains visible`);
      assert.equal((await logo.textContent()).replace(/\s+/g, ''), 'VOLTEX', `${label} existing full wordmark, not only a new icon`);
      const maxFormStart = viewport.width <= 760 ? 470 : viewport.height * .55;
      assert.ok(measurements.form.y < maxFormStart, `${label} form follows header without a tall photo block`);
    } else {
      assert.equal(measurements.brandVisible, true, `${label} desktop photo remains visible`);
      assert.ok(painted && Object.values(painted).every(Number.isFinite), `${label} measurable raster paint bounds`);
      assert.ok(Math.abs(painted.scaleX - painted.scaleY) < .0001, `${label} photo is not distorted`);
      for (const [edge, gap] of Object.entries({ left: painted.x - brand.x, top: painted.y - brand.y, right: brand.right - painted.right, bottom: brand.bottom - painted.bottom })) {
        assert.ok(gap <= 1, `${label} unpainted ${edge} band: ${gap.toFixed(2)}px`);
      }
      assert.ok(Math.abs(brand.y) <= 1 && Math.abs(brand.bottom - viewport.height) <= 1, `${label} photo covers the full left viewport, not a shorter panel`);
      assert.ok(measurements.pageHeight <= viewport.height + 1, `${label} form does not create an empty left column below the photo`);
      assert.ok(measurements.form.width >= 320, `${label} form keeps a readable desktop width`);
      for (const [name, [left, top, right, bottom]] of Object.entries(protectedRasterRegions)) {
        const projection = { left: painted.x + left * painted.scaleX, top: painted.y + top * painted.scaleY, right: painted.x + right * painted.scaleX, bottom: painted.y + bottom * painted.scaleY };
        assert.ok(projection.left >= brand.x - 1 && projection.top >= brand.y - 1 && projection.right <= brand.right + 1 && projection.bottom <= brand.bottom + 1, `${label} important ${name} pixels remain visible: ${JSON.stringify(projection)}`);
      }
    }
    await page.locator('.vx-auth-submit').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('.vx-auth-submit').isVisible(), true, `${label} submit remains reachable`);
    const button = await page.locator('.vx-auth-submit').boundingBox();
    assert.ok(button.x >= 0 && button.x + button.width <= viewport.width + 1, `${label} submit fits viewport`);
    assert.ok(button.y >= -1 && button.y + button.height <= viewport.height + 1, `${label} submit can be fully reached by scrolling`);
    await page.locator('.vx-auth-foot').scrollIntoViewIfNeeded();
    const footer = await page.locator('.vx-auth-foot').boundingBox();
    assert.ok(footer.y >= -1 && footer.y + footer.height <= viewport.height + 1, `${label} existing legal links remain reachable`);
    await page.evaluate(previous => { window.scrollTo(0, previous.page); document.querySelector('.vx-auth-work').scrollTop = previous.work; }, scroll);
  }
  try {
    const matrix = [
      ...[[1920, 1080], [1440, 900], [1366, 768], [430, 844], [390, 844], [360, 844], [320, 844]].map(([width, height]) => ({ width, height, lang: 'ru' })),
      ...['en', 'zh', 'es', 'hi', 'ja', 'ko'].flatMap(lang => [1440, 320].map(width => ({ width, height: width > 760 ? 900 : 844, lang }))),
    ];
    for (const { width, height, lang } of matrix) {
      for (const routeName of ['login', 'register']) {
        const { ctx, page } = await openContext(width, lang, [], height);
        await page.goto(`${origin}/${routeName}?next=%2Fwallet`, { waitUntil: 'networkidle' });
        await waitForVisual(page);
        const measurements = await measure(page);
        const label = `${lang} ${routeName} ${width}x${height}`;
        report.cases.push({ width, height, lang, route: routeName, ...measurements });
        assert.equal(measurements.overflow, false, `${label} overflow`);
        assert.deepEqual(measurements.clipped, [], `${label} clipped content`);
        assert.ok(measurements.cls < .02, `${label} CLS ${measurements.cls}`);
        assert.equal(measurements.submit.tag, 'BUTTON', `${label} real submit`);
        if (lang !== 'ru' && width > 760) assert.ok(Math.abs(measurements.brand.width - width * .5) <= 1, `${label} existing localized desktop column ratio`);
        else if (lang !== 'ru') {
          assert.ok(measurements.brand.height <= 295, `${label} mobile hero stays compact`);
          assert.ok(measurements.form.y < 650, `${label} mobile form is on first screen`);
        }
        if (lang === 'ru') {
          assert.equal(measurements.src, 'selected-cabin-banner.webp');
          assert.deepEqual(measurements.natural, { width: 919, height: 941 });
          await assertRussianGeometry(page, measurements, label);
          const { before, beforeImage, beforeHeight, beforeBackground, ...imageDecoration } = measurements.bannerDecoration;
          assert.deepEqual(imageDecoration, {
            after: 'none', imageBackground: 'rgba(0, 0, 0, 0)',
            imageBorder: '0px', imageRadius: '0px', imageShadow: 'none', imageBlur: 'none',
          }, `${label} no white card or frame over the approved raster`);
          if (measurements.brandVisible && before !== 'none') {
            assert.equal(beforeBackground, 'rgba(0, 0, 0, 0)', `${label} contrast layer has no rectangular fill`);
            assert.match(beforeImage, /^radial-gradient\(/, `${label} only a soft localized contrast gradient`);
            assert.ok(parseFloat(beforeHeight) <= measurements.brand.height * .26, `${label} contrast remains local to the bottom, not the whole photograph`);
          }
          assert.equal(measurements.headline, null, `${label} no duplicate slogan over raster`);
          assert.equal(await page.locator('.vx-auth-banner').count(), 1);
          assert.equal(await page.locator('.vx-auth-brand-banner :is(a,button,input,select,textarea,h1,h2,svg)').count(), 0, 'banner has no interactive or duplicate logo/text layers');
          assert.match(await page.locator('.vx-auth-banner').getAttribute('alt'), /Копируйте сделки лучших трейдеров мира/);
        } else {
          await assertExtras(page, measurements, label, lang);
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
        assert.doesNotMatch(await page.locator('.vx-auth-brand').textContent(), /TEST|DEMO|NOT TRADABLE/);
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
    for (const routeName of ['login', 'register']) {
      const { ctx, page } = await openContext(1440, 'ru', [], 900);
      await page.goto(`${origin}/${routeName}?next=%2Fwallet`, { waitUntil: 'networkidle' });
      await waitForVisual(page);
      // Resize the SAME document, including crossing the compact breakpoint.
      for (const height of [700, 1000, 1200, 900]) {
        await page.setViewportSize({ width: 1440, height });
        await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.vx-auth-work').scrollTop = 0; });
        await waitForVisual(page);
        const measurements = await measure(page);
        await assertRussianGeometry(page, measurements, `${routeName} live resize 1440x${height}`);
        report.responsive.push({ kind: 'live-window-height-resize', route: routeName, ...measurements });
        await page.screenshot({ path: path.join(out, `${routeName}-resize-1440x${height}.png`), fullPage: true });
      }
      const cdp = await ctx.newCDPSession(page);
      // Browser zoom reduces the CSS layout viewport and increases device pixel
      // ratio. Reproduce that reflow deterministically via CDP, NOT CSS zoom or
      // pinch scale. This is recorded honestly as an equivalent, not a claim
      // that an automation API clicked Chrome's actual toolbar zoom controls.
      for (const factor of [1.5, 2]) {
        const width = Math.round(1440 / factor), height = Math.round(900 / factor);
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: factor, mobile: false });
        await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.vx-auth-work').scrollTop = 0; });
        await waitForVisual(page);
        const measurements = await measure(page);
        assert.deepEqual(measurements.viewport, { width, height }, 'zoom equivalent actually changes CSS layout viewport');
        await assertRussianGeometry(page, measurements, `${routeName} ${factor * 100}% browser-zoom reflow equivalent`);
        report.responsive.push({ kind: 'browser-zoom-reflow-equivalent', zoom: factor, physicalViewport: { width: 1440, height: 900 }, route: routeName, ...measurements });
        await page.screenshot({ path: path.join(out, `${routeName}-zoom-equivalent-${factor * 100}.png`), fullPage: true });
      }
      await cdp.detach();
      await ctx.close();
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
    await assertRussianGeometry(page, await measure(page), '320px login validation error');
    await page.setViewportSize({ width: 1440, height: 700 });
    await assertRussianGeometry(page, await measure(page), 'short desktop login validation error');
    await page.setViewportSize({ width: 320, height: 844 });
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
    await assertRussianGeometry(page, twoFaMeasurements, '320px 2FA validation error');
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
    await assertRussianGeometry(page, registerMeasurements, '320px registration validation error');
    await page.screenshot({ path: path.join(out, 'register-error-320.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 700 });
    await assertRussianGeometry(page, await measure(page), 'short desktop registration validation error');
    await page.screenshot({ path: path.join(out, 'register-error-1440x700.png'), fullPage: true });
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
