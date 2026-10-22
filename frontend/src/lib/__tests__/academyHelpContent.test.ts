import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve, sep } from 'path';
import { compileContent, renderMarkdown, parseFrontmatter, seoPages, withPageHead } from '../content/compile';
import { faqGroups, filterGlossary, neighbours, searchArticles, sortGlossary, glossaryGroups, pickLang } from '../content/academy';
import { apiHealthUrl, edgeHealthUrl, probe } from '../content/systemStatus';

/**
 * Academy and Help content (frontend/content/), compiled exactly as the
 * build compiles it. These are the owner's files: the suite proves they
 * build, link to each other, and keep notes meant for the editor off the
 * site — and that the fee page says what the owner decided (0, 2026-10-01).
 */

const contentDir = resolve(__dirname, '../../../content');
function readTree(dir: string, files: Record<string, string> = {}): Record<string, string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) readTree(full, files);
    else files[relative(contentDir, full).split(sep).join('/')] = readFileSync(full, 'utf8');
  }
  return files;
}
const files = readTree(contentDir);
const compiled = compileContent(files);
const academy = compiled.academy.ru;
const help = compiled.help.ru;

test('the real content builds with no broken related or glossary links', () => {
  expect(compiled.problems).toEqual([]);
  expect(academy.sections.map((s) => s.id)).toEqual(['osnovy', 'futures', 'risk', 'orders', 'ta', 'security', 'glossary']);
  expect(academy.articles.length).toBeGreaterThanOrEqual(24);
  const slugs = new Set(academy.articles.map((a) => a.slug));
  for (const article of academy.articles) {
    expect(article.title && article.summary && article.level && article.readTime > 0).toBeTruthy();
    for (const slug of article.related) expect(slugs.has(slug)).toBe(true);
    expect(article.html).not.toMatch(/<!--|<script/i);
  }
  for (const term of academy.glossary) if (term.link) expect(slugs.has(term.link)).toBe(true);
});

test('a broken link is reported in plain words, not shipped silently', () => {
  const broken = compileContent({
    'ru/academy/_sections.json': JSON.stringify([{ id: 'a', title: 'A', description: '', order: 1 }]),
    'ru/academy/a/one.md': '---\ntitle: One\nslug: one\nsection: a\nrelated: [two]\n---\nText',
    'ru/academy/glossary.json': JSON.stringify([{ term: 'X', def: 'x', link: 'missing' }]),
    'ru/help/faq.json': '[]',
  });
  expect(broken.problems).toEqual([
    'ru/academy/a/one.md: в related указана несуществующая статья «two»',
    'ru/academy/glossary.json: термин «X» ссылается на несуществующую статью «missing»',
  ]);
});

test('editor notes and HTML comments never reach the page; raw HTML is shown as text', () => {
  expect(JSON.stringify(help.fees)).not.toContain('_note');
  expect(JSON.stringify(help)).not.toContain('ЗАПОЛНИТЕ');
  expect(JSON.stringify(help.components)).not.toContain('_note');
  const { html } = renderMarkdown('Текст <!-- для владельца --> дальше\n\n<script>alert(1)</script>');
  expect(html).not.toContain('для владельца');
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;');
});

test('Markdown: headings, lists, tables in their own scroll box, quotes and bold', () => {
  const { html, toc } = renderMarkdown('## Первый\n\n- а\n- б\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n> цитата **жирно**\n\n## Второй');
  expect(toc).toEqual([{ id: 'section-1', title: 'Первый' }, { id: 'section-2', title: 'Второй' }]);
  expect(html).toContain('<h2 id="section-1">Первый</h2>');
  expect(html).toContain('<ul>');
  expect(html).toContain('<div class="vx-md-table"><table>');
  expect(html).toContain('<blockquote>');
  expect(html).toContain('<strong>жирно</strong>');
  expect(parseFrontmatter('---\nrelated: [a, b]\norder: 3\n---\nbody')).toEqual({ data: { related: ['a', 'b'], order: 3 }, body: 'body' });
});

test('fees: the owner\'s zero, the 500 USD minimum, the private-account line; no legal tab content', () => {
  expect(help.fees.futures).toEqual({ maker: '0%', taker: '0%' });
  expect(help.fees.spot).toEqual({ maker: '0%', taker: '0%' });
  expect(help.fees.deposits!.every((r) => r.fee === '0')).toBe(true);
  expect(help.fees.withdrawals!.every((r) => r.fee === '0')).toBe(true);
  expect(help.feesHtml).toContain('500 USD');
  expect(help.feesHtml).toContain('На частных счетах свои ставки');
  expect(help.rulesHtml).toContain('Торговая комиссия — 0%');
  expect(Object.keys(files)).not.toContain('ru/help/legal-placeholder.md');
  expect(help.rulesToc.length).toBe(9);
  expect(help.incidents).toEqual([]);
});

