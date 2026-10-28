import type { Lang } from '../i18n';
import { LEGAL_CONTENT, type LegalDoc } from '../legalContent';

/** The About page's own lead sentence (pages/about/AboutPage.tsx). */
export const ABOUT_DESCRIPTION = 'Мы создаём пространство, в котором рынки, торговые инструменты и управление активами становятся частью единого опыта.';

/** Title and description of a legal or company page, taken from the text the page itself shows. */
export function legalMeta(doc: LegalDoc, lang: Lang = 'ru'): { title: string; description: string } {
  const content = LEGAL_CONTENT[lang][doc];
  return { title: `${content.title} — VOLTEX`, description: doc === 'about' ? ABOUT_DESCRIPTION : content.intro };
}
