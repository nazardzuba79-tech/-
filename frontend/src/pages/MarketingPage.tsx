import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useLanguage, localeOf, Key } from '../lib/i18n';
import { Logo } from '../components/Logo';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { CryptoIcon } from '../components/CryptoIcon';
import { Sparkline } from '../components/Sparkline';
import { CardFace, ICY_CARD_THEME } from '../components/CardFace';
import { PhoneMockup } from '../components/PhoneMockup';
import { CfdMarketsSection } from '../components/CfdMarketsSection';
import { parseChangePercent } from '../lib/priceChange';

const NAV_LINKS = [
  { to: '/markets', key: 'nav.markets' as const },
  { to: '/trade', key: 'nav.trade' as const },
  { to: '/futures', key: 'nav.futures' as const },
  { to: '/copy-trading', key: 'nav.copyTrading' as const },
];

const HERO_COINS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'TRX/USDT', 'DOGE/USDT'];

type Ticker = Awaited<ReturnType<typeof api.getExternalTickers>>['tickers'][number];

/** Public marketing landing — the v0-designed "VOLTEX" homepage the owner
 * supplied, ported faithfully (hero + phone-mockup preview + live market
 * strip). Unlike the trading/wallet pages there's no existing functionality
 * here to preserve — before this, "/" went straight into the login form —
 * so this one is a real 1:1 structural port, not a palette-only reskin.
 * Real ticker data throughout; the phone mockup's wallet numbers are a
 * generic illustrative UI preview (not tied to any account), same as v0's
 * own mockup. CTAs route to /login (our real auth flow — v0's own export
 * has no login form, its buttons just deep-link straight into the app). */
