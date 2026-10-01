/**
 * Academy and Help content, as the build hands it to the pages.
 *
 * The files under frontend/content/<lang>/ are read and turned into these
 * shapes while the site is built (frontend/contentPlugin.ts); the browser
 * receives finished HTML and plain data, never Markdown, and nothing here is
 * fetched from the API.
 */

export interface AcademySection {
  id: string;
  title: string;
  description: string;
  order: number;
}

export interface ArticleMeta {
  slug: string;
  section: string;
  title: string;
  order: number;
  level: string;
  readTime: number;
  summary: string;
  related: string[];
}

export interface Article extends ArticleMeta {
  html: string;
}

export interface GlossaryTerm {
  term: string;
  def: string;
  link?: string;
}

export interface AcademyContent {
  sections: AcademySection[];
  articles: Article[];
  glossary: GlossaryTerm[];
}

export interface FaqItem {
  group: string;
  q: string;
  a: string;
}

export interface FeeRow {
  coin: string;
  network: string;
  fee: string;
  min: string;
  confirmations?: string;
}

export interface Fees {
  updated?: string;
  futures?: { maker: string; taker: string };
  spot?: { maker: string; taker: string };
  funding?: { interval: string; note?: string };
  deposits?: FeeRow[];
  withdrawals?: FeeRow[];
}

export interface TocEntry {
  id: string;
  title: string;
}

export interface StatusComponent {
  id: string;
  name: string;
}

export interface Incident {
  date?: string;
  title?: string;
  status?: string;
  text?: string;
  components?: string[];
}

export interface HelpContent {
  faq: FaqItem[];
  fees: Fees;
  feesHtml: string;
  rulesHtml: string;
  rulesToc: TocEntry[];
  components: StatusComponent[];
  incidents: Incident[];
}

/** Russian is always present; another language appears once its folder does. */
export type ByLang<T> = { ru: T } & Partial<Record<string, T>>;
