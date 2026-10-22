import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import academy from 'virtual:voltex-academy';
import { useLanguage } from '../../lib/i18n';
import {
  articleHref, filterGlossary, glossaryGroups, levels as levelsOf, neighbours, pickLang, relatedArticles,
  searchArticles, sectionArticles, sortGlossary,
} from '../../lib/content/academy';
import type { AcademyContent, Article } from '../../lib/content/types';
import { usePageMeta } from '../../lib/content/usePageMeta';
import { AcademyHubNav } from './AcademyHubNav';
import { KnowledgeShell } from './KnowledgeShell';

const TITLE = 'Академия VOLTEX';
const GLOSSARY = 'glossary';

/** Academy hub plus the existing article routes. */
export function AcademyPage({ glossary = false, home = false }: { glossary?: boolean; home?: boolean }) {
  const { section, slug } = useParams();
  const { lang } = useLanguage();
  const { content, fallback } = pickLang(academy, lang);
  const hub = home ? 'home' : glossary ? 'glossary' : 'learn';
  let body;
  if (home) body = <AcademyHome content={content} />;
  else if (glossary) body = <GlossaryView content={content} />;
  else if (section && slug) body = <ArticleView content={content} sectionId={section} slug={slug} />;
  else body = <AcademyIndex content={content} sectionId={section ?? null} />;
  return <KnowledgeShell active="academy" fallback={fallback}><AcademyHubNav active={hub} />{body}</KnowledgeShell>;
}


function AcademyHome({ content }: { content: AcademyContent }) {
  const { t } = useLanguage();
  usePageMeta(TITLE, t('academy.subtitle'));
  const first = content.sections.find((s) => s.id !== GLOSSARY);
  const starters = first ? sectionArticles(content, first.id).slice(0, 3) : [];
  const glossary = content.sections.find((s) => s.id === GLOSSARY);
  const cards = [
    { to: '/academy/learn', title: t('academy.hub.learn'), text: t('academy.subtitle') },
    { to: '/academy/knowledge', title: t('academy.hub.knowledge'), text: `${t('help.tab.fees')} · ${t('help.tab.rules')}` },
    { to: '/academy/faq', title: t('help.tab.faq'), text: t('help.faqSearch') },
    { to: '/academy/glossary', title: t('academy.glossary'), text: glossary?.description ?? t('academy.glossarySearch') },
  ];
  return (
    <>
      <header className="vx-kb-intro">
        <h1 className="vx-kb-title">{t('nav.academy')}</h1>
        <p className="vx-kb-lead">{t('academy.subtitle')}</p>
      </header>
      <section className="vx-kb-block">
        <h2 className="vx-kb-h2">{t('academy.sections')}</h2>
        <div className="vx-kb-grid">
          {cards.map((card) => (
            <Link key={card.to} to={card.to} className="vx-kb-card" data-academy-home-card>
              <span className="vx-kb-card-title">{card.title}</span>
              <span className="vx-kb-card-text">{card.text}</span>
              <span className="vx-kb-read">{t('academy.read')} →</span>
            </Link>
          ))}
        </div>
      </section>
      {starters.length > 0 && (
        <section className="vx-kb-block">
          <h2 className="vx-kb-h2">{t('academy.startHere')}</h2>
          <div className="vx-kb-grid">{starters.map((a) => <ArticleCard key={a.slug} article={a} />)}</div>
        </section>
      )}
    </>
  );
}

function NotFound() {
  const { t } = useLanguage();
  usePageMeta(`${t('academy.notFound')} — ${TITLE}`, '');
  return (
    <div className="vx-kb-empty">
      <h1 className="vx-kb-title">{t('academy.notFound')}</h1>
      <Link to="/academy/learn" className="vx-kb-link-button">{t('academy.backHome')}</Link>
    </div>
  );
}