export function MarketingPage() {
  const { t, lang } = useLanguage();
  const [tickers, setTickers] = useState<Map<string, Ticker>>(new Map());
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    function load() {
      api
        .getExternalTickers()
        .then((res) => {
          const map = new Map<string, Ticker>();
          for (const tk of res.tickers) map.set(tk.pair, tk);
          setTickers(map);
        })
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  const fmt = (n: number) => n.toLocaleString(localeOf(lang), { maximumFractionDigits: n < 1 ? 6 : 2 });

  return (
    <div style={{ ...styles.page, ...MARKETING_V0_VARS }}>
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.headerLeft}>
            <Logo />
            <nav className="marketing-nav-desktop" style={styles.navDesktop}>
              {NAV_LINKS.map((l) => (
                <Link key={l.to} to={l.to} style={styles.navLink}>
                  {t(l.key)}
                </Link>
              ))}
            </nav>
          </div>
          <div className="marketing-nav-desktop" style={styles.headerRight}>
            <LanguageSwitcher />
            <Link to="/login" style={styles.loginLink}>
              {t('auth.login')}
            </Link>
            <Link to="/login" style={styles.startBtn}>
              {t('marketing.startTrading')}
            </Link>
          </div>
          <button className="marketing-burger" style={styles.burgerBtn} onClick={() => setMobileOpen((v) => !v)} aria-label="menu">
            <BurgerIcon open={mobileOpen} />
          </button>
        </div>
        <div className={`marketing-mobile-menu${mobileOpen ? ' open' : ''}`} style={styles.mobileMenu}>
          {NAV_LINKS.map((l) => (
            <Link key={l.to} to={l.to} style={styles.mobileLink} onClick={() => setMobileOpen(false)}>
              {t(l.key)}
            </Link>
          ))}
          <div style={styles.mobileCtaRow}>
            <Link to="/login" style={{ ...styles.loginLink, ...styles.mobileLoginBtn }} onClick={() => setMobileOpen(false)}>
              {t('auth.login')}
            </Link>
            <Link to="/login" style={{ ...styles.startBtn, flex: 1, textAlign: 'center' }} onClick={() => setMobileOpen(false)}>
              {t('marketing.startTrading')}
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section style={styles.hero}>
          <div className="bg-grid" />
          <div className="hero-glow hero-glow-cyan" />
          <div className="hero-glow hero-glow-purple" />
          <div className="marketing-hero-grid" style={{ ...styles.heroGrid, position: 'relative' }}>
            <div style={styles.heroLeft}>
              <div style={styles.heroPerks}>
                {[t('marketing.heroPerk1'), t('marketing.heroPerk2'), t('marketing.heroPerk3'), t('marketing.heroPerk4')].map((perk) => (
                  <span key={perk} style={styles.heroPerkBadge}>
                    <CheckIcon /> {perk}
                  </span>
                ))}
              </div>
              <span style={styles.eyebrow}>
                <span style={styles.eyebrowDot} />
                {t('marketing.eyebrow')}
              </span>
              <h1 style={styles.heroTitle}>{t('auth.heroTagline')}</h1>
              <div style={styles.heroCtaRow}>
                <Link to="/login" style={styles.heroPrimaryBtn}>
                  {t('marketing.startTrading')} <ArrowIcon />
                </Link>
                <a href="#markets" style={styles.heroSecondaryBtn}>
                  {t('marketing.exploreMarkets')}
                </a>
              </div>
              <div style={styles.heroStatRow}>
                <HeroStat value={t('marketing.statFeeValue')} label={t('marketing.statFeeLabel')} />
                <HeroStat value={t('marketing.statLeverageValue')} label={t('marketing.statLeverageLabel')} />
                <HeroStat value={t('marketing.statAssetsValue')} label={t('marketing.statAssetsLabel')} />
              </div>
            </div>

            <div style={styles.heroRight}>
              <HeroPreviewPanel tickers={tickers} t={t} />
            </div>
          </div>
        </section>

        <CfdMarketsSection id="markets" />

        <FeaturesSection t={t} />

        <GlobalStatsSection t={t} />
        <SupportedAssetsSection tickers={tickers} fmt={fmt} t={t} />

        <section style={styles.perksSection}>
          <div style={styles.perksBanner}>
            <div className="card-tilt-wrap-photo" style={{ ...styles.perksBannerCard, transform: 'translate(-18px, -20px)' }}>
              <CardFace theme={ICY_CARD_THEME} last4="4417" holderName="YOUR NAME HERE" network="mastercard" imageSrc="/cards/voltex-card-dark.png" imageWidth={440} />
            </div>
            <div style={styles.perksBannerText}>
              <span style={styles.perksBannerKicker}>{t('auth.perks.cardKicker')}</span>
              <h2 style={styles.perksBannerTitle}>{t('auth.perks.cardTitle')}</h2>
              <p style={styles.perksBannerLead}>{t('auth.perks.cardText')}</p>
              <div style={styles.cardBenefitList}>
                <CardBenefitItem color="#18c8ff" icon={<PayTapIcon />} text={t('card.feature1.title')} />
                <CardBenefitItem color="#6c5ce7" icon={<ConvertSwapIcon />} text={t('card.feature3.title')} />
                <CardBenefitItem color="#18c8ff" icon={<AtmSlotIcon />} text={t('card.feature4.title')} />
                <CardBenefitItem color="#6c5ce7" icon={<PercentIcon />} text={t('card.feature5.title')} />
              </div>
              <Link to="/login" style={styles.heroPrimaryBtn}>
                {t('marketing.startTrading')} <ArrowIcon small />
              </Link>
            </div>
          </div>

          <div style={styles.perksGrid}>
            <PerkCard icon={<PercentIcon />} title={t('auth.perks.fee.title')} text={t('auth.perks.fee.text')} />
            <PerkCard icon={<AssetsIcon />} title={t('auth.perks.assets.title')} text={t('auth.perks.assets.text')} />
          </div>
        </section>

        <FaqSection t={t} />
        <FinalCtaSection t={t} />
        <SiteFooterSection t={t} />
      </main>
    </div>
  );
}

function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div style={styles.heroStatValue}>{value}</div>
      <div style={styles.heroStatLabel}>{label}</div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Features — v0's "Why VOLTEX" tile grid. Copy describes only real,      */
