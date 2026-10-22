import type { AcademyContent, Article, ByLang, GlossaryTerm } from './types';

/** Pure helpers behind the Academy and Help pages: search, ordering,
 * neighbours and the glossary index. Everything runs in the browser on the
 * data compiled at build time — no request is ever made for any of it. */

export function pickLang<T>(byLang: ByLang<T>, lang: string): { content: T; fallback: boolean } {
  const own = byLang[lang];
  return own ? { content: own, fallback: false } : { content: byLang.ru, fallback: lang !== 'ru' };
}

const normalize = (text: string) => text.toLocaleLowerCase('ru').replace(/ё/g, 'е');

export const articleHref = (article: Pick<Article, 'section' | 'slug'>) => `/academy/${article.section}/${article.slug}`;

export function sectionArticles(content: AcademyContent, sectionId: string): Article[] {
  return content.articles.filter((a) => a.section === sectionId).sort((a, b) => a.order - b.order);
}

/** Levels in the order articles first use them ("Новичок" before "Средний"). */
export function levels(content: AcademyContent): string[] {
  const seen: string[] = [];
  for (const section of content.sections) {
    for (const article of sectionArticles(content, section.id)) {
      if (article.level && !seen.includes(article.level)) seen.push(article.level);
    }
  }
  return seen;
}

/** Title and summary search, optionally limited to one level. Articles keep
 * the order of their sections. */
export function searchArticles(content: AcademyContent, query: string, level: string | null): Article[] {
  const needle = normalize(query.trim());
  const ordered = content.sections.flatMap((s) => sectionArticles(content, s.id));
  return ordered.filter((a) => (!level || a.level === level)
    && (!needle || normalize(a.title).includes(needle) || normalize(a.summary).includes(needle)));
}

export function neighbours(content: AcademyContent, article: Article): { prev: Article | null; next: Article | null } {
  const list = sectionArticles(content, article.section);
  const index = list.findIndex((a) => a.slug === article.slug);
  return { prev: index > 0 ? list[index - 1] : null, next: index >= 0 && index < list.length - 1 ? list[index + 1] : null };
}

export function relatedArticles(content: AcademyContent, article: Article): Article[] {
  return article.related
    .map((slug) => content.articles.find((a) => a.slug === slug))
    .filter((a): a is Article => !!a);
}

const isLatin = (term: string) => /^[A-Za-z]/.test(term.trim());

/** Alphabetical, Latin terms before Cyrillic ones. */
export function sortGlossary(terms: GlossaryTerm[]): GlossaryTerm[] {
  return [...terms].sort((a, b) => {
    const la = isLatin(a.term);
    const lb = isLatin(b.term);
    if (la !== lb) return la ? -1 : 1;
    return a.term.localeCompare(b.term, la ? 'en' : 'ru', { sensitivity: 'base' });
  });
}

export const glossaryLetter = (term: string) => term.trim().charAt(0).toLocaleUpperCase('ru');

export function filterGlossary(terms: GlossaryTerm[], query: string): GlossaryTerm[] {
  const needle = normalize(query.trim());
  return needle ? terms.filter((g) => normalize(g.term).includes(needle) || normalize(g.def).includes(needle)) : terms;
}

export function glossaryGroups(sorted: GlossaryTerm[]): { letter: string; terms: GlossaryTerm[] }[] {
  const groups: { letter: string; terms: GlossaryTerm[] }[] = [];
  for (const term of sorted) {
    const letter = glossaryLetter(term.term);
    const last = groups[groups.length - 1];
    if (last && last.letter === letter) last.terms.push(term);
    else groups.push({ letter, terms: [term] });
  }
  return groups;
}

/** FAQ groups in the order the file first names them. */
export function faqGroups<T extends { group: string; q: string; a: string }>(items: T[], query: string): { group: string; items: T[] }[] {
  const needle = normalize(query.trim());
  const groups: { group: string; items: T[] }[] = [];
  for (const item of items) {
    if (needle && !normalize(item.q).includes(needle) && !normalize(item.a).includes(needle)) continue;
    let group = groups.find((g) => g.group === item.group);
    if (!group) groups.push(group = { group: item.group, items: [] });
    group.items.push(item);
  }
  return groups;
}
