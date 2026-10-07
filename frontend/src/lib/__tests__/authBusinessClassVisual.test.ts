import { readFileSync, statSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';
import { createRequire } from 'module';
import ts from 'typescript';

const root = resolve(__dirname, '../../../..');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8').replace(/\r\n/g, '\n');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const shell = read('frontend/src/pages/auth-shell/AuthShell.tsx');
const css = read('frontend/src/pages/auth-shell/auth-shell.css');
const premiumCSS = read('frontend/src/pages/auth-shell/auth-form-premium.css');
const req = createRequire(resolve(root, 'frontend/package.json'));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');

function renderShell(lang: string) {
  const overrides: Record<string, unknown> = {
    './auth-shell.css': {}, './auth-form-premium.css': {},
    '../../components/Logo': { Logo: () => React.createElement('span', null, 'HTML_LOGO'), LogoMark: () => null },
    '../../components/LanguageSwitcher': { LanguageSwitcher: () => null },
    '../../lib/i18n': { useLanguage: () => ({ lang, t: (key: string) => `localized:${lang}:${key}` }) },
    '../../lib/supportWidget': { openSupportWidget: jest.fn() },
    'react-router-dom': { Link: ({ to, children, ...rest }: any) => React.createElement('a', { href: to, ...rest }, children) },
  };
  const code = ts.transpileModule(shell, { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  const output: Record<string, any> = {};
  new Function('require', 'exports', code)((name: string) => overrides[name] ?? req(name), output);
  return renderToStaticMarkup(React.createElement(output.AuthShell, null, 'EXISTING_ROUTE_FORM'));
}

describe('business-class visual preserves reviewed authentication', () => {
  test('fiat-icon follow-up preserves shell outside the decorative icon group, photo scrim and other styles', () => {
    // Fingerprint computed from reviewed head ab24d3da. Exclude only the
    // authorized icon span and its descriptive comment, not AuthCommunity or
    // AuthShell: all copy, captions, form placement and auth wiring stay locked.
    const preservedShell = shell
      .replace(/\/\*\* Decorative (?:portraits, not testimonials or an independently verified count|fiat symbols: ruble, US dollar and Chinese yuan, not a user count)\. \*\//, '/* Decorative icon-only follow-up. */')
      .replace(/        <span className="vx-auth-(?:avatars|currencies)" aria-hidden="true">[\s\S]*?\n        <\/span>(?=\n        <div className="vx-auth-community-copy">)/, '        {/* Decorative icon group. */}');
    expect(digest(preservedShell)).toBe('dc6b24e6f7ec31917072e12dd191bd4315ad75699bef58d1df7c9524fd036bbe');
    expect(digest(css.slice(0, css.indexOf('/* Static, localized photo captions.')) + css.slice(css.indexOf('/* Light form theme'))))
      .toBe('a9683d542ce768fe239dd7045229a38258583eed44f5d8b245a2b99ae55566b8');
    expect(digest(css.slice(css.indexOf('.vx-auth-brand::before {'), css.indexOf('.vx-auth .vx-auth-extras {'))))
      .toBe('ef783bf84795d0855d1f3831be101f6ed71989414355cfef1d7323b435cd00b9');
  });
  // Exact fresh-main deb4b107 sources, normalized only for Windows line endings.
  test.each([
    ['frontend/src/pages/AuthPage.tsx', 'ed5c36556873dd4d51f2b7f41d554eb6bccd270f328488b0e0c0a11bc2621cf4'],
    ['frontend/src/pages/register/RegisterPage.tsx', '23c2a8a21716c6da67cc51c5c7f8c725b2074cecbfaf77c948aacf610ef52d29'],
    ['frontend/src/pages/register/RegisterPanel.tsx', '1e47f15e188f8883ffaf40a725f8e8b2de90b8d604d7ec285802a21339e18c8e'],
    ['frontend/src/pages/auth-shell/AuthFields.tsx', '6253311614e77c749048b5111c03d0cd59325ed3bf6bdaeda43f59d5b15ea9f5'],
    ['frontend/src/lib/returnTo.ts', 'e5ffb48e4adc49aafced4458c2ed9d5fbd2274f5f3366e81f442904dab6572d3'],
  ])('%s is unchanged', (file, hash) => expect(digest(read(file))).toBe(hash));

  test('underlying form rules, focus, validation and controls are retained below the visual override', () => {
    const formCSS = css.slice(css.indexOf('/* Light form theme'), css.indexOf('@media (min-width: 1800px)'));
    expect(digest(formCSS)).toBe('2cfe7a3a245be028e50322ca5602d2d073dcde913f3628d17cfd6a271f0cb28d');
    expect(shell).toContain('{children}');
    expect(shell).toContain('onClick={openSupportWidget}');
    expect(shell).toContain('to={`/login${window.location.search}`}');
    expect(shell).toContain('to={`/register${window.location.search}`}');
    expect(shell).not.toMatch(/\bfetch\(|\bapi\.|useEffect/);
  });

  test('Russian marketing banner has no duplicate logo or slogan; captions are static HTML', () => {
    const html = renderShell('ru');
    expect(html).toContain('src="/auth/selected-cabin-banner.webp"');
    expect(html).toContain('width="919" height="941"');
    expect(html).toContain('alt="VOLTEX. Копируйте сделки лучших трейдеров мира.');
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).not.toMatch(/<picture|<h2|vx-auth-hero|vx-auth-lead|vx-auth-copyright/);
    const banner = html.split('vx-auth-brand-banner')[1].split('</section>')[0];
    expect(banner).not.toMatch(/<a\b|<button\b|<input\b|<p\b|<footer\b|HTML_LOGO/);
    expect(banner.match(/<svg\b/g)).toHaveLength(3);
    expect(banner.match(/class="vx-auth-currency"/g)).toHaveLength(3);
    // One existing Logo is available in the form header when the decorative
    // banner is omitted. Browser QA checks their mutually exclusive visibility.
    expect(html.match(/HTML_LOGO/g)).toHaveLength(1);
    expect(html).toContain('class="vx-auth-compact-logo"');
    expect(html).toContain('EXISTING_ROUTE_FORM');
  });

  test.each(['ru', 'en', 'zh', 'es', 'hi', 'ja', 'ko'])('%s has localized card copy without an investor-count badge', lang => {
    const html = renderShell(lang);
    expect(html.match(/class="vx-auth-extras"/g)).toHaveLength(2);
    expect(html.match(/class="vx-auth-currency"/g)).toHaveLength(6);
    expect(html.match(/class="vx-auth-currencies" aria-hidden="true"/g)).toHaveLength(2);
    const icons = [...html.matchAll(/<span class="vx-auth-currency" data-currency="([^"]+)">(<svg[\s\S]*?<\/svg>)<\/span>/g)];
    expect(icons.map(icon => icon[1])).toEqual(['RUB', 'USD', 'CNY', 'RUB', 'USD', 'CNY']);
    const paths: Record<string, string> = {
      RUB: 'M8 21V3h7a4 4 0 0 1 0 8H5M5 16h10',
      USD: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
      CNY: 'm4 3 8 10 8-10M12 13v8M5 13h14M5 17h14',
    };
    for (const [, currency, svg] of icons) {
      expect(svg).toContain('viewBox="0 0 24 24"');
      expect(svg).toContain('aria-hidden="true"');
      expect(svg).toContain('focusable="false"');
      expect(svg).toContain(`<path d="${paths[currency]}"></path>`);
      expect(svg).not.toMatch(/<image\b|<use\b|<foreignObject\b|<text\b|<script\b|tabindex|onclick|href/);
    }
    expect(new Set(icons.slice(0, 3).map(icon => icon[2])).size).toBe(3);
    expect(html).not.toMatch(/vx-auth-avatar|community-v4|data-currency="JPY"/);
    expect(html).toContain(`localized:${lang}:authShell.communityTitle`);
    expect(html).toContain(`localized:${lang}:authShell.communitySubtitle`);
    expect(html).toContain(`localized:${lang}:authShell.cardCaption`);
    expect(html).toContain('class="vx-auth-card-number">01</span>');
    expect(html).toContain('class="vx-auth-card-line" aria-hidden="true"');
    expect(html).not.toMatch(/communityCount|communityBadge|1[.,]2\+?\s*(M|млн)/);
    expect(html.indexOf('EXISTING_ROUTE_FORM')).toBeLessThan(html.lastIndexOf('class="vx-auth-extras"'));
    expect(html.lastIndexOf('class="vx-auth-extras"')).toBeLessThan(html.indexOf('class="vx-auth-foot"'));
  });

  test.each(['en', 'zh', 'es', 'hi', 'ja', 'ko'])('%s retains the localized photo and copy, never translated over Russian artwork', lang => {
    const html = renderShell(lang);
    expect(html).not.toContain('selected-cabin-banner');
    expect(html).not.toContain('Копируйте');
    expect(html).toContain('src="/auth/business-class-1440.webp"');
    expect(html).toContain(`localized:${lang}:authShell.hero.line1`);
    expect(html).toContain('HTML_LOGO');
    expect(html).toContain('EXISTING_ROUTE_FORM');
  });

  test('chosen artwork remains a lossless, unretouched 919x941 crop of the approved raster', () => {
    const banner = readFileSync(resolve(root, 'frontend/public/auth/selected-cabin-banner.webp'));
    expect(createHash('sha256').update(banner).digest('hex'))
      .toBe('a4b8e9d0e84fa4e95c4db1b561fefdcde9d0a8ed98f748a460ba989a22ecd1ae');
    expect(css).toContain('.vx-auth .vx-auth-brand-banner::after { content: none; }');
    // Actual painted coverage, protected image regions, resize/zoom and compact
    // form access are measured by qa-auth-business-class.cjs, not CSS literals.
  });

  test('premium form is native CSS, keeps warning/error/focus/disabled states and adds no images', () => {
    // Geometry follow-up must not restyle the accepted real form.
    expect(digest(premiumCSS)).toBe('4db470ef528e16220c255290ba17df24c571edbdd3b55c6b83e89caf0a2e866b');
    expect(premiumCSS).not.toMatch(/url\(|opacity:\s*0\b|pointer-events:\s*none/);
    expect(premiumCSS).toContain('.vx-auth .vx-auth-input.vx-auth-input-error');
    expect(premiumCSS).toContain('.vx-auth .vx-auth-input.vx-auth-input-warn');
    expect(premiumCSS).toContain('.vx-auth .vx-auth-input:focus');
    expect(premiumCSS).toContain('.vx-auth .vx-auth-submit:disabled');
    expect(premiumCSS).toContain('background: linear-gradient(110deg, #f5db8b, #edcb6a)');
    expect(shell).toContain("import './auth-form-premium.css'");
  });

  test('responsive local photo with reserved dimensions; no old overlays or fake endorsements', () => {
    expect(shell).toContain('<picture>');
    expect(shell).toContain('media="(max-width: 760px)"');
    expect(shell).toContain('width="1440" height="2160"');
    expect(shell).toContain("fetchpriority: 'high'");
    expect(shell).not.toMatch(/aircraft-v6|communityCount|communityBadge|https:\/\//);
    expect(shell + css).not.toMatch(/vx-auth-avatar|community-v4/);
    expect(css).toContain('.vx-auth .vx-auth-currency svg');
    expect(css).not.toMatch(/backdrop-filter|backdrop-blur/);
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)');
    expect(css).toContain('object-fit: cover');
    expect(css).not.toContain('mask-image');
    expect(shell).not.toContain('<h1>');
    for (const name of ['960', '1440', 'mobile']) {
      const file = resolve(root, `frontend/public/auth/business-class-${name}.webp`);
      const buffer = readFileSync(file);
      expect(buffer.toString('ascii', 0, 4)).toBe('RIFF');
      expect(buffer.toString('ascii', 8, 12)).toBe('WEBP');
      expect(statSync(file).size).toBeLessThan(name === 'mobile' ? 70000 : 200000);
    }
  });
});
