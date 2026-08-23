import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useLanguage, localeOf } from '../lib/i18n';
import { Nav } from '../components/Nav';
import { LogoMark } from '../components/Logo';
import { Footer } from '../components/Footer';
import { Skeleton } from '../components/Skeleton';

export function CardPage() {
  const { t, lang } = useLanguage();
  const FEATURES: { title: string; text: string; icon: JSX.Element }[] = [
    { title: t('card.feature1.title'), text: t('card.feature1.text'), icon: <PayIcon /> },
    { title: t('card.feature2.title'), text: t('card.feature2.text'), icon: <NoFeeIcon /> },
    { title: t('card.feature3.title'), text: t('card.feature3.text'), icon: <ConvertIcon /> },
    { title: t('card.feature4.title'), text: t('card.feature4.text'), icon: <AtmIcon /> },
    { title: t('card.feature5.title'), text: t('card.feature5.text'), icon: <CashbackIcon /> },
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

          <div style={styles.ctaBox}>
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
                <button onClick={handleJoin} disabled={joining} style={styles.joinBtn}>
                  {joining ? t('auth.wait') : t('card.joinBtn')}
                </button>
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
            <div className="card-tilt-wrap" style={styles.cardTiltWrap}>
              <div className="card-tilt" style={styles.cardVisual}>
                <CardWaves />
                <div style={styles.cardVisualSheen} />
                <div style={styles.cardVisualTop}>
                  <LogoMark size={26} variant="badge" />
                  <ContactlessIcon />
                </div>
                <div style={{ flex: 1 }} />
                {/* Design mockup only — not a real card number or cardholder. */}
                <div style={styles.cardVisualNumber} className="mono">
                  •••• •••• •••• 8860
                </div>
                <div style={styles.cardVisualHolder} className="mono">
                  JOHN JOHNSON
                </div>
                <div style={{ height: 14 }} />
                <div style={styles.cardVisualBottom}>
                  <div style={styles.cardVisualBrand}>
                    <span style={styles.cardVisualWordmark}>VOLTEX</span>
                    <span style={styles.cardVisualNetwork}>Crypto Card</span>
                  </div>
                  <MastercardMark />
                </div>
              </div>
            </div>

            <div style={styles.vipBox}>
              <div style={styles.vipGlow} />
              <div style={styles.vipHeaderRow}>
                <h3 style={styles.vipTitle}>{t('card.vipTitle')}</h3>
                <span style={styles.vipRate}>8%</span>
              </div>
              <p style={styles.vipLead}>{t('card.vipLead')}</p>

              <div style={styles.vipCashbackRow}>
                <div style={styles.vipCashbackItem}>
                  <CashbackIcon small />
                  <span>{t('card.vipCashbackPurchases')}</span>
                </div>
                <div style={styles.vipCashbackItem}>
                  <CashbackIcon small />
                  <span>{t('card.vipCashbackDeposits')}</span>
                </div>
              </div>

              <div style={styles.vipEligibility}>
                <span style={styles.vipEligibilityTitle}>{t('card.vipEligibilityTitle')}</span>
                <div style={styles.vipEligibilityRow}>
                  <span style={styles.vipChip}>{t('card.vipEligibilityDeposit')}</span>
                  <span style={styles.vipOr}>{t('card.vipOr')}</span>
                  <span style={styles.vipChip}>{t('card.vipEligibilityVolume')}</span>
                </div>
              </div>
            </div>
          </div>

          <div style={styles.productCol}>
            <div className="card-tilt-wrap" style={styles.cardTiltWrap}>
              <div className="card-tilt" style={styles.icyCardVisual}>
                <IcyCardTexture />
                <div style={styles.icyCardVisualSheen} />
                <div style={styles.cardVisualTop}>
                  <IcyLogoMark />
                  <ContactlessIcon stroke="rgba(22,56,92,0.55)" />
                </div>
                <div style={{ flex: 1 }} />
                {/* Design mockup only — not a real card number or cardholder. */}
                <div style={styles.icyCardVisualNumber} className="mono">
                  •••• •••• •••• 4417
                </div>
                <div style={styles.icyCardVisualHolder} className="mono">
                  JOHN JOHNSON
                </div>
                <div style={{ height: 14 }} />
                <div style={styles.cardVisualBottom}>
                  <div style={styles.cardVisualBrand}>
                    <span style={styles.icyWordmarkSmall}>VOLTEX</span>
                    <span style={styles.icyProductName}>ICY WHITE</span>
                  </div>
                  <MastercardMark />
                </div>
              </div>
            </div>

            <div style={styles.icyBox}>
              <div style={styles.icyGlow} />
              <div style={styles.vipHeaderRow}>
                <h3 style={styles.icyTitle}>{t('card.icyProductLabel')}</h3>
                <span style={styles.icyRate}>{t('card.icyRateBadge')}</span>
              </div>
              <p style={styles.vipLead}>{t('card.icyLead')}</p>

              <div style={styles.icyBenefitsList}>
                {[
                  t('card.icyBenefitCashback'),
                  t('card.icyBenefitLounge'),
                  t('card.icyBenefitSubscriptions'),
                  t('card.icyBenefitSupport'),
                  t('card.icyBenefitEvents'),
                  t('card.icyBenefitConcierge'),
                ].map((text) => (
                  <div key={text} style={styles.icyBenefitItem}>
                    <CashbackIcon small icy />
                    <span>{text}</span>
                  </div>
                ))}
              </div>

              <div style={styles.vipEligibility}>
                <span style={styles.vipEligibilityTitle}>{t('card.icyEligibilityTitle')}</span>
                <div style={styles.vipEligibilityRow}>
                  <span style={styles.icyChip}>{t('card.icyEligibilityStake')}</span>
                  <span style={styles.vipOr}>{t('card.vipOr')}</span>
                  <span style={styles.icyChip}>{t('card.icyEligibilityVolume')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={styles.compareSection}>
          <h2 style={styles.compareTitle}>{t('card.compareTitle')}</h2>
          <div className="accent-edge surface-raised" style={styles.compareTable}>
            <div style={styles.compareHeaderRow}>
              <span />
              <span style={styles.compareColHeader}>{t('card.baseProductLabel')}</span>
              <span style={{ ...styles.compareColHeader, color: '#16385c' }}>{t('card.icyProductLabel')}</span>
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

        <div style={styles.grid}>
          {FEATURES.map((f) => (
            <div key={f.title} className="card-hover" style={styles.card}>
              <div style={styles.cardIconBadge}>{f.icon}</div>
              <h3 style={styles.cardTitle}>{f.title}</h3>
              <p style={styles.cardText}>{f.text}</p>
            </div>
          ))}
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

        <Footer />
      </main>
    </div>
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

function ContactlessIcon({ stroke = 'rgba(15,18,22,0.6)' }: { stroke?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round">
      <path d="M8 10a4 4 0 0 1 0 4" />
      <path d="M11 7a8 8 0 0 1 0 10" />
      <path d="M14 4a12 12 0 0 1 0 16" />
    </svg>
  );
}

// Dark-tinted bolt mark for the Icy White card's top corner — the shared
// LogoMark component only ships an orange-badge or orange-gradient variant,
// neither of which reads as "dark" against this card's pale, cool surface.
function IcyLogoMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M13 2L4 14h7l-1 8 10-12h-7l1-8z" fill="#16385c" />
    </svg>
  );
}

// Subtle engraved wave motif (Bybit-style) tiled across the light card face
// — purely decorative texture, sits between the base gradient and the
// content, well below the sheen and text layers.
function CardWaves() {
  return (
    <svg style={styles.cardVisualWaves} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="cardWavePattern" width="46" height="26" patternTransform="rotate(-10)" patternUnits="userSpaceOnUse">
          <path d="M0 13 Q11.5 2 23 13 T46 13" fill="none" stroke="rgba(15,18,22,0.055)" strokeWidth="1.1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#cardWavePattern)" />
    </svg>
  );
}

// Crystalline frost lattice for the Icy White card — same tiled-pattern
// technique as CardWaves, but a faceted diamond grid instead of a wave
// motif, reading as ice/frost rather than brushed metal.
function IcyCardTexture() {
  return (
    <svg style={styles.cardVisualWaves} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="icyFrostPattern" width="28" height="28" patternTransform="rotate(15)" patternUnits="userSpaceOnUse">
          <path d="M14 0 L28 14 L14 28 L0 14 Z" fill="none" stroke="rgba(47,102,144,0.09)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#icyFrostPattern)" />
    </svg>
  );
}

// Placeholder network mark — swap for the real issuing network's logo once
// the card partnership is finalized.
function MastercardMark() {
  return (
    <svg width="38" height="24" viewBox="0 0 38 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="14" cy="12" r="11" fill="#EB001B" />
      <circle cx="24" cy="12" r="11" fill="#F79E1B" fillOpacity="0.85" />
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

// Shared layout for both card visuals — only the finish (background/
// border/shadow) differs between the base and Icy White cards.
const CARD_VISUAL_BASE: React.CSSProperties = {
  position: 'relative',
  width: 300,
  aspectRatio: '1.586',
  borderRadius: 18,
  padding: 24,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'linear-gradient(180deg, #ffffff 0%, #f2f3f6 100%)' },
  main: { padding: 32, maxWidth: 960, margin: '0 auto', ...LIGHT_PAGE_VARS },
  hero: { marginBottom: 32, maxWidth: 640 },
  title: {
    fontSize: 30,
    margin: '0 0 14px',
    fontFamily: 'var(--font-display)',
    fontWeight: 800,
    letterSpacing: '-0.01em',
    lineHeight: 1.25,
  },
  titleDash: { color: 'var(--text-tertiary)', fontWeight: 400 },
  lead: { color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6, marginBottom: 24, maxWidth: 480 },
  ctaBox: { minHeight: 44 },
  cardsRow: { display: 'flex', gap: 32, flexWrap: 'wrap', marginBottom: 32, alignItems: 'flex-start' },
  productCol: { flex: '1 1 340px', minWidth: 300, display: 'flex', flexDirection: 'column', gap: 16 },
  cardTiltWrap: { width: 300 },
  cardVisual: {
    ...CARD_VISUAL_BASE,
    // Light metallic/glossy finish (Bybit-style) — a soft grey-to-white
    // diagonal gradient for volume, with the wave-pattern and sheen layers
    // below adding the engraved-metal and glossy-reflection detail.
    background: 'linear-gradient(135deg, #f4f5f7 0%, #ffffff 30%, #e9ebef 55%, #ffffff 78%, #eef0f3 100%)',
    border: '1px solid rgba(15,18,22,0.08)',
    boxShadow: '0 24px 50px rgba(15,18,22,0.18), 0 8px 20px rgba(15,18,22,0.10)',
  },
  icyCardVisual: {
    ...CARD_VISUAL_BASE,
    // Pearlescent white-to-pale-blue gradient for a "frosted/icy" metal —
    // the frost-lattice texture and cool-toned sheen below add the
    // crystalline shimmer.
    background: 'linear-gradient(135deg, #ffffff 0%, #eef6fb 28%, #dceefa 52%, #ffffff 76%, #e6f2fa 100%)',
    border: '1px solid rgba(47,102,144,0.14)',
    boxShadow: '0 24px 50px rgba(30,70,110,0.16), 0 8px 20px rgba(30,70,110,0.09)',
  },
  cardVisualWaves: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
  },
  cardVisualSheen: {
    position: 'absolute',
    inset: 0,
    background:
      'linear-gradient(115deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.15) 15%, rgba(255,255,255,0) 34%, rgba(15,18,22,0.03) 55%, rgba(255,255,255,0.55) 76%, rgba(255,255,255,0) 100%)',
    pointerEvents: 'none',
  },
  cardVisualTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardVisualNumber: { color: 'rgba(15,18,22,0.75)', fontSize: 18, fontWeight: 700, letterSpacing: '0.08em' },
  cardVisualHolder: { color: 'rgba(15,18,22,0.65)', fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', marginTop: 8 },
  cardVisualBottom: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  cardVisualBrand: { display: 'flex', flexDirection: 'column', gap: 2 },
  cardVisualWordmark: {
    color: 'var(--accent)',
    fontWeight: 800,
    fontSize: 18,
    fontFamily: 'var(--font-mono)',
    letterSpacing: '0.03em',
    textShadow: '0 0 10px rgba(247,166,0,0.35)',
  },
  cardVisualNetwork: { color: 'rgba(15,18,22,0.55)', fontWeight: 700, fontSize: 12, letterSpacing: '0.02em' },
  icyCardVisualSheen: {
    position: 'absolute',
    inset: 0,
    background:
      'linear-gradient(115deg, rgba(255,255,255,0.95) 0%, rgba(214,235,250,0.3) 18%, rgba(255,255,255,0) 36%, rgba(173,216,240,0.15) 58%, rgba(255,255,255,0.65) 78%, rgba(255,255,255,0) 100%)',
    pointerEvents: 'none',
  },
  icyCardVisualNumber: { color: 'rgba(22,56,92,0.7)', fontSize: 18, fontWeight: 700, letterSpacing: '0.08em' },
  icyCardVisualHolder: { color: 'rgba(22,56,92,0.6)', fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', marginTop: 8 },
  icyWordmarkSmall: { color: 'rgba(22,56,92,0.55)', fontWeight: 700, fontSize: 11, letterSpacing: '0.05em' },
  icyProductName: {
    fontWeight: 800,
    fontSize: 16,
    fontFamily: 'var(--font-mono)',
    letterSpacing: '0.05em',
    backgroundImage: 'linear-gradient(135deg, #3f6c93 0%, #b8ccdb 45%, #3f6c93 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  vipBox: {
    position: 'relative',
    background: 'linear-gradient(135deg, rgba(255,209,102,0.14) 0%, rgba(247,166,0,0.04) 100%)',
    border: '1px solid transparent',
    backgroundClip: 'padding-box',
    borderRadius: 14,
    padding: 26,
    marginBottom: 28,
    overflow: 'hidden',
    boxShadow: '0 0 0 1px rgba(255,209,102,0.5), 0 12px 32px rgba(247,166,0,0.12)',
  },
  vipGlow: {
    position: 'absolute',
    top: -60,
    right: -60,
    width: 200,
    height: 200,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(255,209,102,0.35), transparent 70%)',
    pointerEvents: 'none',
  },
  vipHeaderRow: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 },
  vipTitle: { fontSize: 18, margin: 0, fontFamily: 'var(--font-display)', fontWeight: 800 },
  vipRate: {
    background: 'linear-gradient(135deg, #ffd166, #f7a600)',
    color: '#3a2400',
    fontSize: 22,
    fontWeight: 900,
    padding: '2px 16px',
    borderRadius: 999,
    boxShadow: '0 4px 14px rgba(247,166,0,0.4)',
  },
  vipLead: { color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, margin: '0 0 18px', maxWidth: 640 },
  vipCashbackRow: { display: 'flex', gap: 24, marginBottom: 18, flexWrap: 'wrap' },
  vipCashbackItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  vipEligibility: {
    borderTop: '1px solid rgba(255,209,102,0.3)',
    paddingTop: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  vipEligibilityTitle: { fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.03em' },
  vipEligibilityRow: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  vipChip: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 999,
    padding: '8px 16px',
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--text-primary)',
  },
  vipOr: { fontSize: 11, color: 'var(--text-tertiary)', fontStyle: 'italic' },
  icyBox: {
    position: 'relative',
    background: 'linear-gradient(135deg, rgba(173,216,240,0.18) 0%, rgba(47,102,144,0.05) 100%)',
    border: '1px solid transparent',
    backgroundClip: 'padding-box',
    borderRadius: 14,
    padding: 26,
    overflow: 'hidden',
    boxShadow: '0 0 0 1px rgba(173,216,240,0.6), 0 12px 32px rgba(47,102,144,0.12)',
  },
  icyGlow: {
    position: 'absolute',
    top: -60,
    right: -60,
    width: 200,
    height: 200,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(173,216,240,0.4), transparent 70%)',
    pointerEvents: 'none',
  },
  icyTitle: { fontSize: 18, margin: 0, fontFamily: 'var(--font-display)', fontWeight: 800 },
  icyRate: {
    background: 'linear-gradient(135deg, #cfe6f5, #2f6690)',
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 900,
    padding: '2px 16px',
    borderRadius: 999,
    boxShadow: '0 4px 14px rgba(47,102,144,0.35)',
  },
  icyBenefitsList: { display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 },
  icyBenefitItem: { display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.4 },
  icyChip: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 999,
    padding: '8px 16px',
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--text-primary)',
  },
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
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16, marginBottom: 28 },
  card: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 20,
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
};
