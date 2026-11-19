import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { getToken } from '../../lib/api';
import { useLanguage, type Key } from '../../lib/i18n';
import { Logo } from '../../components/Logo';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { byVolume, formatPriceValue, useHomeMarket, type HomeMarket, type HomeTicker } from '../home/useHomeMarket';
import { LANDING_COPY } from './landingCopy';
import './landing.css';

/**
 * The landing page candidate for the VOLTEX home address, built to
 * .claude/skills/landing-page-design (owner, 2026-11-19).
 *
 * Layout A, classic hero plus sections: the product is understood from one
 * screen of the market. One offer (one account for spot, futures, copy trading
 * and the card), one audience (people who already trade crypto), one primary
 * action (create an account) repeated unchanged at the bottom.
 *
 * Proof is the market itself: the same public snapshot the current home page
 * reads (useHomeMarket), with its real update time. There are no testimonials,
 * logos or statistics here because none were supplied; the skill forbids
 * inventing them.
 *
 * It is served at /home-preview and is not linked from anywhere, so the
 * approved home page at «/» is untouched until the owner decides.
 */

const NAV_LINKS: { to: string; labelKey: Key }[] = [
  { to: '/markets', labelKey: 'nav.markets' },
  { to: '/trade', labelKey: 'nav.trade' },
  { to: '/futures', labelKey: 'nav.futures' },
  { to: '/copy-trading', labelKey: 'nav.copyTrading' },
  { to: '/card', labelKey: 'nav.card' },
  { to: '/academy', labelKey: 'nav.academy' },
];
const LEGAL_LINKS: { to: string; labelKey: Key }[] = [
  { to: '/legal/terms', labelKey: 'home.footer.terms' },
  { to: '/legal/privacy', labelKey: 'home.footer.privacy' },
  { to: '/legal/risk', labelKey: 'home.footer.risk' },
  { to: '/academy/faq', labelKey: 'home.footer.helpCenter' },
];
const FAQ: readonly [Key, Key][] = [
  ['home.faq.q4', 'home.faq.a4'], ['home.faq.q1', 'home.faq.a1'], ['home.faq.q2', 'home.faq.a2'],
  ['home.faq.q5', 'home.faq.a5'], ['home.faq.q6', 'home.faq.a6'], ['home.faq.q3', 'home.faq.a3'],
];

/* Phosphor Icons, regular weight (MIT, phosphoricons.com): the skill's icon set, drawn inline so no package is added. */
const ICON_PATHS = {
  chart: 'M232,208a8,8,0,0,1-8,8H32a8,8,0,0,1-8-8V48a8,8,0,0,1,16,0V156.69l50.34-50.35a8,8,0,0,1,11.32,0L128,132.69,180.69,80H160a8,8,0,0,1,0-16h40a8,8,0,0,1,8,8v40a8,8,0,0,1-16,0V91.31l-58.34,58.35a8,8,0,0,1-11.32,0L96,123.31l-56,56V200H224A8,8,0,0,1,232,208Z',
  users: 'M244.8,150.4a8,8,0,0,1-11.2-1.6A51.6,51.6,0,0,0,192,128a8,8,0,0,1-7.37-4.89,8,8,0,0,1,0-6.22A8,8,0,0,1,192,112a24,24,0,1,0-23.24-30,8,8,0,1,1-15.5-4A40,40,0,1,1,219,117.51a67.94,67.94,0,0,1,27.43,21.68A8,8,0,0,1,244.8,150.4ZM190.92,212a8,8,0,1,1-13.84,8,57,57,0,0,0-98.16,0,8,8,0,1,1-13.84-8,72.06,72.06,0,0,1,33.74-29.92,48,48,0,1,1,58.36,0A72.06,72.06,0,0,1,190.92,212ZM128,176a32,32,0,1,0-32-32A32,32,0,0,0,128,176ZM72,120a8,8,0,0,0-8-8A24,24,0,1,1,87.24,82a8,8,0,1,0,15.5-4A40,40,0,1,0,37,117.51,67.94,67.94,0,0,0,9.6,139.19a8,8,0,1,0,12.8,9.61A51.6,51.6,0,0,1,64,128,8,8,0,0,0,72,120Z',
  shield: 'M208,40H48A16,16,0,0,0,32,56v56c0,52.72,25.52,84.67,46.93,102.19,23.06,18.86,46,25.26,47,25.53a8,8,0,0,0,4.2,0c1-.27,23.91-6.67,47-25.53C198.48,196.67,224,164.72,224,112V56A16,16,0,0,0,208,40Zm0,72c0,37.07-13.66,67.16-40.6,89.42A129.3,129.3,0,0,1,128,223.62a128.25,128.25,0,0,1-38.92-21.81C61.82,179.51,48,149.3,48,112l0-56,160,0ZM82.34,141.66a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32l-56,56a8,8,0,0,1-11.32,0Z',
  card: 'M224,48H32A16,16,0,0,0,16,64V192a16,16,0,0,0,16,16H224a16,16,0,0,0,16-16V64A16,16,0,0,0,224,48Zm0,16V88H32V64Zm0,128H32V104H224v88Zm-16-24a8,8,0,0,1-8,8H168a8,8,0,0,1,0-16h32A8,8,0,0,1,208,168Zm-64,0a8,8,0,0,1-8,8H120a8,8,0,0,1,0-16h16A8,8,0,0,1,144,168Z',
  arrow: 'M221.66,133.66l-72,72a8,8,0,0,1-11.32-11.32L196.69,136H40a8,8,0,0,1,0-16H196.69L138.34,61.66a8,8,0,0,1,11.32-11.32l72,72A8,8,0,0,1,221.66,133.66Z',
  plus: 'M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z',
} as const;
function Icon({ name, size = 20 }: { name: keyof typeof ICON_PATHS; size?: number }) {
  return <svg viewBox="0 0 256 256" width={size} height={size} fill="currentColor" aria-hidden="true" focusable="false"><path d={ICON_PATHS[name]} /></svg>;
}
const BENEFIT_ICONS = ['chart', 'users', 'shield', 'card'] as const;

const reducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A section rises 32px and fades in once, the first time it enters the viewport. */
function Reveal({ children, as: Tag = 'div', className = '' }: { children: ReactNode; as?: 'div' | 'section'; className?: string }) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') { setShown(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setShown(true); observer.disconnect(); }
    }, { threshold: 0.12 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <Tag ref={ref as never} className={`vxl-reveal${shown ? ' is-in' : ''}${className ? ` ${className}` : ''}`}>{children}</Tag>;
}

/**
 * Words of the tagline. Chinese and Japanese are written without spaces, so
 * they are cut by the browser's own word segmenter, with punctuation kept on
 * the word it follows; where that is missing the sentence stays whole.
 */
function taglineWords(text: string, lang: string): { words: string[]; spaced: boolean } {
  const bySpace = text.split(/\s+/).filter(Boolean);
  type Segmenter = new (locale: string, options: { granularity: 'word' }) => { segment(input: string): Iterable<{ segment: string; isWordLike?: boolean }> };
  const Segmenter = (Intl as unknown as { Segmenter?: Segmenter }).Segmenter;
  if (!/^(zh|ja)/.test(lang) || !Segmenter) return { words: bySpace, spaced: true };
  const words: string[] = [];
  for (const { segment, isWordLike } of new Segmenter(lang, { granularity: 'word' }).segment(text)) {
    if (!segment.trim()) continue;
    if (isWordLike || words.length === 0) words.push(segment); else words[words.length - 1] += segment;
  }
  return words.length > 1 ? { words, spaced: false } : { words: bySpace, spaced: true };
}

/**
 * The tagline: words start muted and take the full text colour one at a time
 * as they cross a line two thirds down the viewport. One observer for all
 * words; a word is lit once and then left alone.
 */
