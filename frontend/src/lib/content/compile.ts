import { Marked, type Tokens } from 'marked';
import type {
  AcademyContent, AcademySection, Article, ByLang, FaqItem, Fees, GlossaryTerm, HelpContent, Incident,
  StatusComponent, TocEntry,
} from './types';

/**
 * Build-time compiler for frontend/content/. Pure: it takes the files as
 * text keyed by their path inside content/ ("ru/academy/osnovy/x.md") and
 * returns finished data, so the Vite plugin and the Jest suite run the very
 * same code. Nothing here ships to the browser.
 */

export interface CompiledContent {
  academy: ByLang<AcademyContent>;
  help: ByLang<HelpContent>;
  /** Broken `related` / glossary links and other mistakes, in plain words. */
  problems: string[];
}

export interface SeoPage {
  path: string;
  title: string;
  description: string;
}

type Frontmatter = Record<string, string | number | string[]>;

export function parseFrontmatter(source: string): { data: Frontmatter; body: string } {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  if (!match) return { data: {}, body: source };
  const data: Frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (field) data[field[1]] = frontmatterValue(field[2].trim());
  }
  return { data, body: source.slice(match[0].length) };
}

function unquote(value: string): string {
  return /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value;
}

function frontmatterValue(raw: string): string | number | string[] {
  if (/^\[.*\]$/.test(raw)) {
    return raw.slice(1, -1).split(',').map((item) => unquote(item.trim())).filter(Boolean);
  }
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return unquote(raw);
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const plainText = (markdown: string) => markdown.replace(/[*_`]/g, '').trim();

/** Markdown → HTML. HTML comments are dropped; any other raw HTML is shown
 * as text, never executed. `##` headings get ids for a table of contents. */
export function renderMarkdown(source: string): { html: string; toc: TocEntry[] } {
  const toc: TocEntry[] = [];
  const marked = new Marked({ gfm: true, breaks: true });
  marked.use({
    renderer: {
      heading(this: { parser: { parseInline(tokens: Tokens.Generic[]): string } }, token: Tokens.Heading) {
        const inner = this.parser.parseInline(token.tokens);
        if (token.depth !== 2) return `<h${token.depth}>${inner}</h${token.depth}>\n`;
        const id = `section-${toc.length + 1}`;
        toc.push({ id, title: plainText(token.text) });
        return `<h2 id="${id}">${inner}</h2>\n`;
      },
      html(token: Tokens.HTML | Tokens.Tag) {
        return escapeHtml(token.text);
      },
    },
  });
  const withoutComments = source.replace(/<!--[\s\S]*?-->/g, '');
  const html = (marked.parse(withoutComments, { async: false }) as string)
    // Tables scroll inside their own box on a phone; the page never does.
    .replace(/<table>/g, '<div class="vx-md-table"><table>')
    .replace(/<\/table>/g, '</table></div>');
  return { html, toc };
}

/** Fields whose name starts with «_» are notes for whoever edits the file. */
function withoutNotes<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutNotes) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !key.startsWith('_'))
        .map(([key, item]) => [key, withoutNotes(item)]),
    ) as T;
  }
  return value;
}

function readJson<T>(files: Record<string, string>, path: string, problems: string[]): T | undefined {
  if (!(path in files)) return undefined;
  try {
    return withoutNotes(JSON.parse(files[path]) as T);
  } catch (error) {
    problems.push(`${path}: файл не читается как JSON (${(error as Error).message})`);
    return undefined;
  }
}

const str = (value: unknown, fallback = '') => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : fallback);
const num = (value: unknown, fallback: number) => (typeof value === 'number' ? value : Number(value) || fallback);

function compileAcademy(lang: string, files: Record<string, string>, problems: string[]): AcademyContent | undefined {
  const root = `${lang}/academy/`;
  const sectionsFile = `${root}_sections.json`;
  const rawSections = readJson<AcademySection[]>(files, sectionsFile, problems);
  if (!rawSections) return undefined;
  const sections = rawSections
    .map((s) => ({ id: str(s.id), title: str(s.title), description: str(s.description), order: num(s.order, 999) }))
    .sort((a, b) => a.order - b.order);
  const sectionIds = new Set(sections.map((s) => s.id));

  const articles: Article[] = [];
  for (const [path, source] of Object.entries(files)) {
    const parts = /^([^/]+)\/academy\/([^/]+)\/([^/]+)\.md$/.exec(path);
    if (!parts || parts[1] !== lang) continue;
    const { data, body } = parseFrontmatter(source);
    const article: Article = {
      slug: str(data.slug, parts[3]),
      section: str(data.section, parts[2]),
      title: str(data.title, parts[3]),
      order: num(data.order, 999),
      level: str(data.level),
      readTime: num(data.readTime, 0),
      summary: str(data.summary),
      related: Array.isArray(data.related) ? data.related : [],
      html: renderMarkdown(body).html,
    };
    if (!sectionIds.has(article.section)) problems.push(`${path}: раздел «${article.section}» не найден в _sections.json`);
    if (articles.some((a) => a.slug === article.slug)) problems.push(`${path}: slug «${article.slug}» уже занят другой статьёй`);
    articles.push(article);
  }
  articles.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'ru'));

  const glossary = (readJson<GlossaryTerm[]>(files, `${root}glossary.json`, problems) ?? [])
    .map((g) => ({ term: str(g.term), def: str(g.def), ...(g.link ? { link: str(g.link) } : {}) }));

  const slugs = new Set(articles.map((a) => a.slug));
  for (const article of articles) {
    for (const slug of article.related) {
      if (!slugs.has(slug)) problems.push(`${lang}/academy/${article.section}/${article.slug}.md: в related указана несуществующая статья «${slug}»`);
    }
  }
  for (const term of glossary) {
    if (term.link && !slugs.has(term.link)) problems.push(`${root}glossary.json: термин «${term.term}» ссылается на несуществующую статью «${term.link}»`);
  }
  return { sections, articles, glossary };
}