function SectionTabs({ content, current }: { content: AcademyContent; current: string | null }) {
  const { t } = useLanguage();
  return (
    <nav className="vx-kb-tabs" aria-label={t('academy.sections')}>
      <Link to="/academy/learn" aria-current={current === null ? 'page' : undefined}>{t('academy.levelAll')}</Link>
      {content.sections.filter((s) => s.id !== GLOSSARY).map((s) => (
        <Link key={s.id} to={`/academy/${s.id}`} aria-current={current === s.id ? 'page' : undefined}>{s.title}</Link>
      ))}
    </nav>
  );
}

function ArticleCard({ article, sectionTitle }: { article: Article; sectionTitle?: string }) {
  const { t } = useLanguage();
  return (
    <Link to={articleHref(article)} className="vx-kb-card vx-kb-article-card" data-article={article.slug}>
      {sectionTitle && <span className="vx-kb-eyebrow">{sectionTitle}</span>}
      <span className="vx-kb-card-title">{article.title}</span>
      <span className="vx-kb-card-text">{article.summary}</span>
      <span className="vx-kb-meta">
        <span>{article.level}</span>
        <span>{t('academy.readTime', { min: article.readTime })}</span>
        <span className="vx-kb-read">{t('academy.read')} →</span>
      </span>
    </Link>
  );
}

function AcademyIndex({ content, sectionId }: { content: AcademyContent; sectionId: string | null }) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState<string | null>(null);
  const section = sectionId ? content.sections.find((s) => s.id === sectionId && s.id !== GLOSSARY) : null;
  usePageMeta(section ? `${section.title} — ${TITLE}` : TITLE, section ? section.description : t('academy.subtitle'));
  if (sectionId && !section) return <NotFound />;

  const levelList = levelsOf(content);
  const filtering = query.trim() !== '' || level !== null;
  const titleOf = (id: string) => content.sections.find((s) => s.id === id)?.title ?? '';
  const results = searchArticles(content, query, level).filter((a) => !section || a.section === section.id);
  const list = section ? sectionArticles(content, section.id) : [];
  const first = content.sections.find((s) => s.id !== GLOSSARY);
  const starters = first ? sectionArticles(content, first.id).slice(0, 3) : [];

  return (
    <>
      {section && (
        <nav className="vx-kb-crumbs" aria-label="breadcrumbs">
          <Link to="/academy">{t('nav.academy')}</Link><span aria-hidden="true">/</span><span aria-current="page">{section.title}</span>
        </nav>
      )}
      <header className="vx-kb-intro">
        <h1 className="vx-kb-title">{section ? section.title : t('academy.hub.learn')}</h1>
        <p className="vx-kb-lead">{section ? section.description : t('academy.subtitle')}</p>
      </header>
      <SectionTabs content={content} current={section ? section.id : null} />
      <div className="vx-kb-toolbar">
        <input
          type="search"
          className="vx-kb-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('academy.search')}
          aria-label={t('academy.search')}
          data-academy-search
        />
        <div className="vx-kb-chips" role="group" aria-label={t('academy.level')}>
          <button type="button" aria-pressed={level === null} onClick={() => setLevel(null)}>{t('academy.levelAll')}</button>
          {levelList.map((l) => (
            <button key={l} type="button" aria-pressed={level === l} onClick={() => setLevel(l)} data-level={l}>{l}</button>
          ))}
        </div>
      </div>

      {filtering ? (
        <section aria-live="polite">
          <p className="vx-kb-count" data-academy-results>{t('academy.results', { count: results.length })}</p>
          {results.length ? (
            <div className="vx-kb-grid">{results.map((a) => <ArticleCard key={a.slug} article={a} sectionTitle={section ? undefined : titleOf(a.section)} />)}</div>
          ) : <p className="vx-kb-empty-text">{t('academy.nothingFound')}</p>}
        </section>
      ) : section ? (
        <div className="vx-kb-grid">{list.map((a) => <ArticleCard key={a.slug} article={a} />)}</div>
      ) : (
        <>
          {starters.length > 0 && (
            <section className="vx-kb-block">
              <h2 className="vx-kb-h2">{t('academy.startHere')}</h2>
              <div className="vx-kb-grid">{starters.map((a) => <ArticleCard key={a.slug} article={a} />)}</div>
            </section>
          )}
          <section className="vx-kb-block">
            <h2 className="vx-kb-h2">{t('academy.sections')}</h2>
            <div className="vx-kb-grid">
              {content.sections.filter((s) => s.id !== GLOSSARY).map((s) => {
                const count = sectionArticles(content, s.id).length;
                return (
                  <Link key={s.id} to={`/academy/${s.id}`} className="vx-kb-card" data-section={s.id}>
                    <span className="vx-kb-card-title">{s.title}</span>
                    <span className="vx-kb-card-text">{s.description}</span>
                    <span className="vx-kb-meta">
                      <span>{t('academy.articlesCount', { count })}</span>
                      <span className="vx-kb-read">{t('academy.read')} →</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        </>
      )}
    </>
  );
}

function useReadingProgress(key: string) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const doc = document.documentElement;
      const room = doc.scrollHeight - window.innerHeight;
      setProgress(room > 0 ? Math.min(1, Math.max(0, window.scrollY / room)) : 1);
    };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(measure); };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [key]);
  return progress;
}

