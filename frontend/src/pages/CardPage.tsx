import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useLanguage, localeOf } from '../lib/i18n';
import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';
import { Skeleton } from '../components/Skeleton';
import { CardFace, BASE_CARD_THEME, ICY_CARD_THEME } from '../components/CardFace';

export function CardPage() {
  const { t, lang } = useLanguage();
  const FEATURES: { title: string; text: string; icon: JSX.Element }[] = [
    { title: t('card.feature1.title'), text: t('card.feature1.text'), icon: <PayIcon /> },
    { title: t('card.feature2.title'), text: t('card.feature2.text'), icon: <NoFeeIcon /> },
    { title: t('card.feature3.title'), text: t('card.feature3.text'), icon: <ConvertIcon /> },
    { title: t('card.feature4.title'), text: t('card.feature4.text'), icon: <AtmIcon /> },
    { title: t('card.feature5.title'), text: t('card.feature5.text'), icon: <CashbackIcon /> },
    { title: t('card.feature6.title'), text: t('card.feature6.text'), icon: <SubscriptionIcon /> },
  ];
  const STEPS = [
    { num: '01', title: t('card.step1.title'), text: t('card.step1.text') },
    { num: '02', title: t('card.step2.title'), text: t('card.step2.text') },
    { num: '03', title: t('card.step3.title'), text: t('card.step3.text') },
  ];
  const FAQ = [
    { q: t('card.faq.order.q'), a: t('card.faq.order.a') },
    { q: t('card.faq.delivery.q'), a: t('card.faq.delivery.a') },
    { q: t('card.faq.limits.q'), a: t('card.faq.limits.a') },
    { q: t('card.faq.currencies.q'), a: t('card.faq.currencies.a') },
  ];
  const [waitlist, setWaitlist] = useState<Awaited<ReturnType<typeof api.getCardWaitlist>> | null>(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api.getCardWaitlist().then(setWaitlist).catch(() => {});
  }

  useEffect(reload, []);

  async function handleJoin() {
    setJoining(true);
    setError(null);
    try {
      await api.joinCardWaitlist();
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('card.joinError'));
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="page-mesh" style={styles.page}>
      <Nav active="/card" />
      <main style={styles.main}>
        <div style={styles.hero}>
          <h1 style={styles.title}>
            {t('card.title')} <span style={styles.titleDash}>—</span> {t('card.heroTagline')}
          </h1>
          <p style={styles.lead}>{t('card.lead')}</p>

          <div id="card-hero-cta" style={styles.ctaBox}>
            {!waitlist ? (
              <Skeleton width={200} height={44} radius={24} />
            ) : waitlist.joined ? (
              <div style={styles.joinedRow}>
                <span style={{ color: 'var(--buy)', fontWeight: 700 }}>{t('card.joinedPrefix')}</span>
                <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                  {t('card.joinedSince', {
                    date: waitlist.joinedAt ? new Date(waitlist.joinedAt).toLocaleDateString(localeOf(lang)) : '',
                  })}
                </span>
              </div>
            ) : waitlist.kycStatus === 'APPROVED' ? (
              <>
                {error && <div style={styles.errorBox}>{error}</div>}
                <div style={styles.heroBtnRow}>
                  <button onClick={handleJoin} disabled={joining} style={styles.joinBtn}>
                    {joining ? t('auth.wait') : t('card.joinBtn')}
                  </button>
                  <a href="#card-compare" style={styles.heroSecondaryBtn}>
                    {t('card.learnMore')}
                  </a>
                </div>
              </>
            ) : (
              <div style={styles.joinedRow}>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('card.needVerification')}</span>
                <Link to="/settings" style={styles.verifyLink}>
                  {t('card.goVerify')}
                </Link>
              </div>
            )}
          </div>
        </div>

        <div style={styles.cardsRow}>
          <div style={styles.productCol}>
            <div className="card-tilt-wrap-photo" style={styles.cardTiltWrap}>
              <CardFace theme={BASE_CARD_THEME} last4="8860" holderName="JOHN JOHNSON" />
            </div>

            <div style={styles.productBox}>
              <div style={styles.productBoxHeadRow}>
                <span style={{ ...styles.productDot, background: '#e0a83c' }} />
                <h3 style={styles.productBoxTitle}>{t('card.baseProductLabel')}</h3>
                <span style={{ ...styles.productBoxBadge, background: 'var(--accent-dim)', color: 'var(--accent)' }}>8%</span>
              </div>
              <p style={{ ...styles.productBoxSubtitle, color: 'var(--accent)' }}>{t('card.vipTitle')}</p>
              <p style={styles.productBoxLead}>{t('card.vipLead')}</p>

              <div style={styles.productBoxList}>
                <div style={styles.productBoxListItem}>
                  <CashbackIcon small />
                  <span>{t('card.vipCashbackPurchases')}</span>
                </div>
                <div style={styles.productBoxListItem}>
                  <CashbackIcon small />
                  <span>{t('card.vipCashbackDeposits')}</span>
                </div>
              </div>

              <div style={styles.productBoxFooter}>
                <span style={styles.productBoxFooterLabel}>{t('card.vipEligibilityTitle')}</span>
                <div style={styles.productBoxFooterRow}>
                  <span style={styles.productBoxChip}>{t('card.vipEligibilityDeposit')}</span>
                  <span style={styles.productBoxOr}>{t('card.vipOr')}</span>
                  <span style={styles.productBoxChip}>{t('card.vipEligibilityVolume')}</span>
                </div>
              </div>
            </div>
          </div>

          <div style={styles.productCol}>
            <div className="card-tilt-wrap-photo" style={styles.cardTiltWrap}>
              <CardFace theme={ICY_CARD_THEME} last4="4417" holderName="JOHN JOHNSON" network="mastercard" />
            </div>

            <div style={styles.productBox}>
              <div style={styles.productBoxHeadRow}>
                <span style={{ ...styles.productDot, background: '#1d2027' }} />
                <h3 style={styles.productBoxTitle}>{t('card.icyProductLabel')}</h3>
                <span style={{ ...styles.productBoxBadge, background: 'rgba(47,102,144,0.12)', color: '#2f6690' }}>{t('card.icyRateBadge')}</span>
              </div>
              <p style={{ ...styles.productBoxSubtitle, color: '#2f6690' }}>{t('card.icyProductLabel')}</p>
              <p style={styles.productBoxLead}>{t('card.icyLead')}</p>

              <div style={styles.productBoxList}>
                {[
                  t('card.icyBenefitCashback'),
                  t('card.icyBenefitLounge'),
                  t('card.icyBenefitSubscriptions'),
                  t('card.icyBenefitSupport'),
                  t('card.icyBenefitEvents'),
                  t('card.icyBenefitConcierge'),
                ].map((text) => (
                  <div key={text} style={styles.productBoxListItem}>
                    <CashbackIcon small icy />
                    <span>{text}</span>
                  </div>
                ))}
              </div>

              <div style={styles.productBoxFooter}>
                <span style={styles.productBoxFooterLabel}>{t('card.icyEligibilityTitle')}</span>
                <div style={styles.productBoxFooterRow}>
                  <span style={styles.productBoxChip}>{t('card.icyEligibilityStake')}</span>
                  <span style={styles.productBoxOr}>{t('card.vipOr')}</span>
                  <span style={styles.productBoxChip}>{t('card.icyEligibilityVolume')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={styles.stepsSection}>
          <h2 style={styles.stepsTitle}>{t('card.howItWorksTitle')}</h2>
          <div style={styles.stepsGrid}>
            {STEPS.map((s) => (
              <div key={s.num} style={styles.stepItem}>
                <span style={styles.stepNum}>{s.num}</span>
                <h3 style={styles.stepItemTitle}>{s.title}</h3>
                <p style={styles.stepItemText}>{s.text}</p>
              </div>
            ))}
          </div>
        </div>

        <div id="card-compare" style={styles.compareSection}>
          <h2 style={styles.compareTitle}>{t('card.compareTitle')}</h2>
          <div className="accent-edge surface-raised" style={styles.compareTable}>
            <div style={styles.compareHeaderRow}>
              <span />
              <span style={styles.compareColHeader}>{t('card.baseProductLabel')}</span>
              <span style={styles.compareColHeader}>{t('card.icyProductLabel')}</span>
            </div>
            <div style={styles.compareRow}>
              <span style={styles.compareRowLabel}>{t('card.compareCashback')}</span>
              <span>{t('card.compareBaseCashback')}</span>
              <span style={{ fontWeight: 700 }}>{t('card.compareIcyCashback')}</span>
            </div>
            <div style={styles.compareRow}>
              <span style={styles.compareRowLabel}>{t('card.compareEligibility')}</span>
              <span>{t('card.compareBaseEligibility')}</span>
              <span style={{ fontWeight: 700 }}>{t('card.compareIcyEligibility')}</span>
            </div>
            <div style={styles.compareRow}>
              <span style={styles.compareRowLabel}>{t('card.comparePerks')}</span>
              <span>{t('card.compareBasePerks')}</span>
              <span style={{ fontWeight: 700 }}>{t('card.compareIcyPerks')}</span>
            </div>
          </div>
        </div>

        <h2 style={styles.benefitsTitle}>{t('card.benefitsTitle')}</h2>
        <div style={styles.grid}>
          {FEATURES.map((f) => (
            <div key={f.title} className="row-hover" style={styles.card}>
              <div style={styles.cardIconBadge}>{f.icon}</div>
              <h3 style={styles.cardTitle}>{f.title}</h3>
              <p style={styles.cardText}>{f.text}</p>
            </div>
          ))}
        </div>

        <div className="card-security-grid" style={styles.securitySection}>
          <div style={styles.securityCopy}>
            <div style={styles.securityIconBadge}>
              <ShieldIcon />
            </div>
            <h2 style={styles.securityTitle}>{t('card.securityTitle')}</h2>
            <p style={styles.securityLead}>{t('card.securityText')}</p>
          </div>
          <div style={styles.securityGrid}>
            <div style={styles.securityCard}>
              <LockIcon />
              <p style={styles.securityCardTitle}>{t('card.securitySecureTitle')}</p>
              <p style={styles.securityCardText}>{t('card.securitySecureText')}</p>
            </div>
            <div style={styles.securityCard}>
              <EyeIcon />
              <p style={styles.securityCardTitle}>{t('card.securityTransparentTitle')}</p>
              <p style={styles.securityCardText}>{t('card.securityTransparentText')}</p>
            </div>
            <div style={styles.securityCard}>
              <GlobeIcon />
              <p style={styles.securityCardTitle}>{t('card.securityGlobalTitle')}</p>
              <p style={styles.securityCardText}>{t('card.securityGlobalText')}</p>
            </div>
          </div>
        </div>

        <div style={styles.kycNotice}>
          <h3 style={styles.noticeTitle}>{t('card.whyKycTitle')}</h3>
          <p style={styles.noticeText}>{t('card.whyKycText')}</p>
        </div>

        <div style={styles.faqSection}>
          <h2 style={styles.faqTitle}>{t('card.faqTitle')}</h2>
          <div style={styles.faqList}>
            {FAQ.map((item) => (
              <details key={item.q} style={styles.faqItem}>
                <summary style={styles.faqQuestion}>{item.q}</summary>
                <p style={styles.faqAnswer}>{item.a}</p>
              </details>
            ))}
          </div>
        </div>

        <div style={styles.closingCta}>
          <h2 style={styles.closingCtaTitle}>{t('card.ctaTitle')}</h2>
          <p style={styles.closingCtaText}>{t('card.ctaText')}</p>
          <a href="#card-hero-cta" style={styles.closingCtaBtn}>
            {t('card.joinBtn')}
          </a>
        </div>

        <Footer />
      </main>
    </div>
  );
}

function ShieldIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3v6c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 3.8 5.7 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.7-3.8-9S9.5 5.5 12 3z" />
    </svg>
  );
}

function CashbackIcon({ small, icy }: { small?: boolean; icy?: boolean }) {
  const size = small ? 16 : 20;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={icy ? '#2f6690' : 'var(--accent)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function PayIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="3" />
      <path d="M9 18h6" />
      <path d="M3 9c1.2 1.2 1.2 3 0 4.2M1.2 7.2c2.2 2.2 2.2 5.6 0 7.8" />
    </svg>
  );
}

function SubscriptionIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <path d="M12 8v4l2.5 2.5" />
    </svg>
  );
}

function NoFeeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l7 3v6c0 5-3 8-7 11-4-3-7-6-7-11V5l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function ConvertIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h13l-3-3M20 16H7l3 3" />
    </svg>
  );
}

function AtmIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}

// Light, premium redesign scoped to this page's content — same pattern as
// WalletPage's LIGHT_PAGE_VARS: redefines the custom properties every
// var(--panel)/var(--border)/var(--text-*) style below already reads from,
// so the whole page flips to a light/dark-text look without duplicating
// every rule. `color` is set explicitly so plain inherited text also picks
// up the dark value instead of the app-wide light-on-dark default.
const LIGHT_PAGE_VARS = {
  ['--panel' as any]: '#ffffff',
  ['--panel-alt' as any]: '#f1f3f7',
  ['--panel-alt-hover' as any]: '#e8ebf0',
  ['--border' as any]: '#e3e6ec',
  ['--text-primary' as any]: '#12151a',
  ['--text-secondary' as any]: '#4b5563',
  ['--text-tertiary' as any]: '#6b7280',
  ['--neutral-dim' as any]: 'rgba(75,85,99,0.08)',
  color: 'var(--text-primary)',
} as React.CSSProperties;

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'linear-gradient(180deg, #ffffff 0%, #f2f3f6 100%)' },
  main: { padding: 32, maxWidth: 960, margin: '0 auto', ...LIGHT_PAGE_VARS },
  hero: { marginBottom: 40, maxWidth: 680, marginInline: 'auto', textAlign: 'center' },
  title: {
    fontSize: 32,
    margin: '0 0 14px',
    fontFamily: 'var(--font-display)',
    fontWeight: 800,
    letterSpacing: '-0.01em',
    lineHeight: 1.2,
  },
  titleDash: { color: 'var(--text-tertiary)', fontWeight: 400 },
  lead: { color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6, margin: '0 auto 26px', maxWidth: 480 },
  ctaBox: { minHeight: 44, display: 'flex', justifyContent: 'center' },
  heroBtnRow: { display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' },
  heroSecondaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    border: '1px solid var(--border)',
    borderRadius: 24,
    padding: '13px 24px',
    fontWeight: 700,
    fontSize: 14,
    color: 'var(--text-primary)',
    textDecoration: 'none',
  },
  cardsRow: { display: 'flex', gap: 32, flexWrap: 'wrap', marginBottom: 32, alignItems: 'flex-start', justifyContent: 'center' },
  productCol: { flex: '1 1 340px', minWidth: 300, maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 16 },
  cardTiltWrap: { width: 300, marginInline: 'auto' },
  // Plain bordered card matching the Bolt reference's product-description
  // cards — a colored dot + name instead of a gradient glow box, matching
  // the flat card face style above.
  productBox: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 14,
    padding: 26,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  productBoxHeadRow: { display: 'flex', alignItems: 'center', gap: 9 },
  productDot: { width: 10, height: 10, borderRadius: '50%', flex: 'none' },
  productBoxTitle: { fontSize: 16, margin: 0, fontFamily: 'var(--font-display)', fontWeight: 800 },
  productBoxBadge: { marginLeft: 'auto', fontSize: 12, fontWeight: 800, padding: '3px 11px', borderRadius: 999 },
  productBoxSubtitle: { fontSize: 12, fontWeight: 700, margin: '2px 0 0' },
  productBoxLead: { color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, margin: '8px 0 4px' },
  productBoxList: { display: 'flex', flexDirection: 'column', gap: 9, margin: '10px 0 4px' },
  productBoxListItem: { display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.4 },
  productBoxFooter: {
    borderTop: '1px solid var(--border)',
    marginTop: 14,
    paddingTop: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  productBoxFooterLabel: { fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.03em' },
  productBoxFooterRow: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  productBoxChip: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 999,
    padding: '8px 16px',
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--text-primary)',
  },
  productBoxOr: { fontSize: 11, color: 'var(--text-tertiary)', fontStyle: 'italic' },
  stepsSection: { marginBottom: 32 },
  stepsTitle: { fontSize: 19, margin: '0 0 20px', fontFamily: 'var(--font-display)', fontWeight: 800, letterSpacing: '-0.01em' },
  stepsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 24 },
  stepItem: { display: 'flex', flexDirection: 'column', gap: 6 },
  stepNum: { fontSize: 13, fontWeight: 800, letterSpacing: '0.1em', color: 'var(--accent)' },
  stepItemTitle: { fontSize: 15, margin: 0, fontFamily: 'var(--font-display)', fontWeight: 700 },
  stepItemText: { fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 },
  compareSection: { marginBottom: 28 },
  compareTitle: { fontSize: 19, margin: '0 0 16px', fontFamily: 'var(--font-display)', fontWeight: 800, letterSpacing: '-0.01em' },
  compareTable: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  compareHeaderRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1.4fr 1.4fr',
    gap: 12,
    padding: '12px 18px',
    fontSize: 11,
    color: 'var(--text-tertiary)',
    borderBottom: '1px solid var(--border)',
  },
  compareColHeader: { fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' },
  compareRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1.4fr 1.4fr',
    gap: 12,
    padding: '14px 18px',
    fontSize: 13,
    alignItems: 'center',
    borderTop: '1px solid var(--border)',
  },
  compareRowLabel: { fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.03em' },
  benefitsTitle: { fontSize: 19, margin: '0 0 16px', fontFamily: 'var(--font-display)', fontWeight: 800, letterSpacing: '-0.01em' },
  // Hairline-divided mosaic (1px gaps filled by --border, showing through
  // as grid lines) instead of individually shadowed cards — matches the
  // reference's benefits grid.
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: 1,
    background: 'var(--border)',
    border: '1px solid var(--border)',
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 28,
  },
  card: {
    background: 'var(--panel)',
    padding: 22,
  },
  cardIconBadge: {
    width: 36,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    background: 'var(--accent-dim)',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 14,
    margin: '0 0 8px',
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
    letterSpacing: '0.01em',
  },
  cardText: { fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 },
  securitySection: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.1fr)',
    gap: 32,
    alignItems: 'center',
    marginBottom: 28,
  },
  securityCopy: { display: 'flex', flexDirection: 'column', gap: 4 },
  securityIconBadge: {
    width: 42,
    height: 42,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    background: 'var(--accent-dim)',
    marginBottom: 8,
  },
  securityTitle: { fontSize: 22, margin: '0 0 8px', fontFamily: 'var(--font-display)', fontWeight: 800, letterSpacing: '-0.01em' },
  securityLead: { color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, margin: 0, maxWidth: 380 },
  securityGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14 },
  securityCard: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 18,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  securityCardTitle: { fontSize: 13, fontWeight: 700, margin: 0 },
  securityCardText: { fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 },
  kycNotice: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 20,
    marginBottom: 28,
  },
  noticeTitle: { fontSize: 14, margin: '0 0 8px' },
  noticeText: { fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 },
  faqSection: { marginBottom: 20 },
  faqTitle: { fontSize: 19, margin: '0 0 16px', fontFamily: 'var(--font-display)', fontWeight: 800, letterSpacing: '-0.01em' },
  faqList: { display: 'flex', flexDirection: 'column', gap: 8 },
  faqItem: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '14px 18px',
  },
  faqQuestion: {
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--text-primary)',
    cursor: 'pointer',
  },
  faqAnswer: { fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '10px 0 0' },
  joinedRow: { display: 'flex', flexDirection: 'column', gap: 6 },
  verifyLink: { fontSize: 13, color: 'var(--accent)', fontWeight: 600, marginTop: 4 },
  errorBox: {
    background: 'var(--sell-dim)',
    color: 'var(--sell)',
    padding: '8px 10px',
    borderRadius: 8,
    fontSize: 12,
    marginBottom: 12,
  },
  joinBtn: {
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    border: 'none',
    borderRadius: 24,
    padding: '13px 26px',
    fontWeight: 800,
    fontSize: 14,
    boxShadow: '0 4px 16px rgba(247,166,0,0.3)',
  },
  closingCta: {
    textAlign: 'center',
    background: 'linear-gradient(135deg, #12151a 0%, #1d222b 100%)',
    borderRadius: 20,
    padding: '48px 32px',
    marginBottom: 32,
  },
  closingCtaTitle: {
    fontSize: 24,
    margin: '0 auto 10px',
    maxWidth: 560,
    fontFamily: 'var(--font-display)',
    fontWeight: 800,
    letterSpacing: '-0.01em',
    color: '#ffffff',
  },
  closingCtaText: {
    fontSize: 14,
    margin: '0 auto 24px',
    maxWidth: 460,
    lineHeight: 1.6,
    color: 'rgba(255,255,255,0.6)',
  },
  closingCtaBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    borderRadius: 24,
    padding: '13px 28px',
    fontWeight: 800,
    fontSize: 14,
    textDecoration: 'none',
    boxShadow: '0 4px 16px rgba(247,166,0,0.3)',
  },
};