function compileHelp(lang: string, files: Record<string, string>, problems: string[]): HelpContent | undefined {
  const root = `${lang}/help/`;
  if (!Object.keys(files).some((path) => path.startsWith(root))) return undefined;
  const faq = (readJson<FaqItem[]>(files, `${root}faq.json`, problems) ?? [])
    .map((item) => ({ group: str(item.group), q: str(item.q), a: str(item.a) }));
  const fees = readJson<Fees>(files, `${root}fees.json`, problems) ?? {};
  const feesHtml = files[`${root}fees.md`] ? renderMarkdown(parseFrontmatter(files[`${root}fees.md`]).body).html : '';
  const rules = files[`${root}rules.md`] ? renderMarkdown(parseFrontmatter(files[`${root}rules.md`]).body) : { html: '', toc: [] };
  const status = readJson<{ components?: StatusComponent[]; incidents?: Incident[] }>(files, `${root}incidents.json`, problems) ?? {};
  return {
    faq,
    fees,
    feesHtml,
    rulesHtml: rules.html,
    rulesToc: rules.toc,
    components: (status.components ?? []).map((c) => ({ id: str(c.id), name: str(c.name) })),
    incidents: status.incidents ?? [],
  };
}

export function compileContent(files: Record<string, string>): CompiledContent {
  const problems: string[] = [];
  const langs = [...new Set(Object.keys(files).map((path) => path.split('/')[0]))].sort();
  const academy: Partial<Record<string, AcademyContent>> = {};
  const help: Partial<Record<string, HelpContent>> = {};
  for (const lang of langs) {
    const a = compileAcademy(lang, files, problems);
    if (a) academy[lang] = a;
    const h = compileHelp(lang, files, problems);
    if (h) help[lang] = h;
  }
  if (!academy.ru) problems.push('Нет ru/academy/_sections.json — Академия без русского текста не собирается');
  if (!help.ru) problems.push('Нет папки ru/help — Помощь без русского текста не собирается');
  return {
    academy: { ...academy, ru: academy.ru ?? { sections: [], articles: [], glossary: [] } },
    help: { ...help, ru: help.ru ?? { faq: [], fees: {}, feesHtml: '', rulesHtml: '', rulesToc: [], components: [], incidents: [] } },
    problems,
  };
}

export const ACADEMY_TITLE = 'Академия VOLTEX';
export const ACADEMY_DESCRIPTION = 'Бесплатные статьи о криптовалюте, фьючерсах, рисках и безопасности — простым языком.';
export const HELP_TITLE = 'Помощь VOLTEX';

/** One entry per public Academy/Help address, for the static <title> and
 * description search engines read before any script runs. */
export function seoPages(content: CompiledContent): SeoPage[] {
  const { sections, articles } = content.academy.ru;
  const pages: SeoPage[] = [
    { path: 'academy', title: ACADEMY_TITLE, description: ACADEMY_DESCRIPTION },
    { path: 'academy/glossary', title: `Глоссарий — ${ACADEMY_TITLE}`, description: 'Короткие определения основных терминов криптовалютной торговли.' },
  ];
  for (const section of sections) {
    if (section.id === 'glossary') continue;
    pages.push({ path: `academy/${section.id}`, title: `${section.title} — ${ACADEMY_TITLE}`, description: section.description });
  }
  for (const article of articles) {
    pages.push({ path: `academy/${article.section}/${article.slug}`, title: `${article.title} — ${ACADEMY_TITLE}`, description: article.summary });
  }
  const help: [string, string, string][] = [
    ['help', 'Вопросы и ответы', 'Ответы на частые вопросы об аккаунте, пополнении, торговле и выводе на VOLTEX.'],
    ['help/faq', 'Вопросы и ответы', 'Ответы на частые вопросы об аккаунте, пополнении, торговле и выводе на VOLTEX.'],
    ['help/fees', 'Комиссии', 'Торговые комиссии, пополнение и вывод на VOLTEX.'],
    ['help/rules', 'Правила торговли', 'Как работают ордера, маржа, ликвидация и ставка финансирования на VOLTEX.'],
    ['help/status', 'Статус системы', 'Отвечают ли сервер VOLTEX и рыночные данные; опубликованные сообщения о сбоях.'],
  ];
  for (const [path, title, description] of help) pages.push({ path, title: `${title} — ${HELP_TITLE}`, description });
  return pages;
}

/** index.html with this page's title and description. */
export function withPageHead(indexHtml: string, page: SeoPage): string {
  const title = escapeHtml(page.title);
  const description = escapeHtml(page.description);
  return indexHtml
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${description}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${title}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${description}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${title}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${description}$2`);
}