test('every Academy and Help address gets its own title and description', () => {
  const pages = seoPages(compiled);
  for (const article of academy.articles) {
    expect(pages).toContainEqual({ path: `academy/${article.section}/${article.slug}`, title: `${article.title} — Академия VOLTEX`, description: article.summary });
  }
  expect(pages.map((p) => p.path)).toEqual(expect.arrayContaining(['academy', 'academy/glossary', 'help', 'help/faq', 'help/fees', 'help/rules', 'help/status']));
  expect(pages.map((p) => p.path)).not.toContain('help/legal');
  const head = withPageHead('<meta name="description" content="old" /><meta property="og:title" content="old" /><title>VOLTEX</title>', { path: 'x', title: 'A & "B"', description: '<d>' });
  expect(head).toBe('<meta name="description" content="&lt;d&gt;" /><meta property="og:title" content="A &amp; &quot;B&quot;" /><title>A &amp; &quot;B&quot;</title>');
});

test('glossary: alphabetical, Latin before Cyrillic, grouped by first letter', () => {
  const sorted = sortGlossary([{ term: 'Лонг', def: '' }, { term: 'Bid', def: '' }, { term: 'Ask', def: '' }, { term: 'Арбитраж', def: '' }]);
  expect(sorted.map((g) => g.term)).toEqual(['Ask', 'Bid', 'Арбитраж', 'Лонг']);
  expect(glossaryGroups(sorted).map((g) => g.letter)).toEqual(['A', 'B', 'А', 'Л']);
  const real = sortGlossary(academy.glossary).map((g) => g.term);
  const firstCyrillic = real.findIndex((t) => /^[А-Яа-яЁё]/.test(t));
  expect(real.slice(firstCyrillic).some((t) => /^[A-Za-z]/.test(t))).toBe(false);
  expect(filterGlossary(academy.glossary, 'стакан').length).toBeGreaterThan(0);
});

test('search, level filter, neighbours and FAQ groups', () => {
  expect(searchArticles(academy, 'СТЕЙБЛ', null).map((a) => a.slug)).toContain('stablecoins');
  expect(searchArticles(academy, '', 'Средний').every((a) => a.level === 'Средний')).toBe(true);
  const first = academy.articles.find((a) => a.section === 'osnovy' && a.order === 1)!;
  expect(neighbours(academy, first).prev).toBeNull();
  expect(neighbours(academy, first).next!.section).toBe('osnovy');
  const groups = faqGroups(help.faq, '');
  expect(groups[0].group).toBe('Аккаунт');
  expect(faqGroups(help.faq, 'пароль').flatMap((g) => g.items).length).toBeGreaterThan(0);
  expect(pickLang(compiled.academy, 'en')).toEqual({ content: academy, fallback: true });
  expect(pickLang(compiled.academy, 'ru')).toEqual({ content: academy, fallback: false });
});

test('status: /health at the API host root and on the market Worker; 200 answers, another status is an error, no answer is unknown', async () => {
  expect(apiHealthUrl('https://api.voltextech.net/api/v1', 'https://voltextech.net')).toBe('https://api.voltextech.net/health');
  expect(apiHealthUrl('/api/v1', 'https://voltextech.net')).toBe('https://voltextech.net/health');
  expect(edgeHealthUrl('https://market.voltextech.net/')).toBe('https://market.voltextech.net/health');
  const signal = new AbortController().signal;
  expect(await probe('u', (async () => ({ status: 200 })) as unknown as typeof fetch, signal)).toBe('ok');
  expect(await probe('u', (async () => ({ status: 503 })) as unknown as typeof fetch, signal)).toBe('error');
  // A browser that got no answer (network, blocker, CORS) has proven nothing about the platform.
  expect(await probe('u', (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch, signal)).toBe('unreachable');
});

test('registration: no content promises an email-confirmation step the site does not have', () => {
  // src/api/routes/auth.ts: registration returns a signed-in session at once;
  // `emailVerifiedAt` stays null and nothing waits for a link.
  const claim = /подтверд\S*\s+(?:свою\s+)?почт|ссылк\S*\s+из\s+письм|письм\S*\s+с\s+подтвержд(?!ением ждать не нужно)/i;
  const offenders = Object.entries(files).filter(([, text]) => claim.test(text)).map(([path]) => path);
  expect(offenders).toEqual([]);
  const register = help.faq.find((item) => item.q === 'Как зарегистрироваться?')!;
  expect(register.a).toContain('Аккаунт откроется сразу');
});

test('incident list: an empty file means no published reports, and editor notes stay off the page', () => {
  expect(help.incidents).toEqual([]);
  expect(JSON.stringify(help)).not.toContain('Сообщения о сбоях ведутся вручную');
});