function Tagline({ text, lang }: { text: string; lang: string }) {
  const { words, spaced } = useMemo(() => taglineWords(text, lang), [text, lang]);
  const ref = useRef<HTMLParagraphElement>(null);
  const [lit, setLit] = useState(0);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    if (reducedMotion() || typeof IntersectionObserver === 'undefined') { setLit(words.length); return; }
    setLit(0);
    const spans = Array.from(host.querySelectorAll<HTMLElement>('[data-word]'));
    const observer = new IntersectionObserver(entries => {
      let reached = 0;
      for (const entry of entries) if (entry.isIntersecting) { reached = Math.max(reached, Number((entry.target as HTMLElement).dataset.word) + 1); observer.unobserve(entry.target); }
      // Reading order: everything before a word that crossed the line is lit with it.
      if (reached) setLit(previous => Math.max(previous, reached));
    }, { rootMargin: '0px 0px -34% 0px', threshold: 1 });
    spans.forEach(span => observer.observe(span));
    return () => observer.disconnect();
  }, [words]);
  // Words lit in the same frame still follow one another: each waits 45ms for the one before it.
  const previous = useRef(0);
  const from = previous.current;
  useEffect(() => { previous.current = lit; }, [lit]);
  const word = (entry: string, i: number) => (
    <span key={`${i}-${entry}`} data-word={i} aria-hidden="true" className={i < lit ? 'is-lit' : undefined}
      style={i < lit && i >= from ? { transitionDelay: `${Math.min(i - from, 8) * 45}ms` } : undefined}>{entry}{spaced && i < words.length - 1 ? ' ' : ''}</span>
  );
  const head = words.slice(0, Math.max(words.length - 2, 0));
  const tail = words.slice(head.length);
  return (
    <p ref={ref} className="vxl-tagline-text" aria-label={text}>
      {head.map(word)}
      {/* The last two words travel together, so the closing line is never a single word. */}
      <span className="vxl-tagline-keep">{tail.map((entry, i) => word(entry, head.length + i))}</span>
    </p>
  );
}

function Sparkline({ points, up }: { points: number[]; up: boolean }) {
  if (points.length < 2) return <span className="vxl-spark" aria-hidden="true" />;
  const min = Math.min(...points), max = Math.max(...points), span = max - min || 1;
  const path = points.map((value, i) => `${(i / (points.length - 1) * 100).toFixed(2)},${(26 - (value - min) / span * 24).toFixed(2)}`).join(' ');
  return <svg className="vxl-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><polyline points={path} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" data-up={up} /></svg>;
}

function CoinMark({ base, src }: { base: string; src?: string }) {
  const [failed, setFailed] = useState(false);
  return src && !failed
    ? <img className="vxl-coin" src={src} alt="" width={24} height={24} loading="lazy" decoding="async" onError={() => setFailed(true)} />
    : <span className="vxl-coin vxl-coin-letter" aria-hidden="true">{base.slice(0, 1)}</span>;
}