/* already-built functionality (2FA, login history, withdrawal limits,   */
/* the actual chart/order toolset, the real $20k copy-trading gate) —    */
/* v0's own version claimed fabricated benchmark numbers (1.4M orders/sec,*/
/* sub-10ms latency, 180+ countries, 50+ fiat rails) that don't describe  */
/* this exchange, so those are left out rather than ported verbatim. */
function FeaturesSection({ t }: { t: ReturnType<typeof useLanguage>['t'] }) {
  return (
    <section style={styles.featuresSection}>
      <div style={{ maxWidth: 640 }}>
        <span style={styles.eyebrow}>
          <span style={styles.eyebrowDot} />
          {t('marketing.featuresLabel')}
        </span>
        <h2 style={styles.featuresTitle}>{t('marketing.featuresTitle')}</h2>
        <p style={styles.featuresSubtitle}>{t('marketing.featuresSubtitle')}</p>
      </div>

      <div className="marketing-features-grid" style={styles.featuresGrid}>
        <FeatureTile span={2}>
          <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 260px' }}>
              <FeatureIconBadge>
                <ZapIcon />
              </FeatureIconBadge>
              <h3 style={styles.featureTileTitle}>{t('marketing.feature.execution.title')}</h3>
              <p style={styles.featureTileText}>{t('marketing.feature.execution.text')}</p>
            </div>
            <div style={{ flex: '1 1 220px', minWidth: 200 }}>
              <Sparkline points={[20, 24, 22, 30, 28, 38, 34, 46, 52, 48, 60, 72]} width={220} height={80} />
            </div>
          </div>
        </FeatureTile>

        <FeatureTile>
          <FeatureIconBadge>
            <ShieldIcon />
          </FeatureIconBadge>
          <h3 style={styles.featureTileTitle}>{t('marketing.feature.security.title')}</h3>
          <p style={styles.featureTileText}>{t('marketing.feature.security.text')}</p>
          <ul style={styles.featureList}>
            {[t('marketing.feature.security.item1'), t('marketing.feature.security.item2'), t('marketing.feature.security.item3')].map(
              (item) => (
                <li key={item} style={styles.featureListItem}>
                  <CheckIcon /> {item}
                </li>
              )
            )}
          </ul>
        </FeatureTile>

        <FeatureTile>
          <FeatureIconBadge>
            <ChartIcon />
          </FeatureIconBadge>
          <h3 style={styles.featureTileTitle}>{t('marketing.feature.tools.title')}</h3>
          <p style={styles.featureTileText}>{t('marketing.feature.tools.text')}</p>
        </FeatureTile>

        <FeatureTile>
          <FeatureIconBadge>
            <UsersIcon />
          </FeatureIconBadge>
          <h3 style={styles.featureTileTitle}>{t('marketing.feature.copyTrading.title')}</h3>
          <p style={styles.featureTileText}>{t('marketing.feature.copyTrading.text')}</p>
        </FeatureTile>

        <FeatureTile>
          <FeatureIconBadge>
            <MobileIcon />
          </FeatureIconBadge>
          <h3 style={styles.featureTileTitle}>{t('marketing.feature.mobile.title')}</h3>
          <p style={styles.featureTileText}>{t('marketing.feature.mobile.text')}</p>
        </FeatureTile>

        <FeatureTile span={3}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 260px' }}>
              <FeatureIconBadge>
                <GlobeIcon />
              </FeatureIconBadge>
              <h3 style={styles.featureTileTitle}>{t('marketing.feature.global.title')}</h3>
              <p style={{ ...styles.featureTileText, maxWidth: 460 }}>{t('marketing.feature.global.text')}</p>
            </div>
            <div style={{ display: 'flex', gap: 32 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={styles.heroStatValue}>{t('marketing.statAssetsValue')}</div>
                <div style={styles.heroStatLabel}>{t('marketing.statAssetsLabel')}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={styles.heroStatValue}>{t('marketing.statLeverageValue')}</div>
                <div style={styles.heroStatLabel}>{t('marketing.statLeverageLabel')}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={styles.heroStatValue}>{t('marketing.statNoKycLabel')}</div>
                <div style={styles.heroStatLabel}>KYC</div>
              </div>
            </div>
          </div>
        </FeatureTile>
      </div>
    </section>
  );
}

function FeatureTile({ children, span }: { children: React.ReactNode; span?: number }) {
  return (
    <div className="marketing-feature-tile" style={{ ...styles.featureTile, gridColumn: span ? `span ${span}` : undefined }}>
      {children}
    </div>
  );
}

function FeatureIconBadge({ children }: { children: React.ReactNode }) {
  return <span style={styles.featureIconBadge}>{children}</span>;
}

/* ---------------------------------------------------------------------- */
/* Global stats strip — v0's version claims fabricated business metrics   */
/* ($1.2T+ quarterly volume, 32M+ verified users, 180+ countries). Those   */
/* aren't true of this exchange, so the same 4-stat visual band instead   */
/* shows the real, already-verified claims used elsewhere on this site. */
function GlobalStatsSection({ t }: { t: ReturnType<typeof useLanguage>['t'] }) {
  const stats: [string, string][] = [
    [t('marketing.statAssetsValue'), t('marketing.statAssetsLabel')],
    [t('marketing.statLeverageValue'), t('marketing.statLeverageLabel')],
    [t('marketing.statFeeValue'), t('marketing.statFeeLabel')],
    ['KYC', t('marketing.statNoKycLabel')],
  ];
  return (
    <section style={styles.globalStats}>
      <div className="marketing-global-stats-grid" style={styles.globalStatsGrid}>
        {stats.map(([v, l]) => (
          <div key={l} style={{ textAlign: 'center' }}>
            <div style={styles.globalStatValue}>{v}</div>
            <div style={styles.heroStatLabel}>{l}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------- */
/* Supported assets grid — real pairs, real live prices (same api call as */
/* the hero/overview panels above), just a wider, denser list. */
const SUPPORTED_ASSET_PAIRS = [
  'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT', 'ADA/USDT',
  'AVAX/USDT', 'DOGE/USDT', 'LINK/USDT', 'DOT/USDT', 'TON/USDT', 'TRX/USDT',
];

function SupportedAssetsSection({
  tickers,
  fmt,
  t,
}: {
  tickers: Map<string, Ticker>;
  fmt: (n: number) => string;
  t: ReturnType<typeof useLanguage>['t'];
}) {
  return (
    <section style={styles.supportedSection}>
      <div style={{ maxWidth: 640 }}>
        <span style={styles.eyebrow}>
          <span style={styles.eyebrowDot} />
          {t('marketing.supportedAssetsLabel')}
        </span>
        <h2 style={styles.featuresTitle}>{t('marketing.supportedAssetsTitle')}</h2>
        <p style={styles.featuresSubtitle}>{t('marketing.supportedAssetsSubtitle')}</p>
      </div>
      <div style={styles.supportedGrid}>
        {SUPPORTED_ASSET_PAIRS.map((pair) => {
          const tk = tickers.get(pair);
          const change = tk ? parseChangePercent(tk.changePercent24h, pair) : 0;
          const base = pair.split('/')[0];
          const positive = change >= 0;
          return (
            <div key={pair} style={styles.supportedRow}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <CryptoIcon symbol={base} size={26} />
                <span style={{ fontSize: 13, fontWeight: 700 }}>{base}</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="mono" style={{ fontSize: 13, fontWeight: 700 }}>
                  {tk ? fmt(parseFloat(tk.lastPrice)) : '—'}
                </div>
                <div className={`mono ${positive ? 'text-buy' : 'text-sell'}`} style={{ fontSize: 11, fontWeight: 700 }}>
                  {tk ? `${positive ? '+' : ''}${change.toFixed(2)}%` : ''}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------- */
/* FAQ — honest answers describing what this exchange actually does      */
/* (real 0% spot fee, real no-KYC trading, real 2FA, real $20k copy-      */
/* trading gate, no native mobile app yet) rather than v0's placeholder   */
/* claims (cold-storage custody, proof-of-reserves reports, 1.4M orders/  */
/* sec) that would misrepresent a real, functioning exchange. */
const FAQ_KEYS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'] as const;

function FaqSection({ t }: { t: ReturnType<typeof useLanguage>['t'] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section style={styles.faqSection}>
      <div style={{ textAlign: 'center' }}>
        <span style={{ ...styles.eyebrow, justifyContent: 'center' }}>
          <span style={styles.eyebrowDot} />
          {t('marketing.faqLabel')}
        </span>
        <h2 style={{ ...styles.featuresTitle, marginTop: 12 }}>{t('marketing.faqTitle')}</h2>
      </div>
      <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {FAQ_KEYS.map((k, i) => {
          const isOpen = open === i;
          return (
            <div key={k} style={styles.faqItem}>
              <button type="button" onClick={() => setOpen(isOpen ? null : i)} style={styles.faqQuestion} aria-expanded={isOpen}>
                <span>{t(`marketing.faq.${k}` as Key)}</span>
                <PlusIcon rotated={isOpen} />
              </button>
              {isOpen && <p style={styles.faqAnswer}>{t(`marketing.faq.${k.replace('q', 'a')}` as Key)}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FinalCtaSection({ t }: { t: ReturnType<typeof useLanguage>['t'] }) {
  return (
    <section style={styles.finalCtaSection}>
      <div style={styles.finalCtaCard}>
        <h2 style={styles.finalCtaTitle}>{t('marketing.finalCtaTitle')}</h2>
        <p style={styles.finalCtaSubtitle}>{t('marketing.finalCtaSubtitle')}</p>
        <div style={{ ...styles.heroCtaRow, justifyContent: 'center', marginTop: 28 }}>
          <Link to="/login" style={styles.heroPrimaryBtn}>
            {t('marketing.startTrading')} <ArrowIcon />
          </Link>
          <Link to="/markets" style={styles.heroSecondaryBtn}>
            {t('marketing.exploreMarkets')}
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------- */
/* Site footer — v0's version links to pages this app doesn't have        */
/* (Careers, Newsroom, Status, Docs, API...). Same 3-column layout, but    */
/* every link routes to a page that actually exists here. */
const FOOTER_COLS: { titleKey: 'marketing.footerProducts' | 'marketing.footerCompany' | 'marketing.footerSupportCol'; links: { to: string; key: string }[] }[] = [
  {
    titleKey: 'marketing.footerProducts',
    links: [
      { to: '/trade', key: 'nav.trade' },
      { to: '/futures', key: 'nav.futures' },
      { to: '/copy-trading', key: 'nav.copyTrading' },
      { to: '/card', key: 'nav.card' },
    ],
  },
  {
    titleKey: 'marketing.footerCompany',
    links: [
      { to: '/legal/about', key: 'footer.about' },
      { to: '/legal/terms', key: 'footer.terms' },
      { to: '/legal/privacy', key: 'footer.privacy' },
      { to: '/legal/risk', key: 'footer.risk' },
    ],
  },
  {
    titleKey: 'marketing.footerSupportCol',
    links: [
      { to: '/legal/support', key: 'footer.support' },
      { to: '/markets', key: 'nav.markets' },
      { to: '/wallet', key: 'nav.wallet' },
    ],
  },
];

function SiteFooterSection({ t }: { t: ReturnType<typeof useLanguage>['t'] }) {
  return (
    <footer style={styles.siteFooter}>
      <div style={styles.siteFooterInner}>
        <div className="marketing-site-footer-grid" style={styles.siteFooterGrid}>
          <div className="marketing-site-footer-logo-col" style={{ gridColumn: 'span 2' }}>
            <Logo />
            <p style={styles.siteFooterTagline}>{t('marketing.footerTagline')}</p>
          </div>
          {FOOTER_COLS.map((col) => (
            <div key={col.titleKey}>
              <h3 style={styles.siteFooterColTitle}>{t(col.titleKey)}</h3>
              <ul style={styles.siteFooterLinkList}>
                {col.links.map((l) => (
                  <li key={l.to}>
                    <Link to={l.to} style={styles.siteFooterLink}>
                      {t(l.key as Key)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div style={styles.siteFooterBottom}>
          <p style={{ margin: 0 }}>{t('footer.rights')}</p>
          <p style={{ margin: 0, maxWidth: 560, textAlign: 'right' }}>{t('footer.riskWarning')}</p>
        </div>
      </div>
    </footer>
  );
}

/** The hero's whole visual: a big tilted phone (PhoneMockup — same
 * component used on the login hero) as the centerpiece, with two small
 * floating chips of real data orbiting it (BTC/USDT price/change, and
 * this batch's combined 24h quote volume) — same spirit as the phone's own
 * "illustrative but honest" numbers, just pulled from the same live
 * ticker feed the rest of this page already polls. */
function HeroPreviewPanel({
  tickers,
  t,
}: {
  tickers: Map<string, Ticker>;
  t: ReturnType<typeof useLanguage>['t'];
}) {
  const btc = tickers.get('BTC/USDT');
  const btcChange = btc ? parseChangePercent(btc.changePercent24h, 'BTC/USDT') : 0;
  const totalQuoteVolume = HERO_COINS.reduce((sum, pair) => {
    const tk = tickers.get(pair);
    return sum + (tk ? parseFloat(tk.quoteVolume24h) : 0);
  }, 0);

  return (
    <div style={styles.previewWrap} className="marketing-phone">
      <span className="hero-orbit hero-orbit-a" />
      <span className="hero-orbit hero-orbit-b" />
      <span className="hero-phone-glow" />
      <span className="hero-grid-orb" />
      <span className="hero-star hero-star-1" />
      <span className="hero-star hero-star-2" />
      <span className="hero-star hero-star-3" />
      <span className="hero-star hero-star-4" />
      <span className="hero-star hero-star-5" />

      {btc && (
        <div style={{ ...styles.floatChip, ...styles.floatChipTicker }}>
          <span className="live-pulse-dot" />
          <span style={{ fontWeight: 700 }}>BTC/USDT</span>
          <span className={btcChange >= 0 ? 'text-buy' : 'text-sell'}>
            {btcChange >= 0 ? '+' : ''}
            {btcChange.toFixed(2)}%
          </span>
        </div>
      )}
      {totalQuoteVolume > 0 && (
        <div style={{ ...styles.floatChip, ...styles.floatChipVolume }}>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{t('marketing.heroVolumeLabel')}</span>
          <strong className="mono" style={{ fontSize: 16 }}>
            ${totalQuoteVolume.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 })}
          </strong>
        </div>
      )}

      <div style={styles.phoneTiltWrap}>
        <PhoneMockup style={{ width: 320 }} />
      </div>
    </div>
  );
}

function ArrowIcon({ small }: { small?: boolean }) {
  const s = small ? 13 : 15;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--buy)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function BurgerIcon({ open }: { open: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round">
      {open ? (
        <>
          <line x1="5" y1="5" x2="19" y2="19" />
          <line x1="19" y1="5" x2="5" y2="19" />
        </>
      ) : (
        <>
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </>
      )}
    </svg>
  );
}

const PERK_ICON_PROPS = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'var(--accent)',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function PercentIcon() {
  return (
    <svg {...PERK_ICON_PROPS}>
      <line x1="19" y1="5" x2="5" y2="19" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </svg>
  );
}

function AssetsIcon() {
  return (
    <svg {...PERK_ICON_PROPS} width={20} height={20}>
      <circle cx="9" cy="9" r="6" />
      <circle cx="15" cy="15" r="6" opacity={0.5} />
    </svg>
  );
}

function ZapIcon() {
  return (
    <svg {...PERK_ICON_PROPS} width={20} height={20}>
      <path d="M13 2L4 14h7l-1 8 10-12h-7l1-8z" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg {...PERK_ICON_PROPS} width={20} height={20}>
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}
function ChartIcon() {
  return (
    <svg {...PERK_ICON_PROPS} width={20} height={20}>
      <path d="M3 3v18h18" />
      <path d="M7 15l4-5 3 3 5-7" />
    </svg>
  );
}
function UsersIcon() {
  return (
    <svg {...PERK_ICON_PROPS} width={20} height={20}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <circle cx="18" cy="9" r="2.4" />
      <path d="M15.5 20c0-2.6 1.8-4.7 4-5.4" />
    </svg>
  );
}
function MobileIcon() {
  return (
    <svg {...PERK_ICON_PROPS} width={20} height={20}>
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <line x1="10" y1="19" x2="14" y2="19" />
    </svg>
  );
}
function GlobeIcon() {
  return (
    <svg {...PERK_ICON_PROPS} width={20} height={20}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M2.5 12h19" />
      <path d="M12 2.5c2.6 2.6 4 6 4 9.5s-1.4 6.9-4 9.5c-2.6-2.6-4-6-4-9.5s1.4-6.9 4-9.5z" />
    </svg>
  );
}
function PlusIcon({ rotated }: { rotated?: boolean }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--accent)"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transition: 'transform 0.2s ease', transform: rotated ? 'rotate(45deg)' : 'none', flexShrink: 0 }}
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

// Compact icon + one-liner used in the card promo banner — same 4 real
// perks as CardPage's full feature grid (Apple/Google Pay, no conversion
// fee, fee-free ATM, 8% cashback), just condensed to a title-only glance.
function CardBenefitItem({ color, icon, text }: { color: string; icon: React.ReactNode; text: string }) {
  return (
    <div style={styles.cardBenefitItem}>
      <span style={{ ...styles.cardBenefitIconBadge, background: `${color}24`, color }}>{icon}</span>
      <span style={styles.cardBenefitText}>{text}</span>
    </div>
  );
}

function PayTapIcon() {
  return (
    <svg {...PERK_ICON_PROPS} width={16} height={16}>
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <path d="M2 9c1.3 1.3 1.3 4.7 0 6M4.5 6.5c2.2 2.2 2.2 8.8 0 11" strokeWidth="1.8" />
    </svg>
  );
}

function ConvertSwapIcon() {
  return (
    <svg {...PERK_ICON_PROPS} width={16} height={16}>
      <path d="M4 8h13l-3-3M20 16H7l3 3" />
    </svg>
  );
}

function AtmSlotIcon() {
  return (
    <svg {...PERK_ICON_PROPS} width={16} height={16}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}

function PerkCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="card-hover" style={styles.perkCard}>
      <div style={styles.perkIconBadge}>{icon}</div>
      <h3 style={styles.perkTitle}>{title}</h3>
      <p style={styles.perkText}>{text}</p>
    </div>
  );
}

// v0-designed palette (see the "VOLTEX" v0 export the owner supplied),
// scoped to this page the same way every other reskinned page re-themes
// itself.
const MARKETING_V0_VARS = {
  ['--bg' as any]: '#080b12',
  ['--panel' as any]: '#121925',
  ['--panel-alt' as any]: '#0e131d',
  ['--panel-alt-hover' as any]: '#172131',
  ['--border' as any]: '#1c2735',
  ['--text-primary' as any]: '#f5f7fa',
  ['--text-secondary' as any]: '#8b96a8',
  ['--text-tertiary' as any]: '#6b7789',
  ['--buy' as any]: '#19d98b',
  ['--buy-dim' as any]: 'rgba(25,217,139,0.14)',
  ['--sell' as any]: '#ff4d67',
  ['--sell-dim' as any]: 'rgba(255,77,103,0.14)',
  ['--accent' as any]: '#18c8ff',
  ['--accent-hover' as any]: '#3fd4ff',
  ['--accent-dim' as any]: 'rgba(24,200,255,0.14)',
  ['--on-accent' as any]: '#04121b',
} as React.CSSProperties;

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'var(--bg)', color: 'var(--text-primary)' },
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 50,
    background: 'rgba(8,11,18,0.85)',
    backdropFilter: 'blur(16px)',
    borderBottom: '1px solid var(--border)',
  },
  headerInner: {
    maxWidth: 1280,
    margin: '0 auto',
    padding: '0 20px',
    height: 64,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 32 },
  navDesktop: { display: 'flex', alignItems: 'center', gap: 4 },
  navLink: { color: 'var(--text-secondary)', fontSize: 14, fontWeight: 600, padding: '8px 12px', borderRadius: 8 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 12 },
  loginLink: { color: 'var(--text-secondary)', fontSize: 14, fontWeight: 600, padding: '8px 14px' },
  startBtn: {
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    fontSize: 14,
    fontWeight: 700,
    padding: '9px 18px',
    borderRadius: 10,
  },
  burgerBtn: { display: 'none', background: 'transparent', border: 'none' },
  mobileMenu: { display: 'none', flexDirection: 'column', padding: '8px 20px 16px', borderTop: '1px solid var(--border)', gap: 4 },
  mobileLink: { padding: '10px 4px', color: 'var(--text-primary)', fontSize: 14, fontWeight: 600 },
  mobileCtaRow: { display: 'flex', gap: 10, marginTop: 10 },
  mobileLoginBtn: { border: '1px solid var(--border)', borderRadius: 10, textAlign: 'center', flex: 1 },
  hero: { position: 'relative', overflow: 'hidden', padding: '64px 20px' },
  heroGrid: {
    maxWidth: 1440,
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: '0.8fr 1.3fr',
    gap: 40,
    alignItems: 'center',
  },
  heroLeft: { minWidth: 0 },
  heroPerks: { display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 26 },
  heroPerkBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    padding: '7px 14px',
    borderRadius: 999,
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    fontSize: 12.5,
    fontWeight: 600,
    color: 'var(--text-secondary)',
  },
  eyebrow: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--accent)',
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
  },
  eyebrowDot: { width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)' },
  heroTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 46,
    fontWeight: 800,
    lineHeight: 1.12,
    letterSpacing: '-0.02em',
    margin: '18px 0 0',
    maxWidth: 560,
    background: 'linear-gradient(120deg, var(--text-primary) 45%, var(--accent) 120%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  heroCtaRow: { display: 'flex', gap: 12, marginTop: 32, flexWrap: 'wrap' },
  heroPrimaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    background: 'linear-gradient(135deg, #7c5cff 0%, var(--accent) 100%)',
    color: 'var(--on-accent)',
    fontSize: 15,
    fontWeight: 700,
    padding: '13px 24px',
    borderRadius: 12,
    boxShadow: '0 12px 30px -8px rgba(124,92,255,0.55)',
  },
  heroSecondaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
    fontSize: 15,
    fontWeight: 700,
    padding: '13px 24px',
    borderRadius: 12,
  },
  heroStatRow: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24, marginTop: 44, maxWidth: 420 },
  heroStatValue: { fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.01em' },
  heroStatLabel: { marginTop: 4, fontSize: 12.5, color: 'var(--text-tertiary)' },
  heroRight: { position: 'relative', minHeight: 700, marginRight: 10 },
  previewWrap: { position: 'relative', maxWidth: 680, height: 640, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  phoneTiltWrap: { transform: 'rotate(-7deg)', position: 'relative', zIndex: 2 },
  floatChip: {
    position: 'absolute',
    zIndex: 3,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 14,
    padding: '10px 16px',
    fontSize: 13,
    boxShadow: '0 20px 50px rgba(0,0,0,0.35)',
  },
  floatChipTicker: { top: '30%', left: 0 },
  floatChipVolume: { flexDirection: 'column', alignItems: 'flex-start', gap: 2, bottom: '18%', right: 10 },
  perksSection: { maxWidth: 1280, margin: '0 auto', padding: '20px 20px 64px' },
  perksBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: 56,
    flexWrap: 'wrap',
    background: 'linear-gradient(135deg, var(--panel) 0%, var(--panel-alt) 100%)',
    border: '1px solid var(--border)',
    borderRadius: 24,
    padding: '48px 56px',
    marginBottom: 40,
    boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
  },
  perksBannerCard: { flexShrink: 0, margin: '0 auto' },
  perksBannerText: { flex: '1 1 320px', minWidth: 280 },
  perksBannerKicker: {
    display: 'inline-block',
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--accent)',
    marginBottom: 10,
  },
  perksBannerTitle: {
    fontSize: 26,
    margin: '0 0 12px',
    fontFamily: 'var(--font-display)',
    fontWeight: 800,
    letterSpacing: '-0.01em',
    lineHeight: 1.25,
  },
  perksBannerLead: { fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.65, maxWidth: 460, margin: '0 0 20px' },
  cardBenefitList: { display: 'flex', flexDirection: 'column', gap: 12, margin: '0 0 24px' },
  cardBenefitItem: { display: 'flex', alignItems: 'center', gap: 10 },
  cardBenefitIconBadge: {
    width: 28,
    height: 28,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  cardBenefitText: { fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' },
  perksGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 16,
  },
  perkCard: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 14,
    padding: 24,
  },
  perkIconBadge: {
    width: 40,
    height: 40,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    background: 'var(--accent-dim)',
    marginBottom: 14,
  },
  perkTitle: {
    fontSize: 15,
    margin: '0 0 6px',
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
  },
  perkText: { fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 },

  featuresSection: { maxWidth: 1280, margin: '0 auto', padding: '20px 20px 64px' },
  featuresTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 30,
    fontWeight: 800,
    margin: '14px 0 0',
    letterSpacing: '-0.01em',
    lineHeight: 1.25,
  },
  featuresSubtitle: { fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.65, margin: '12px 0 0' },
  featuresGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginTop: 32 },
  featureTile: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    padding: 24,
  },
  featureIconBadge: {
    display: 'inline-flex',
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    background: 'var(--accent-dim)',
    marginBottom: 16,
  },
  featureTileTitle: { fontSize: 17, margin: '0 0 8px', fontFamily: 'var(--font-display)', fontWeight: 700 },
  featureTileText: { fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 },
  featureList: { listStyle: 'none', margin: '14px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 },
  featureListItem: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)' },

  globalStats: { borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', background: 'var(--panel-alt)' },
  globalStatsGrid: {
    maxWidth: 1280,
    margin: '0 auto',
    padding: '44px 20px',
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 16,
  },
  globalStatValue: { fontFamily: 'var(--font-display)', fontSize: 34, fontWeight: 800, letterSpacing: '-0.01em' },

  supportedSection: { maxWidth: 1280, margin: '0 auto', padding: '64px 20px 20px' },
  supportedGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, marginTop: 28 },
  supportedRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: '12px 14px',
  },

  faqSection: { maxWidth: 760, margin: '0 auto', padding: '64px 20px' },
  faqItem: { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' },
  faqQuestion: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    background: 'transparent',
    border: 'none',
    padding: '16px 18px',
    textAlign: 'left',
    fontSize: 14.5,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  faqAnswer: { margin: 0, padding: '0 18px 18px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.65 },

  finalCtaSection: { maxWidth: 1280, margin: '0 auto', padding: '20px 20px 64px' },
  finalCtaCard: {
    position: 'relative',
    overflow: 'hidden',
    textAlign: 'center',
    background: 'linear-gradient(135deg, var(--panel) 0%, var(--panel-alt) 100%)',
    border: '1px solid var(--border)',
    borderRadius: 24,
    padding: '64px 32px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
  },
  finalCtaTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 34,
    fontWeight: 800,
    letterSpacing: '-0.01em',
    margin: 0,
    maxWidth: 620,
    marginLeft: 'auto',
    marginRight: 'auto',
  },
  finalCtaSubtitle: {
    fontSize: 14,
    color: 'var(--text-secondary)',
    lineHeight: 1.65,
    maxWidth: 460,
    margin: '14px auto 0',
  },

  siteFooter: { borderTop: '1px solid var(--border)', background: 'var(--panel-alt)' },
  siteFooterInner: { maxWidth: 1280, margin: '0 auto', padding: '52px 20px 28px' },
  siteFooterGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 32 },
  siteFooterTagline: { fontSize: 12.5, color: 'var(--text-tertiary)', lineHeight: 1.6, maxWidth: 260, marginTop: 14 },
  siteFooterColTitle: { fontSize: 13, fontWeight: 700, margin: 0, color: 'var(--text-primary)' },
  siteFooterLinkList: { listStyle: 'none', margin: '14px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 10 },
  siteFooterLink: { fontSize: 13, color: 'var(--text-secondary)' },
  siteFooterBottom: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 20,
    flexWrap: 'wrap',
    marginTop: 44,
    paddingTop: 22,
    borderTop: '1px solid var(--border)',
    fontSize: 11.5,
    color: 'var(--text-tertiary)',
  },
};
