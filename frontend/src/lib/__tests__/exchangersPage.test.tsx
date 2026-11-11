import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { createRequire } from 'module';
import { OffersList } from '../../pages/exchangers/OffersList';
import { NotConfigured } from '../../pages/exchangers/ResultStates';
import { ExchangersFaq } from '../../pages/exchangers/ExchangersFaq';
import { ExchangeTutorial } from '../../pages/exchangers/ExchangeTutorial';
import { PageHeading } from '../../pages/exchangers/PageHeading';
import { ExchangersModeContext } from '../../pages/exchangers/mode';
import { OUTBOUND_LINK, validateOffer } from '../../pages/exchangers/model';
import { EXCHANGERS_META, SITE_ORIGIN, canonicalFor, robotsFor } from '../seo/site';
import { toolPages } from '../seo/pages';
import type { Offer } from '../../../../src/shared/exchangers/types';

/**
 * «Обменники» (/exchangers, Issue #694): what the page source may say and
 * how it is wired. Russian-only copy, no Ukrainian anywhere, no plumbing or
 * provider words, outbound links only through the re-checked BestChange
 * shapes, a public lazy route, scoped hand-written CSS. Fixture offers below
 * are made up (ids 9000+) and live only in this test.
 */

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const { MemoryRouter } = req('react-router-dom');
const read = (p: string) => readFileSync(resolve(frontend, p), 'utf8').replace(/\r\n/g, '\n');
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(resolve(frontend, dir))) {
    const rel = join(dir, name);
    if (statSync(resolve(frontend, rel)).isDirectory()) files(rel, out);
    else out.push(rel);
  }
  return out;
}
const PAGE_FILES = [...files('src/pages/exchangers'), 'src/lib/exchangersApi.ts'];
const render = (el: unknown) => renderToStaticMarkup(React.createElement(MemoryRouter, null, el));

