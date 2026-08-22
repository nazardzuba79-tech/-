import { Link, useParams } from 'react-router-dom';
import { getToken } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { LEGAL_CONTENT, LegalDoc } from '../lib/legalContent';
import { Nav } from '../components/Nav';
import { Logo } from '../components/Logo';

const VALID_DOCS: LegalDoc[] = ['terms', 'privacy', 'risk', 'about', 'support'];

/** Public legal pages (Terms, Privacy, Risk Disclosure) — reachable both
 * signed-in (via the footer, with the normal nav) and signed-out (via the
 * auth-screen footer), so it renders its own minimal header when logged out
 * instead of requiring auth like every other page. */
export function LegalPage() {
  const { doc } = useParams<{ doc: string }>();
  const { t, lang } = useLanguage();
  const isValid = VALID_DOCS.includes(doc as LegalDoc);
  const content = isValid ? LEGAL_CONTENT[lang][doc as LegalDoc] : null;
  const loggedIn = !!getToken();

  return (
    <div className="page-mesh" style={styles.page}>
      {loggedIn ? (
        <Nav active="" />
      ) : (
        <header style={styles.bareHeader}>
          <Link to="/">
            <Logo />
          </Link>
        </header>
      )}
      <main style={styles.main}>
        {content ? (
          <>
            <h1 style={styles.title}>{content.title}</h1>
            <p style={styles.updated}>{content.updated}</p>
            <p style={styles.intro}>{content.intro}</p>
            {content.sections.map((s) => (
              <section key={s.heading} style={styles.section}>
                <h2 style={styles.heading}>{s.heading}</h2>
                {s.body.map((p, i) => (
                  <p key={i} style={styles.paragraph}>
                    {p}
                  </p>
                ))}
              </section>
            ))}
          </>
        ) : (
          <p style={styles.paragraph}>{t('markets.nothingFound')}</p>
        )}
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', display: 'flex', flexDirection: 'column' },
  bareHeader: { padding: '20px 32px' },
  main: { padding: '20px 32px 64px', maxWidth: 760, margin: '0 auto', width: '100%' },
  title: { fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, letterSpacing: '-0.01em', margin: '0 0 6px' },
  updated: { fontSize: 12, color: 'var(--text-tertiary)', margin: '0 0 20px' },
  intro: { fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 32 },
  section: { marginBottom: 22 },
  heading: { fontSize: 15, fontWeight: 700, margin: '0 0 8px' },
  paragraph: { fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.75, margin: '0 0 8px' },
};
