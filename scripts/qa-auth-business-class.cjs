/** Built-bundle, offline-only visual QA. Never forwards an API request or write. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const dist = path.resolve('frontend/dist');
const out = path.resolve(process.env.QA_OUT || 'output/auth-business-class');
const slogan = 'Копируйте сделки лучших трейдеров мира.';
const report = { head: process.env.QA_HEAD_SHA || process.env.GITHUB_SHA || null, fixtureOnly: true, cases: [], responsive: [], details: [], behavior: [], fixtureRequests: [], expectedFixtureErrors: [], errors: [], failed: [], denied: [], writes: [], result: 'FAIL' };
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
  async function openContext(width, lang = 'ru', fixtures = [], height = width > 760 ? 900 : 844, deviceScaleFactor = 1) {
    const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', deviceScaleFactor });
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
      if (url.pathname.endsWith('/auth/community-v4.webp')) {
        report.denied.push(`Removed portrait asset requested: ${url.pathname}`);
        return route.abort();
      }
      if (req.resourceType() === 'image' && !/^\/auth\/(?:selected-cabin-banner|business-class-(?:960|1440|mobile))\.webp$/.test(url.pathname)) {
        report.denied.push(`Unexpected image asset requested: ${url.pathname}`);
        return route.abort();
      }
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
      const textLayout = node => {
        const range = document.createRange();
        // Count painted text lines, excluding inline-block wrapper boxes whose
        // line-height can put their top a pixel above the contained glyphs.
        const textNodes = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        const rects = [];
        while (textNodes.nextNode()) {
          range.selectNodeContents(textNodes.currentNode);
          rects.push(...range.getClientRects());
        }
        const style = getComputedStyle(node);
        return { ...rect(node), lines: new Set(rects.filter(r => r.width > 0).map(r => Math.round(r.y))).size, fontSize: parseFloat(style.fontSize), fontWeight: Number(style.fontWeight), color: style.color };
      };
      const extras = [...document.querySelectorAll('.vx-auth-extras')].filter(visible).map(node => ({
        ...rect(node), inBrand: !!node.closest('.vx-auth-brand'), text: node.textContent.trim(),
        wrappers: [node, ...node.querySelectorAll('.vx-auth-community,.vx-auth-community-copy,.vx-auth-currency-sample,.vx-auth-currencies,.vx-auth-currency-more,.vx-auth-card-caption')].map(child => ({ selector: child.className, ...decoration(child) })),
        community: rect(node.querySelector('.vx-auth-community')),
        title: node.querySelector('.vx-auth-community-copy strong').textContent.trim(),
        subtitle: node.querySelector('.vx-auth-community-copy > span').textContent.trim(),
        titleLayout: textLayout(node.querySelector('.vx-auth-community-copy strong')),
        subtitleLayout: textLayout(node.querySelector('.vx-auth-community-copy > span')),
        fee: { ...textLayout(node.querySelector('.vx-auth-card-fee')), text: node.querySelector('.vx-auth-card-fee').textContent.trim(), whiteSpace: getComputedStyle(node.querySelector('.vx-auth-card-fee')).whiteSpace },
        copyOpacity: (() => { const values = []; let parent = node.querySelector('.vx-auth-community-copy'); while (parent) { values.push(getComputedStyle(parent).opacity); parent = parent.parentElement; } return values; })(),
        amounts: [...node.querySelectorAll('.vx-auth-currency-amount')].map(amount => ({ ...textLayout(amount), text: amount.textContent.trim(), whiteSpace: getComputedStyle(amount).whiteSpace })),
        copyLayout: rect(node.querySelector('.vx-auth-community-copy')),
        currencyLayout: rect(node.querySelector('.vx-auth-currencies')),
        sampleLayout: rect(node.querySelector('.vx-auth-currency-sample')),
        moreLayout: { ...textLayout(node.querySelector('.vx-auth-currency-more')), text: node.querySelector('.vx-auth-currency-more').textContent.trim(), hidden: !!node.querySelector('.vx-auth-currency-more').closest('[aria-hidden="true"]') },
        currencyWrap: getComputedStyle(node.querySelector('.vx-auth-currencies')).flexWrap,
        caption: { ...rect(node.querySelector('.vx-auth-card-caption')), number: node.querySelector('.vx-auth-card-number').textContent.trim(), label: node.querySelector('.vx-auth-card-label').textContent.trim() },
        currencies: [...node.querySelectorAll('.vx-auth-currency')].map(currency => {
          const svg = currency.querySelector('svg');
          const style = svg && getComputedStyle(svg);
          const circleStyle = getComputedStyle(currency);
          return {
            ...rect(currency), code: currency.dataset.currency,
            image: circleStyle.backgroundImage, radius: circleStyle.borderRadius, shadow: circleStyle.boxShadow, borderColor: circleStyle.borderLeftColor, zIndex: circleStyle.zIndex,
            overflow: circleStyle.overflow, border: parseFloat(circleStyle.borderLeftWidth),
            svgCount: currency.querySelectorAll('svg').length,
            svg: svg ? { ...rect(svg), viewBox: svg.getAttribute('viewBox'), hidden: svg.getAttribute('aria-hidden'), focusable: svg.getAttribute('focusable'),
              display: style.display, visibility: style.visibility, opacity: style.opacity,
              shapes: [...svg.querySelectorAll('path,circle')].map(shape => {
                const shapeStyle = getComputedStyle(shape);
                return { tag: shape.tagName, geometry: shape.tagName === 'path' ? shape.getAttribute('d') : [shape.getAttribute('cx'), shape.getAttribute('cy'), shape.getAttribute('r')].join(','), fill: shapeStyle.fill, display: shapeStyle.display, visibility: shapeStyle.visibility, opacity: shapeStyle.opacity };
              }),
              children: [...svg.children].map(child => child.tagName),
            } : null,
          };
        }),
        currencyGroupHidden: node.querySelector('.vx-auth-currencies').getAttribute('aria-hidden'),
        line: { ...rect(node.querySelector('.vx-auth-card-line')), hidden: node.querySelector('.vx-auth-card-line').getAttribute('aria-hidden') },
        // Test actual painted glyphs/flags, not the unused right side of a
        // multi-line flex container. Keep every protected photo-region check.
        ink: (() => {
          const ink = [...node.querySelectorAll('.vx-auth-currencies,.vx-auth-card-line')].map(rect);
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
          const range = document.createRange();
          while (walker.nextNode()) {
            if (!walker.currentNode.textContent.trim()) continue;
            range.selectNodeContents(walker.currentNode);
            ink.push(...[...range.getClientRects()].filter(r => r.width > 0).map(r => ({ x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height })));
          }
          return ink;
        })(),
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
    assert.equal(await page.locator('.vx-auth-extras :is(a,button,input,select,textarea,[tabindex],img,image,use,foreignObject,script)').count(), 0, `${label} restored blocks are static local SVGs, not images, linked content or controls`);
    assert.equal(await page.locator('.vx-auth-community-badge,.vx-auth-carousel,.vx-auth-pagination').count(), 0, `${label} no unsupported counter badge or carousel`);
    assert.equal(await page.locator('.vx-auth-avatar,.vx-auth-avatars').count(), 0, `${label} portraits and their old wrappers are removed`);
    assert.doesNotMatch(block.text, /1[,.]2|млн|million|[0-9]\s*[Mm]\+|TEST|DEMO|NOT TRADABLE/, `${label} no unsupported investor count or new advertising labels`);
    assert.deepEqual(block.subtitle.match(/\d+\+?/g), ['22+', '70+'], `${label} exact fiat/crypto counts, not an age or investor statistic`);
    assert.equal(block.amounts.length, 2, `${label} fiat and crypto amounts each have one text group`);
    const [fiatCaption, cryptoCaption] = block.subtitle.split(' · ');
    assert.deepEqual(block.amounts.map(amount => amount.text), [`${fiatCaption} ·`, cryptoCaption], `${label} separator stays with the fiat amount, never starts the crypto line`);
    for (const amount of block.amounts) {
      assert.equal(amount.lines, 1, `${label} count and currency label never split across lines`);
      assert.equal(amount.whiteSpace, 'nowrap', `${label} each complete amount stays together`);
      assert.ok(amount.x >= block.copyLayout.x - 1 && amount.right <= block.copyLayout.right + 1, `${label} complete amount fits the available copy width`);
    }
    assert.doesNotMatch(block.title, /[.。]$/, `${label} no trailing title period`);
    assert.equal(block.fee.lines, 1, `${label} VOLTEX fee is one complete phrase`);
    assert.equal(block.fee.whiteSpace, 'nowrap', `${label} commission phrase never splits`);
    assert.ok(block.fee.text.includes('0%') && block.fee.text.includes('VOLTEX'), `${label} fee explicitly belongs to VOLTEX`);
    assert.ok(block.fee.x >= block.copyLayout.x - 1 && block.fee.right <= block.copyLayout.right + 1, `${label} entire fee phrase fits`);
    assert.ok(block.copyOpacity.every(value => value === '1'), `${label} no faded copy or ancestors`);
    if (lang === 'ru') assert.equal(block.title, 'Платите и снимайте наличные — 0% комиссии VOLTEX');
    assert.doesNotMatch(block.subtitle, /[.。]$/, `${label} no trailing subtitle period`);
    const captionGap = block.caption.y - block.community.bottom;
    assert.ok(captionGap >= 20 && captionGap <= 24, `${label} caption has a separate 20–24px gap: ${captionGap}`);
    const textGap = block.subtitleLayout.y - block.titleLayout.bottom;
    assert.ok(textGap >= 5 && textGap <= 6, `${label} two text rows have 5–6px spacing: ${textGap}`);
    assert.equal(block.moreLayout.hidden, false, `${label} partial-list explanation is available to assistive technology`);
    assert.ok(block.moreLayout.text.length > 0, `${label} visible explanation makes clear these are only examples`);
    assert.ok(block.moreLayout.fontSize >= 12, `${label} partial-list explanation remains readable`);
    assert.ok(block.moreLayout.x >= block.sampleLayout.x - 1 && block.moreLayout.right <= block.sampleLayout.right + 1, `${label} explanation fits its sample group`);
    if (viewport.width <= 760) {
      const currencyGap = block.moreLayout.x - block.currencyLayout.right;
      assert.ok(currencyGap >= 10 && currencyGap <= 14, `${label} compact explanation has 10–14px breathing room: ${currencyGap}`);
      assert.ok(Math.abs(block.currencyLayout.y + block.currencyLayout.height / 2 - block.moreLayout.y - block.moreLayout.height / 2) <= 1, `${label} compact explanation is centered beside the flags`);
      assert.ok(block.moreLayout.lines <= 2, `${label} localized compact explanation needs at most two lines`);
      assert.ok(block.copyLayout.y - block.sampleLayout.bottom >= 10 && block.copyLayout.y - block.sampleLayout.bottom <= 14, `${label} compact copy follows the sample with an even gap`);
      assert.ok(Math.abs(block.copyLayout.x - block.sampleLayout.x) <= 1, `${label} compact sample and copy align left`);
    } else {
      const currencyGap = block.copyLayout.x - block.sampleLayout.right;
      assert.ok(currencyGap >= 12 && currencyGap <= 16, `${label} sample has 12–16px breathing room from the copy: ${currencyGap}`);
      assert.ok(Math.abs(block.sampleLayout.y + block.sampleLayout.height / 2 - block.copyLayout.y - block.copyLayout.height / 2) <= 1, `${label} sample is vertically centered on the text`);
      assert.ok(block.moreLayout.y - block.currencyLayout.bottom >= 5 && block.moreLayout.y - block.currencyLayout.bottom <= 7, `${label} desktop explanation is 5–7px below the flags`);
      assert.equal(block.moreLayout.lines, 1, `${label} desktop explanation occupies one line`);
    }
    assert.ok(block.titleLayout.fontWeight >= 500 && block.titleLayout.fontWeight <= 600, `${label} medium/semibold main row`);
    assert.equal(block.subtitleLayout.fontWeight, 400, `${label} ordinary-weight second row`);
    assert.equal(block.titleLayout.fontSize, viewport.width <= 1399 || viewport.height <= 820 ? 16 : 17, `${label} title grows exactly one CSS pixel`);
    assert.equal(block.subtitleLayout.fontSize, viewport.width <= 1399 || viewport.height <= 820 ? 13 : 14, `${label} subtitle retains its readable scale`);
    assert.equal(block.titleLayout.color, 'rgb(18, 58, 51)', `${label} existing dark green`);
    assert.equal(block.subtitleLayout.color, 'rgb(13, 51, 45)', `${label} subtitle has a stronger opaque dark-green contrast`);
    if (block.inBrand && viewport.width >= 1366 && viewport.height >= 768) {
      assert.ok(block.titleLayout.lines <= 3, `${label} complete desktop title wraps naturally`);
      assert.ok(block.subtitleLayout.lines <= 2, `${label} complete subtitle fits without shrinking`);
    }
    assert.deepEqual(block.currencies.map(currency => currency.code), ['EUR', 'CHF', 'JPY', 'USD', 'CNY', 'RUB'], `${label} exactly six supported currency examples in the agreed order`);
    assert.equal(block.currencyGroupHidden, 'true', `${label} currency row is decorative, not controls or statistics`);
    assert.equal(block.currencyWrap, 'nowrap', `${label} six flags always stay in one horizontal row`);
    const flagColors = {
      EUR: ['rgb(0, 51, 153)', 'rgb(255, 204, 0)'],
      CHF: ['rgb(255, 0, 0)', 'rgb(255, 255, 255)'],
      JPY: ['rgb(255, 255, 255)', 'rgb(216, 0, 39)'],
      RUB: ['rgb(255, 255, 255)', 'rgb(0, 57, 166)', 'rgb(213, 43, 30)'],
      USD: ['rgb(255, 255, 255)', 'rgb(216, 0, 39)', 'rgb(46, 82, 178)'],
      CNY: ['rgb(216, 0, 39)', 'rgb(255, 218, 68)'],
    };
    const paths = new Set();
    for (const currency of block.currencies) {
      assert.equal(currency.image, 'none', `${label} flags use inline SVG, not image backgrounds`);
      assert.equal(currency.radius, '50%', `${label} circular currency icon`);
      assert.equal(currency.overflow, 'hidden', `${label} flag is clipped to its circle`);
      assert.ok(Math.abs(currency.width - currency.height) < 1, `${label} undistorted currency circle`);
      assert.equal(currency.width, viewport.width <= 1399 || viewport.height <= 820 ? 34 : 36, `${label} consistent readable compact/desktop circle size`);
      assert.ok(currency.border >= 1 && currency.border <= 2, `${label} thin light flag rim`);
      assert.equal(currency.borderColor, 'rgb(255, 255, 255)', `${label} white rim cleanly separates overlapping flags`);
      assert.notEqual(currency.shadow, 'none', `${label} each flag has a soft individual shadow`);
      assert.equal(currency.svgCount, 1, `${label} exactly one inline SVG per currency`);
      assert.ok(currency.svg && currency.svg.width > 0 && currency.svg.height > 0, `${label} currency flag is painted`);
      assert.ok(Math.abs(currency.svg.width / currency.svg.height - 1.5) < .01, `${label} original 3:2 flag aspect ratio is preserved`);
      assert.equal(currency.svg.viewBox, currency.code === 'EUR' ? '0 0 810 540' : currency.code === 'CHF' ? '0 0 768 512' : '0 0 513 342', `${label} existing local flag coordinates`);
      assert.equal(currency.svg.hidden, 'true', `${label} decorative SVG is hidden from assistive technology`);
      assert.equal(currency.svg.focusable, 'false', `${label} decorative SVG is not focusable`);
      assert.notEqual(currency.svg.display, 'none', `${label} flag is displayed`);
      assert.equal(currency.svg.visibility, 'visible', `${label} flag is visible`);
      assert.equal(currency.svg.opacity, '1', `${label} flag is not transparent`);
      assert.ok(currency.svg.shapes.length >= 2 && currency.svg.shapes.every(shape => shape.geometry && shape.display !== 'none' && shape.visibility === 'visible' && shape.opacity === '1'), `${label} local flag shapes are painted and nonempty`);
      assert.deepEqual([...new Set(currency.svg.shapes.map(shape => shape.fill))].sort(), [...flagColors[currency.code]].sort(), `${label} ${currency.code} retains its recognizable flag colors`);
      assert.ok(currency.svg.children.every(tag => tag === 'path' || (currency.code === 'JPY' && tag === 'circle')), `${label} only local flag paths and Japan's circle, no external images or scripts`);
      assert.ok(Math.abs(currency.svg.x + currency.svg.width / 2 - currency.x - currency.width / 2) <= 1 && Math.abs(currency.svg.y + currency.svg.height / 2 - currency.y - currency.height / 2) <= 1, `${label} flag crop is centered`);
      assert.ok(Math.abs(currency.svg.height - (currency.height - currency.border * 2)) <= 1 && currency.svg.width >= currency.width - currency.border * 2, `${label} flag fills its circle without empty bands`);
      paths.add(currency.svg.shapes.map(shape => `${shape.tag}:${shape.geometry}`).join('|'));
    }
    assert.equal(paths.size, 6, `${label} each currency has a distinct flag`);
    for (const [index, currency] of block.currencies.entries()) {
      assert.ok(Math.abs(currency.y - block.currencies[0].y) <= 1, `${label} flags share one level row`);
      assert.ok(currency.x >= block.currencyLayout.x - 1 && currency.right <= block.currencyLayout.right + 1, `${label} complete flag row fits its container`);
      if (index > 0) {
        const previous = block.currencies[index - 1];
        const expectedOverlap = viewport.width <= 760 ? 12 : viewport.width <= 1399 || viewport.height <= 820 ? 16 : 14;
        assert.equal(previous.right - currency.x, expectedOverlap, `${label} regular overlap on every pair`);
        assert.ok(currency.zIndex === 'auto' ? previous.zIndex === 'auto' : Number(currency.zIndex) >= Number(previous.zIndex), `${label} later flags paint above earlier flags`);
      }
    }
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
      assert.equal(block.title, 'Платите и снимайте наличные — 0% комиссии VOLTEX');
      assert.equal(block.subtitle, '22+ фиатных валют · 70+ криптовалют');
      assert.equal(block.moreLayout.text, 'и другие валюты');
      assert.equal(block.caption.label.toLocaleLowerCase('ru'), 'карта, которая всегда с вами');
      if (viewport.height <= 760) assert.equal(block.inBrand, false, `${label} short/zoomed windows use the existing post-form slot, clear of both cards`);
    } else {
      assert.doesNotMatch(block.text, /[А-Яа-яЁё]/, `${label} no Russian copy in another locale`);
      assert.ok(block.title.trim().length > 0, `${label} localized payment/withdrawal heading remains populated`);
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
          assert.equal(await page.locator('.vx-auth-brand-banner :is(a,button,input,select,textarea,h1,h2)').count(), 0, 'banner has no interactive or duplicate text layers');
          assert.equal(await page.locator('.vx-auth-brand-banner svg').count(), 6, 'banner has exactly six currency SVGs, not another logo');
          assert.equal(await page.locator('.vx-auth-brand-banner .vx-auth-currency > svg').count(), 6, 'all banner SVGs belong only to the currency group');
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
      // A real high-DPI browser crop, not an enlarged/generated mockup.
      const detail = await openContext(1440, 'ru', [], 900, 2);
      await detail.page.goto(`${origin}/${routeName}?next=%2Fwallet`, { waitUntil: 'networkidle' });
      await waitForVisual(detail.page);
      const detailMeasurements = await measure(detail.page);
      await assertRussianGeometry(detail.page, detailMeasurements, `${routeName} high-DPI detail`);
      report.details.push({ route: routeName, deviceScaleFactor: 2, ...detailMeasurements });
      const box = await detail.page.locator('.vx-auth-brand > .vx-auth-extras').boundingBox();
      await detail.page.screenshot({ path: path.join(out, `${routeName}-block-2x.png`), clip: { x: box.x - 16, y: box.y - 16, width: box.width + 32, height: box.height + 32 } });
      await detail.ctx.close();
      const mobileDetail = await openContext(390, 'ru', [], 844, 2);
      await mobileDetail.page.goto(`${origin}/${routeName}?next=%2Fwallet`, { waitUntil: 'networkidle' });
      await waitForVisual(mobileDetail.page);
      await mobileDetail.page.locator('.vx-auth-work > .vx-auth-extras').scrollIntoViewIfNeeded();
      const mobileMeasurements = await measure(mobileDetail.page);
      await assertRussianGeometry(mobileDetail.page, mobileMeasurements, `${routeName} mobile high-DPI detail`);
      report.details.push({ route: routeName, deviceScaleFactor: 2, ...mobileMeasurements });
      await mobileDetail.page.locator('.vx-auth-work > .vx-auth-extras').screenshot({ path: path.join(out, `${routeName}-mobile-block-2x.png`) });
      await mobileDetail.ctx.close();
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
    const registrationButtonColors = () => page.locator('.vx-auth-submit').evaluate(button => {
      const style = getComputedStyle(button);
      return { background: style.backgroundImage, text: style.color, border: style.borderColor, shadow: style.boxShadow };
    });
    const emptyRegistrationColors = await registrationButtonColors();
    assert.match(emptyRegistrationColors.background, /^linear-gradient\(/, 'empty registration keeps its saturated gold gradient');
    await page.locator('#reg-email').fill(credentials.email);
    await page.locator('#reg-password').fill('short');
    assert.equal(await page.locator('.vx-auth-submit').isDisabled(), true, 'weak registration remains disabled');
    assert.deepEqual(await registrationButtonColors(), emptyRegistrationColors, 'invalid registration keeps the same gold appearance');
    await page.locator('#reg-password').fill(credentials.password);
    assert.equal(await page.locator('.vx-auth-submit').isEnabled(), true, 'valid registration becomes enabled');
    assert.deepEqual(await registrationButtonColors(), emptyRegistrationColors, 'disabled and enabled registration use the same gold palette');
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