describe('page source', () => {
  test('covers the page, its components, its stylesheet and the client', () => {
    expect(PAGE_FILES).toEqual(expect.arrayContaining([
      'src/pages/exchangers/ExchangersPage.tsx', 'src/pages/exchangers/model.ts', 'src/pages/exchangers/exchangers.css',
      'src/pages/exchangers/OffersList.tsx', 'src/pages/exchangers/OfferAction.tsx', 'src/lib/exchangersApi.ts',
    ]));
  });

  test.each(PAGE_FILES)('%s has no Ukrainian letters and no uk locale', (file) => {
    const text = read(file);
    expect(text.match(/[\u0456\u0457\u0454\u0491\u0406\u0407\u0404\u0490]/g)).toBeNull();
    expect(text).not.toMatch(/['"]uk['"]|lang="uk"|uk-UA/);
  });

  test.each(PAGE_FILES)('%s carries no plumbing, demo, provider or secret wording', (file) => {
    const text = read(file);
    expect(text).not.toMatch(/демо|\bdemo\b|endpoint|эндпоинт|синтетическ|фикстур|fixture|\bmock\b|заглушк|снапшот/i);
    expect(text).not.toMatch(/\b(binance|bybit|kraken|okx|coingecko|deribit|bitget)\b/i);
    expect(text).not.toMatch(/BESTCHANGE_[A-Z_]+|API_KEY|apiKey/);
    // The old prototype's untrue claim about a per-exchanger domain allowlist.
    expect(text).not.toMatch(/утверждённ\w* списк|проверенный адрес|allowlist/i);
  });

  test('no polling and no session: one fetch per action, plain fetch without credentials', () => {
    for (const file of PAGE_FILES) expect(code(read(file))).not.toMatch(/setInterval|browserSetInterval|setTimeout/);
    const client = code(read('src/lib/exchangersApi.ts'));
    expect(client).toContain("import { API_BASE } from './api';");
    expect(client).not.toMatch(/\brequest\s*[<(]|\bapi\.|Authorization|getToken/);
    expect(client).toContain("credentials: 'omit'");
  });

  test('every outbound anchor uses the shared attributes', () => {
    expect(OUTBOUND_LINK).toEqual({ target: '_blank', rel: 'noopener nofollow sponsored', referrerPolicy: 'origin' });
    for (const file of PAGE_FILES.filter((f) => f.endsWith('.tsx'))) {
      const src = read(file);
      const anchors = src.match(/<a\b[\s\S]*?>/g) ?? [];
      for (const a of anchors) {
        expect(a).toContain('target={OUTBOUND_LINK.target}');
        expect(a).toContain('rel={OUTBOUND_LINK.rel}');
        expect(a).toContain('referrerPolicy={OUTBOUND_LINK.referrerPolicy}');
      }
    }
  });

  test('the page root says lang="ru" and sets the registered title', () => {
    const page = read('src/pages/exchangers/ExchangersPage.tsx');
    expect(page).toContain('<main className="vx-ex" lang="ru">');
    expect(page).toContain('usePageMeta(EXCHANGERS_META.title, EXCHANGERS_META.description)');
    expect(page).toContain('Данные: BestChange');
    expect(page).toContain('VOLTEX показывает предложения независимых обменников по данным BestChange, не принимает рубли и не проводит обмен.');
  });

  test('the stylesheet is hand-written and scoped to the page', () => {
    const css = read('src/pages/exchangers/exchangers.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/@tailwind|@apply|@config/);
    const selectors: string[] = [];
    let depth = 0;
    let buf = '';
    let inKeyframes = -1;
    for (const ch of css) {
      if (ch === '{') {
        const prelude = buf.trim();
        buf = '';
        if (prelude.startsWith('@keyframes')) inKeyframes = depth;
        else if (!prelude.startsWith('@') && inKeyframes < 0) selectors.push(...prelude.split(',').map((s) => s.trim()));
        depth++;
      } else if (ch === '}') {
        depth--;
        if (inKeyframes === depth) inKeyframes = -1;
        buf = '';
      } else if (ch === ';' ) {
        buf = '';
      } else buf += ch;
    }
    expect(selectors.length).toBeGreaterThan(50);
    expect(selectors.filter((s) => !s.startsWith('.vx-ex'))).toEqual([]);
    // No blanket reset, and no shared header class as a subject.
    expect(selectors.filter((s) => /(^|\s)\*/.test(s))).toEqual([]);
    expect(selectors.filter((s) => /\.(global-header|top-nav-bar|header-left|header-brand|main-nav|nav-item|nav-mobile-menu|mobile-menu|nav-burger|header-actions|deposit-button)(?![\w-])/.test(s))).toEqual([]);
  });
});

describe('route, navigation and search registration', () => {
  test('public lazy route, not behind RequireAuth', () => {
    const app = read('src/App.tsx');
    expect(app).toContain("const ExchangersPage = lazy(() => import('./pages/exchangers/ExchangersPage').then((m) => ({ default: m.ExchangersPage })));");
    expect(app).toContain('<Route path="/exchangers" element={<ExchangersPage />} />');
    expect(app).not.toMatch(/path="\/exchangers" element=\{<RequireAuth>/);
  });

  test('Nav: one desktop link after the bots and before the Academy, one drawer link; not in BottomNav or a dropdown', () => {
    const nav = read('src/components/Nav.tsx');
    expect(nav.match(/to="\/exchangers"/g)).toHaveLength(2);
    expect(nav.match(/t\('nav\.exchangers'\)/g)).toHaveLength(2);
    const desktop = nav.slice(nav.indexOf('className="main-nav'), nav.indexOf('className="header-actions'));
    const bots = desktop.indexOf('to="/trading-bots"');
    const ex = desktop.indexOf('to="/exchangers"');
    const academy = desktop.indexOf('to="/academy"');
    expect(bots).toBeGreaterThan(-1);
    expect(ex).toBeGreaterThan(bots);
    expect(academy).toBeGreaterThan(ex);
    expect(read('src/components/BottomNav.tsx')).not.toContain('/exchangers');
    expect(read('src/components/HeaderDropdown.tsx')).not.toContain('/exchangers');
  });

  test('the homepage guest header lists it through the shared label key', () => {
    expect(read('src/pages/home/HomeHeader.tsx')).toContain("{ to: '/exchangers', labelKey: 'nav.exchangers' }");
    // KnowledgeShell's guest row is pinned href-for-href by academyHelpPages.test.ts, so it is left as it is.
  });

  test('the label exists in all seven languages, with no Ukrainian', () => {
    const expected: Record<string, string> = { ru: 'Обменники', en: 'Exchangers', es: 'Casas de cambio', zh: '兑换商', hi: 'एक्सचेंजर', ja: '両替所', ko: '환전소' };
    for (const [lang, label] of Object.entries(expected)) {
      expect(read(`src/lib/i18n/locales/${lang}.ts`)).toContain(`  'nav.exchangers': '${label}',\n`);
    }
  });

  test('indexable public page with its own canonical, title and sitemap entry', () => {
    expect(canonicalFor('/exchangers')).toBe(`${SITE_ORIGIN}/exchangers`);
    expect(canonicalFor('/Exchangers/?utm_source=x')).toBe(`${SITE_ORIGIN}/exchangers`);
    expect(robotsFor('/exchangers')).toBeNull();
    expect(EXCHANGERS_META.title).toBe('Обменники — купить криптовалюту за рубли | VOLTEX');
    expect(EXCHANGERS_META.description).toMatch(/^[^\u0456\u0457\u0454\u0491\u0406\u0407\u0404\u0490]+$/);
    expect(toolPages()).toEqual([{ path: 'exchangers', title: EXCHANGERS_META.title, description: EXCHANGERS_META.description }]);
  });
});

describe('rendered offers', () => {
  function offer(id: number, over: Record<string, unknown> = {}): Offer {
    const o = validateOffer({
      id: String(id),
      exchanger: { id, name: `Обменник ${id}`, rating: null, reviews: null },
      rubPerUnit: 95.5, rankRubPerUnit: null, receiveAmount: null, minRub: null, maxRub: null, reserve: null,
      marks: ['verifying'], fitsAmount: null,
      link: { kind: 'exchanger', url: `https://www.bestchange.ru/click.php?id=${id}` },
      ...over,
    });
    if (!o) throw new Error('fixture rejected');
    return o;
  }

  test('unknown values read «Нет данных», links carry the safe attributes and the note', () => {
    const html = render(React.createElement(OffersList, {
      offers: [offer(9001)], assetId: 'USDT', bestOfferId: null, directionUrl: 'https://www.bestchange.ru/sbp-to-tether-trc20.html',
    }));
    expect(html).toContain('Нет данных');
    expect(html).not.toMatch(/>0 USDT<|от 0/);
    expect(html).toContain('href="https://www.bestchange.ru/click.php?id=9001"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener nofollow sponsored"');
    expect(html).toContain('referrerPolicy="origin"');
    expect(html).toContain('Перейти к обменнику');
    expect(html).toContain('Откроется сайт обменника через BestChange. Условия, проверку личности и комиссии устанавливает обменник.');
    expect(html).toContain('Проверка документов');
  });

  test('a forged link never becomes an href; the offer falls back to the BestChange direction', () => {
    const forged = { ...offer(9002), link: { kind: 'exchanger' as const, url: 'javascript:alert(1)' } };
    const other = { ...offer(9003), link: { kind: 'exchanger' as const, url: 'https://www.bestchange.ru/click.php?id=1' } };
    const html = render(React.createElement(OffersList, {
      offers: [forged, other], assetId: 'USDT', bestOfferId: null, directionUrl: 'https://www.bestchange.ru/sbp-to-tether-trc20.html',
    }));
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('click.php?id=1"');
    expect(html).not.toContain('Перейти к обменнику');
    expect(html).toContain('Выбрать на BestChange');
    expect(html).toContain('href="https://www.bestchange.ru/sbp-to-tether-trc20.html"');
    const none = render(React.createElement(OffersList, { offers: [forged], assetId: 'USDT', bestOfferId: null, directionUrl: 'https://evil.com/a-to-b.html' }));
    expect(none).not.toContain('href=');
    expect(none).toContain('Ссылка недоступна');
  });

  test('«Вы получите» and the estimate say they are at the main rate; the crown alone speaks of commissions', () => {
    const html = render(React.createElement(OffersList, {
      offers: [offer(9004, { receiveAmount: 157.07, rankRubPerUnit: 95.6 })], assetId: 'USDT', bestOfferId: '9004', directionUrl: null,
    }));
    expect(html).toContain('Лучший курс с учётом комиссий');
    expect(html).toContain('по основному курсу, без доп. комиссий');
    const calc = read('src/pages/exchangers/ExchangeCalculator.tsx');
    expect(calc).not.toContain('по лучшему курсу с учётом комиссий');
    expect(calc).toContain('основной курс лучшего предложения; доп. комиссии и комиссия сети не учтены');
  });

  test('long real content wraps inside its table cell: full name readable, tags and review counts not nowrap', () => {
    const name = 'Обменный пункт Криптовалютный Экспресс-Сервис';
    const html = render(React.createElement(OffersList, {
      offers: [offer(9005, { exchanger: { id: 9005, name, rating: 4.5, reviews: { positive: 123456, neutral: 12, claim: 3, closed: 1 } }, marks: ['otherout', 'otherin', 'cardverify'] })],
      assetId: 'USDT', bestOfferId: null, directionUrl: null,
    }));
    expect(html).toContain(`title="${name}"`);
    expect(html).toContain('Выплата через сторонние ПС');
    const css = read('src/pages/exchangers/exchangers.css');
    const rule = (sel: string) => {
      const m = css.match(new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`));
      if (!m) throw new Error(`no rule ${sel}`);
      return m[2];
    };
    for (const sel of ['.vx-ex-tag', '.vx-ex-reviews', '.vx-ex-name-title']) {
      expect(rule(sel)).not.toContain('nowrap');
      expect(rule(sel)).toMatch(/overflow-wrap: (break-word|anywhere)/);
    }
    expect(rule('.vx-ex-name-title')).not.toContain('ellipsis');
    expect(rule('.vx-ex-table td')).toMatch(/overflow-wrap: (break-word|anywhere)/);
  });

  test('a small BTC reserve and fractional limits are shown without rounding into a false value', () => {
    const html = render(React.createElement(OffersList, {
      offers: [offer(9006, { reserve: 0.0042, receiveAmount: 0.001, minRub: 1000.5, maxRub: 250000.9, fitsAmount: true, marks: ['delay'] })],
      assetId: 'BTC', bestOfferId: null, directionUrl: null,
    }));
    expect(html).toContain('0,0042 BTC');
    expect(html).not.toMatch(/>0 BTC</);
    expect(html).toContain('1\u00a0001\u00a0₽ – 250\u00a0000\u00a0₽');
    expect(html).toContain('Возможна задержка');
    expect(html).not.toMatch(/>delay<|«delay»/);
  });

  test('only a short status line is live, not the whole results area', () => {
    const page = code(read('src/pages/exchangers/ExchangersPage.tsx'));
    expect(page.match(/aria-live=/g)).toHaveLength(1);
    expect(page).toMatch(/<p className="vx-ex-sr" role="status" aria-live="polite" aria-atomic="true">\{statusText\}<\/p>/);
    expect(page).toContain('<div aria-busy={busy}>');
  });

  test('not configured: honest text and the BestChange direction link when one exists', () => {
    const html = render(React.createElement(NotConfigured, { directionUrl: 'https://www.bestchange.ru/sbp-to-tether-trc20.html' }));
    expect(html).toContain('Список обменников и курсы на VOLTEX сейчас не показываются');
    expect(html).toContain('Вымышленных обменников, курсов и резервов здесь нет');
    expect(html).toContain('Выбрать на BestChange');
    const noLink = render(React.createElement(NotConfigured, { directionUrl: null }));
    expect(noLink).not.toContain('href=');
    expect(noLink).toContain('проверенной ссылки на BestChange нет');
  });

  const inMode = (mode: 'pending' | 'live' | 'links', el: unknown) => render(React.createElement(ExchangersModeContext.Provider, { value: mode }, el as never));

  test('the FAQ is a button accordion, closed by default', () => {
    const html = inMode('live', React.createElement(ExchangersFaq));
    expect(html.match(/aria-expanded="false"/g)?.length).toBe(9);
    expect(html).toContain('Куда ведёт кнопка перехода?');
  });

  // Issue #694: without a rate source the page must not present itself as a comparison or a catalogue of exchangers.
  test.each(['links', 'pending'] as const)('%s mode: no claim of a comparison, a list, rates or API data anywhere in the static copy', (mode) => {
    const html = [PageHeading, ExchangeTutorial, ExchangersFaq].map((c) => inMode(mode, React.createElement(c))).join('\n');
    expect(html).not.toMatch(/сервис сравнения|Сравнивайте предложения|помогает сравнить|получены через официальный API|показывает и сравнивает|Как упорядочен список|Что значит «Нет данных»|Перейти к обменнику|Как работает сравнение/);
    expect(html).toContain('VOLTEX не проводит обмен.');
    expect(html).toContain('Список обменников и курсы на этой странице сейчас не показываются');
    expect(html).toContain('перейдите к выбору обменника на BestChange');
    expect(html).toContain('Откройте направление на BestChange');
    expect(html).toContain('Сейчас курсы на этой странице не показываются');
    expect(html.match(/aria-expanded="false"/g)?.length).toBe(7);
    // The safety rules and the six steps stay in both modes.
    expect(html.match(/class="vx-ex-card vx-ex-step"/g)?.length).toBe(6);
    expect(html).toContain('USDT TRC-20 и TRX — разные активы');
  });

  test('live mode keeps the approved comparison copy', () => {
    const html = [PageHeading, ExchangeTutorial, ExchangersFaq].map((c) => inMode('live', React.createElement(c))).join('\n');
    expect(html).toContain('VOLTEX — сервис сравнения.');
    expect(html).toContain('Данные на этой странице получены через официальный API BestChange.');
    expect(html).toContain('Сравните предложения обменников');
    expect(html).toContain('Кнопка «Перейти к обменнику» открывает сайт выбранного обменника');
    expect(html).not.toContain('сейчас не показываются');
  });

  test('the page derives the mode from the directory answer and gates the list title, the data badge and the footer line', () => {
    const page = code(read('src/pages/exchangers/ExchangersPage.tsx'));
    expect(page).toContain("const mode: ExchangersMode = directory.kind === 'loading' ? 'pending' : directory.kind === 'not_configured' ? 'links' : 'live';");
    expect(page).toContain("{ratesOff ? 'Выбор обменника на BestChange' : 'Предложения обменников'}");
    expect(page).toContain('{!ratesOff && <span className="vx-ex-attribution">Данные: BestChange</span>}');
    expect(page).toContain("mode === 'live'");
    const calc = code(read('src/pages/exchangers/ExchangeCalculator.tsx'));
    expect(calc).toContain("{ratesOff ? 'Показать направление' : 'Найти обменники'}");
  });
});