function ArticleView({ content, sectionId, slug }: { content: AcademyContent; sectionId: string; slug: string }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const article = content.articles.find((a) => a.slug === slug && a.section === sectionId);
  const section = content.sections.find((s) => s.id === sectionId);
  usePageMeta(article ? `${article.title} — ${TITLE}` : TITLE, article?.summary ?? '');
  useEffect(() => { window.scrollTo(0, 0); }, [slug]);
  const progress = useReadingProgress(slug);
  const siblings = useMemo(() => sectionArticles(content, sectionId), [content, sectionId]);
  if (!article || !section) return <NotFound />;
  const { prev, next } = neighbours(content, article);
  const related = relatedArticles(content, article);

  return (
    <>
      <div className="vx-kb-progress" aria-hidden="true"><span style={{ transform: `scaleX(${progress})` }} /></div>
      <nav className="vx-kb-crumbs" aria-label="breadcrumbs">
        <Link to="/academy">{t('nav.academy')}</Link><span aria-hidden="true">/</span>
        <Link to={`/academy/${section.id}`}>{section.title}</Link><span aria-hidden="true">/</span>
        <span aria-current="page">{article.title}</span>
      </nav>
      <div className="vx-kb-article-layout">
        <aside className="vx-kb-sidebar" aria-label={t('academy.inSection')}>
          <p className="vx-kb-sidebar-title">{section.title}</p>
          <ol>
            {siblings.map((a) => (
              <li key={a.slug}><Link to={articleHref(a)} aria-current={a.slug === article.slug ? 'page' : undefined}>{a.title}</Link></li>
            ))}
          </ol>
        </aside>
        <label className="vx-kb-mobile-nav">
          <span>{t('academy.inSection')}</span>
          <select value={article.slug} onChange={(e) => navigate(`/academy/${section.id}/${e.target.value}`)}>
            {siblings.map((a) => <option key={a.slug} value={a.slug}>{a.title}</option>)}
          </select>
        </label>
        <article className="vx-kb-article" data-article-body={article.slug}>
          <header>
            <h1 className="vx-kb-title">{article.title}</h1>
            <p className="vx-kb-meta vx-kb-article-meta">
              <span>{t('academy.level')}: {article.level}</span>
              <span>{t('academy.readTime', { min: article.readTime })}</span>
            </p>
          </header>
          <div className="vx-kb-prose" dangerouslySetInnerHTML={{ __html: article.html }} />
          {/* The owner asked for «Попробовать в демо»; the futures terminal is live,
              so the label names it as it is (plainLanguage.test.ts). Link only. */}
          <p className="vx-kb-demo"><Link to="/futures" className="vx-kb-link-button" data-try-terminal>{t('academy.tryTerminal')}</Link></p>
          {related.length > 0 && (
            <section className="vx-kb-block">
              <h2 className="vx-kb-h2">{t('academy.related')}</h2>
              <div className="vx-kb-grid vx-kb-grid-tight">
                {related.map((a) => <ArticleCard key={a.slug} article={a} sectionTitle={content.sections.find((s) => s.id === a.section)?.title} />)}
              </div>
            </section>
          )}
          <nav className="vx-kb-pager" aria-label={`${t('academy.prev')} / ${t('academy.next')}`}>
            {prev ? <Link to={articleHref(prev)} rel="prev"><small>← {t('academy.prev')}</small><span>{prev.title}</span></Link> : <span />}
            {next ? <Link to={articleHref(next)} rel="next" className="is-next"><small>{t('academy.next')} →</small><span>{next.title}</span></Link> : <span />}
          </nav>
        </article>
      </div>
    </>
  );
}