/** The market board: real rows, skeleton rows while loading, a plain sentence when the data cannot be read. */
function MarketBoard({ market, rows, title, id }: { market: HomeMarket; rows: number; title: string; id: string }) {
  const { t, lang } = useLanguage();
  const copy = LANDING_COPY[lang];
  const list: HomeTicker[] = useMemo(() => byVolume(market.tickers, rows), [market.tickers, rows]);
  const loading = market.tickersStatus === 'loading' && list.length === 0;
  const failed = !loading && list.length === 0;
  const spark = list.some(ticker => (market.priceHistory[ticker.pair]?.length ?? 0) > 1);
  const updated = market.tickerUpdatedAt ? new Date(market.tickerUpdatedAt).toLocaleTimeString(lang === 'en' ? 'en-GB' : lang, { hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <div className="vxl-board" role="region" aria-labelledby={id}>
      <div className="vxl-board-head">
        <h3 id={id} className="title-3">{title}</h3>
        {updated && <span className="caption-5 vxl-muted">{t('home.overview.updated')} {updated}</span>}
      </div>
      {failed ? <p className="vxl-board-empty body-6 vxl-muted" role="status">{t('home.marketDataUnavailable')}</p> : (
        <table className="vxl-table">
          <thead>
            <tr><th scope="col" className="caption-4">{copy.colPair}</th>{(spark || loading) && <th scope="col" className="caption-4 vxl-col-spark" aria-hidden="true" />}<th scope="col" className="caption-4 vxl-num">{copy.colPrice}</th><th scope="col" className="caption-4 vxl-num">{copy.colChange}</th></tr>
          </thead>
          <tbody aria-busy={loading}>
            {loading ? Array.from({ length: rows }, (_, i) => (
              <tr key={i} className="vxl-skeleton-row" aria-hidden="true"><td><span className="vxl-skeleton vxl-skeleton-pair" /></td><td className="vxl-col-spark"><span className="vxl-skeleton vxl-skeleton-spark" /></td><td className="vxl-num"><span className="vxl-skeleton vxl-skeleton-num" /></td><td className="vxl-num"><span className="vxl-skeleton vxl-skeleton-chip" /></td></tr>
            )) : list.map(ticker => {
              const up = ticker.change >= 0;
              return (
                <tr key={ticker.pair}>
                  <td><span className="vxl-pair"><CoinMark base={ticker.base} src={market.logoOf(ticker.base)} /><span className="title-4">{ticker.base}</span><span className="caption-5 vxl-muted">{ticker.quote}</span></span></td>
                  {spark && <td className="vxl-col-spark"><Sparkline points={market.priceHistory[ticker.pair] ?? []} up={up} /></td>}
                  <td className="vxl-num body-5">{formatPriceValue(ticker.price)}</td>
                  <td className="vxl-num"><span className="vxl-change caption-3" data-up={up}>{up ? '+' : ''}{ticker.change.toFixed(2)}%</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function LandingPage() {
  const { t, lang } = useLanguage();
  const copy = LANDING_COPY[lang];
  const market = useHomeMarket();
  const authed = Boolean(getToken());
  const [menu, setMenu] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // The one primary action, the same at the top and at the bottom of the page.
  const action = authed ? { to: '/trade', label: t('home.cta.openTerminal') } : { to: '/register', label: t('home.cta.startTrading') };
  const cta = (extra = '') => <Link className={`vxl-btn vxl-btn-primary button-md${extra}`} to={action.to}>{action.label}<Icon name="arrow" size={18} /></Link>;

  useEffect(() => {
    if (!menu) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenu(false); toggleRef.current?.focus(); } };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', onKey); };
  }, [menu]);

  const markets = market.tickers.length;
  return (
    <div className="vxl" data-landing-candidate>
      <a className="vxl-skip button-sm" href="#vxl-main">{copy.skip}</a>

      <header className="vxl-nav-wrap">
        <nav className="vxl-nav" aria-label={t('home.nav.main')}>
          <Link className="vxl-nav-brand" to="/home-preview" aria-current="page" aria-label="VOLTEX"><Logo /></Link>
          <ul className="vxl-nav-links">
            {NAV_LINKS.map(link => <li key={link.to}><Link className="title-4" to={link.to}>{t(link.labelKey)}</Link></li>)}
          </ul>
          <div className="vxl-nav-end">
            <span className="vxl-nav-lang"><LanguageSwitcher /></span>
            {!authed && <Link className="vxl-nav-login title-4" to="/login">{t('auth.login')}</Link>}
            <Link className="vxl-btn vxl-btn-primary button-sm vxl-nav-cta" to={action.to}>{action.label}</Link>
            <button ref={toggleRef} type="button" className="vxl-menu-toggle" aria-expanded={menu} aria-controls="vxl-menu" aria-label={menu ? copy.menuClose : copy.menuOpen} onClick={() => setMenu(open => !open)}>
              <span aria-hidden="true" /><span aria-hidden="true" />
            </button>
          </div>
        </nav>
      </header>

      <div id="vxl-menu" className="vxl-menu" data-open={menu} role="dialog" aria-modal="true" aria-label={t('home.nav.mobile')} hidden={!menu}>
        <ul>
          {NAV_LINKS.map((link, i) => (
            <li key={link.to} style={{ animationDelay: `${Math.min(i * 60, 400)}ms` }}><Link className="heading-5" to={link.to} onClick={() => setMenu(false)}>{t(link.labelKey)}</Link></li>
          ))}
          {!authed && <li style={{ animationDelay: `${Math.min(NAV_LINKS.length * 60, 400)}ms` }}><Link className="heading-5" to="/login" onClick={() => setMenu(false)}>{t('auth.login')}</Link></li>}
        </ul>
        <div className="vxl-menu-foot">{cta(' vxl-btn-block')}</div>
      </div>

      <main id="vxl-main">
        <section className="vxl-hero" aria-labelledby="vxl-hero-title">
          <div className="vxl-container vxl-hero-inner">
            <p className="caption-1 vxl-overline">{t('trade.spotTab')} · {t('nav.futures')} · {t('nav.copyTrading')}</p>
            <h1 id="vxl-hero-title" className="vxl-hero-title">{copy.heroTitle.map((line, i) => <span key={line}>{i > 0 && ' '}{line}</span>)}</h1>
            <p className="vxl-hero-sub">{copy.heroSub}</p>
            <div className="vxl-hero-action">
              {cta()}
              <p className="caption-2 vxl-muted vxl-hero-risk">{copy.risk}</p>
            </div>
            {markets > 0 && <p className="caption-1 vxl-proof" data-landing-proof><span className="vxl-dot" aria-hidden="true" />{copy.proof.replace('{n}', String(markets))}</p>}
          </div>
          <div className="vxl-container vxl-hero-visual">
            <MarketBoard market={market} rows={5} title={copy.boardTitle} id="vxl-board-hero" />
          </div>
        </section>

        <Reveal as="section" className="vxl-section">
          <div className="vxl-container">
            <div className="vxl-section-head">
              <h2 className="vxl-h2">{copy.benefitsTitle}</h2>
              <p className="vxl-lead">{copy.benefitsLead}</p>
            </div>
            <ul className="vxl-benefits">
              {copy.benefits.map((benefit, i) => (
                <li key={benefit.title} className="vxl-card">
                  <span className="vxl-card-icon"><Icon name={BENEFIT_ICONS[i]} size={20} /></span>
                  <h3 className="title-1">{benefit.title}</h3>
                  <p className="body-3 vxl-muted">{benefit.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>

        <section className="vxl-section vxl-tagline" aria-label={copy.tagline}>
          <div className="vxl-container"><Tagline text={copy.tagline} lang={lang} /></div>
        </section>

        <Reveal as="section" className="vxl-section">
          <div className="vxl-container">
            <div className="vxl-section-head"><h2 className="vxl-h2">{copy.stepsTitle}</h2></div>
            <ol className="vxl-steps">
              {copy.steps.map((step, i) => (
                <li key={step.title} className="vxl-card">
                  <span className="caption-3 vxl-step-no" aria-hidden="true">0{i + 1}</span>
                  <h3 className="title-1">{step.title}</h3>
                  <p className="body-3 vxl-muted">{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </Reveal>

        <Reveal as="section" className="vxl-section">
          <div className="vxl-container">
            <div className="vxl-section-head">
              <h2 className="vxl-h2">{copy.marketsTitle}</h2>
              <p className="vxl-lead">{copy.marketsLead}</p>
            </div>
            <MarketBoard market={market} rows={8} title={copy.boardTitle} id="vxl-board-markets" />
            <p className="vxl-section-link"><Link className="vxl-btn vxl-btn-ghost button-md" to="/markets">{t('home.cta.viewMarkets')}<Icon name="arrow" size={18} /></Link></p>
          </div>
        </Reveal>

        <Reveal as="section" className="vxl-section">
          <div className="vxl-container vxl-faq-wrap">
            <div className="vxl-section-head"><h2 className="vxl-h2">{t('home.faq.title')}</h2><p className="vxl-lead">{copy.risk}</p></div>
            <ul className="vxl-faq">
              {FAQ.map(([question, answer], i) => {
                const open = openFaq === i;
                return (
                  <li key={question} className="vxl-faq-item" data-open={open}>
                    <h3><button type="button" className="vxl-faq-q title-2" aria-expanded={open} aria-controls={`vxl-faq-${i}`} onClick={() => setOpenFaq(open ? null : i)}>
                      <span>{t(question)}</span><span className="vxl-faq-mark"><Icon name="plus" size={20} /></span>
                    </button></h3>
                    <div id={`vxl-faq-${i}`} className="vxl-faq-a body-3 vxl-muted" hidden={!open}>{t(answer)}</div>
                  </li>
                );
              })}
            </ul>
          </div>
        </Reveal>

        <Reveal as="section" className="vxl-section">
          <div className="vxl-container">
            <div className="vxl-final">
              <h2 className="vxl-final-title">{copy.finalTitle}</h2>
              <p className="body-3 vxl-muted vxl-final-text">{copy.risk}</p>
              {cta()}
            </div>
          </div>
        </Reveal>
      </main>

      <footer className="vxl-footer">
        <div className="vxl-container vxl-footer-inner">
          <div className="vxl-footer-brand"><Logo /><p className="body-6 vxl-muted">{t('home.footer.tagline')}</p></div>
          <nav aria-label={t('home.footer.legal')}>
            <ul className="vxl-footer-links">
              {LEGAL_LINKS.map(link => <li key={link.to}><Link className="caption-1" to={link.to}>{t(link.labelKey)}</Link></li>)}
            </ul>
          </nav>
          <p className="caption-5 vxl-muted vxl-footer-note">© {new Date().getFullYear()} VOLTEX. {t('home.footer.rights')} {t('home.footer.riskNote')}</p>
        </div>
      </footer>
    </div>
  );
}