function GlossaryView({ content }: { content: AcademyContent }) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  usePageMeta(`${t('academy.glossary')} — ${TITLE}`, 'Короткие определения основных терминов криптовалютной торговли.');
  const sorted = useMemo(() => sortGlossary(content.glossary), [content]);
  const groups = glossaryGroups(filterGlossary(sorted, query));
  const allLetters = glossaryGroups(sorted).map((g) => g.letter);
  const shown = new Set(groups.map((g) => g.letter));
  const anchor = (letter: string) => `glossary-${allLetters.indexOf(letter)}`;
  const article = (slug?: string) => (slug ? content.articles.find((a) => a.slug === slug) : undefined);
  const section = content.sections.find((s) => s.id === GLOSSARY);

  return (
    <>
      <nav className="vx-kb-crumbs" aria-label="breadcrumbs">
        <Link to="/academy">{t('nav.academy')}</Link><span aria-hidden="true">/</span><span aria-current="page">{t('academy.glossary')}</span>
      </nav>
      <header className="vx-kb-intro">
        <h1 className="vx-kb-title">{section?.title ?? t('academy.glossary')}</h1>
        {section?.description && <p className="vx-kb-lead">{section.description}</p>}
      </header>
      <SectionTabs content={content} current={GLOSSARY} />
      <div className="vx-kb-toolbar">
        <input
          type="search"
          className="vx-kb-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('academy.glossarySearch')}
          aria-label={t('academy.glossarySearch')}
          data-glossary-search
        />
      </div>
      <nav className="vx-kb-letters" aria-label={t('academy.glossary')}>
        {allLetters.map((letter) => shown.has(letter) ? (
          <a key={letter} href={`#${anchor(letter)}`} onClick={(e) => { e.preventDefault(); document.getElementById(anchor(letter))?.scrollIntoView({ block: 'start' }); }}>{letter}</a>
        ) : <span key={letter} aria-disabled="true">{letter}</span>)}
      </nav>
      {groups.length === 0 && <p className="vx-kb-empty-text">{t('academy.nothingFound')}</p>}
      {groups.map((group) => (
        <section key={group.letter} id={anchor(group.letter)} className="vx-kb-glossary-group" data-glossary-letter={group.letter}>
          <h2 className="vx-kb-letter">{group.letter}</h2>
          <dl>
            {group.terms.map((term) => {
              const target = article(term.link);
              return (
                <div key={term.term} className="vx-kb-term" data-term={term.term}>
                  <dt>{term.term}</dt>
                  <dd>
                    <span>{term.def}</span>
                    {target && <Link to={articleHref(target)} className="vx-kb-term-link">{t('academy.glossaryArticle')}: {target.title}</Link>}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}
    </>
  );
}
