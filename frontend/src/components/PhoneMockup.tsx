import type { CSSProperties } from 'react';
import { Sparkline } from './Sparkline';

interface TrendingCoin {
  symbol: string;
  name: string;
  color: string;
  price: string;
  change: string;
  positive: boolean;
  points: number[];
}

// Purely illustrative — same convention as the rest of this mockup (not
// tied to any real account or live feed). Sparkline shapes are hand-picked
// point arrays, not fetched data.
const TRENDING: TrendingCoin[] = [
  { symbol: 'BTC', name: 'Bitcoin', color: '#f7931a', price: '68,402.18', change: '+2.84%', positive: true, points: [61, 63, 62, 66, 65, 69, 68, 72, 71, 75] },
  { symbol: 'ETH', name: 'Ethereum', color: '#7c8cf8', price: '3,842.61', change: '+1.26%', positive: true, points: [58, 60, 59, 57, 61, 60, 63, 62, 65, 64] },
  { symbol: 'SOL', name: 'Solana', color: '#17d6a2', price: '178.94', change: '-0.42%', positive: false, points: [70, 66, 68, 63, 65, 60, 62, 58, 59, 55] },
];

/** Generic illustrative phone-app preview shared by the marketing landing
 * page and the login/register hero — not tied to any real account, purely a
 * UI mockup: status bar, VOLTEX topbar, a total-balance card, a trending
 * pairs list with live-look sparklines, and a selected pair's Buy/Sell
 * panel — the same real trading concepts (spot pairs, price/change, market
 * order buttons) as the actual Trade page, just illustrative numbers.
 * Callers control placement/size via `style`/`className`. */
export function PhoneMockup({ className, style }: { className?: string; style?: CSSProperties }) {
  const featured = TRENDING[0];
  return (
    <div className={className} style={{ ...styles.tiltWrap, ...style }}>
      <div style={styles.phone}>
        <span style={styles.sideButtonLeft1} />
        <span style={styles.sideButtonLeft2} />
        <span style={styles.sideButtonRight} />
        <div style={styles.phoneScreen}>
          <span style={styles.notch} />
          <span style={styles.notchCam} />

          <div style={styles.phoneStatusBar}>
            <span>11:00</span>
            <div style={styles.statusIcons}>
              <SignalIcon />
              <WifiIcon />
              <BatteryIcon />
            </div>
          </div>

          <div style={styles.appTopbar}>
            <div style={styles.appBrand}>
              <span style={styles.appBrandMark} />
              <b>VOLTEX</b>
            </div>
            <div style={styles.appTopActions}>
              <BellIcon />
              <ProfileIcon />
            </div>
          </div>

          <div style={{ padding: '0 16px' }}>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Total balance</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 25, fontWeight: 800, marginTop: 3 }}>
              <EyeIcon />
              24,680<span style={{ fontSize: 15 }}>.42</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: 12 }}>
              <span style={{ color: 'var(--text-tertiary)' }}>≈ 0.361 BTC</span>
              <span style={{ color: 'var(--buy)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 2 }}>
                +8.42% <UpRightIcon />
              </span>
            </div>

            <div style={styles.sectionHeadRow}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Markets</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>Trending pairs</div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 3 }}>
                View all <ChevronRightSmall />
              </span>
            </div>

            <div style={styles.marketList}>
              {TRENDING.map((coin) => (
                <div key={coin.symbol} style={{ ...styles.marketRow, ...(coin.symbol === featured.symbol ? styles.marketRowActive : {}) }}>
                  <span style={{ ...styles.coinBadge, background: coin.color }}>{coin.symbol.charAt(0)}</span>
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <b style={{ fontSize: 12 }}>{coin.symbol}</b>
                    <small style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{coin.name}</small>
                  </span>
                  <Sparkline points={coin.points} width={44} height={20} />
                  <span style={{ textAlign: 'right' }}>
                    <b style={{ fontSize: 12, display: 'block' }}>${coin.price}</b>
                    <small style={{ fontSize: 10, fontWeight: 700, color: coin.positive ? 'var(--buy)' : 'var(--sell)' }}>{coin.change}</small>
                  </span>
                </div>
              ))}
            </div>

            <div style={styles.tradePanel}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700 }}>
                  <span style={{ ...styles.coinBadge, width: 16, height: 16, fontSize: 9, background: featured.color }}>{featured.symbol.charAt(0)}</span>
                  {featured.symbol} / USDT
                </span>
                <span style={styles.liveTag}>
                  <span style={styles.liveDot} /> Live
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8 }}>
                <span style={{ fontSize: 18, fontWeight: 800 }}>${featured.price}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--buy)' }}>{featured.change}</span>
              </div>
              <div style={{ margin: '8px 0' }}>
                <Sparkline points={featured.points} width={210} height={34} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <span style={{ ...styles.tradeBtn, background: 'var(--buy)' }}>Buy</span>
                <span style={{ ...styles.tradeBtn, background: 'var(--sell)' }}>Sell</span>
              </div>
            </div>
          </div>

          <div style={styles.appNav}>
            <span style={{ ...styles.appNavItem, color: 'var(--accent)' }}>
              <MarketsIcon /> Markets
            </span>
            <span style={styles.appNavItem}>
              <WalletNavIcon /> Portfolio
            </span>
            <span style={styles.appNavItem}>
              <FuturesIcon /> Futures
            </span>
            <span style={styles.appNavItem}>
              <ProfileIcon small /> Account
            </span>
          </div>

          {/* Diagonal glass sheen over the whole screen — reads as a real
              display catching light instead of a flat color fill. */}
          <span style={styles.glassSheen} />
        </div>
      </div>
    </div>
  );
}

const ICON = { fill: 'none' as const, stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

function EyeIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" {...ICON} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function UpRightIcon() {
  return (
    <svg width={10} height={10} viewBox="0 0 24 24" {...ICON}>
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </svg>
  );
}
function ChevronRightSmall() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" {...ICON}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
function BellIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" {...ICON} style={{ color: 'var(--text-secondary)' }}>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
function ProfileIcon({ small }: { small?: boolean }) {
  const size = small ? 14 : 15;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON} style={{ color: 'var(--text-secondary)' }}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  );
}
function MarketsIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" {...ICON}>
      <path d="M3 3v18h18" />
      <path d="M7 15l4-5 3 3 5-7" />
    </svg>
  );
}
function WalletNavIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" {...ICON}>
      <rect x="2" y="6" width="20" height="13" rx="2.5" />
      <path d="M2 10h20" />
      <circle cx="17" cy="14" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
function FuturesIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" {...ICON}>
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
    </svg>
  );
}
function SignalIcon() {
  return (
    <svg width={15} height={11} viewBox="0 0 16 11" fill="currentColor">
      <rect x="0" y="7" width="2.5" height="4" rx="0.6" />
      <rect x="4.5" y="5" width="2.5" height="6" rx="0.6" />
      <rect x="9" y="3" width="2.5" height="8" rx="0.6" />
      <rect x="13.5" y="0" width="2.5" height="11" rx="0.6" />
    </svg>
  );
}
function WifiIcon() {
  return (
    <svg width={14} height={11} viewBox="0 0 24 20" {...ICON}>
      <path d="M2 8.55a16 16 0 0 1 20 0" />
      <path d="M5.5 12.5a11 11 0 0 1 13 0" />
      <path d="M9 16.4a6 6 0 0 1 6 0" />
      <circle cx="12" cy="19.5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
function BatteryIcon() {
  return (
    <svg width={22} height={11} viewBox="0 0 24 12" fill="none" stroke="currentColor" strokeWidth={1.3}>
      <rect x="1" y="1" width="19" height="10" rx="2.5" />
      <rect x="3" y="3" width="14" height="6" rx="1" fill="currentColor" stroke="none" />
      <rect x="21" y="4" width="2" height="4" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

const styles: Record<string, CSSProperties> = {
  // Perspective lives on a separate outer wrapper so the width passed via
  // `style` (e.g. width: 240 on the auth page) sizes the actual device,
  // not a 3D projection box.
  tiltWrap: {
    width: 320,
    perspective: 1600,
  },
  phone: {
    position: 'relative',
    borderRadius: 48,
    background: 'linear-gradient(150deg, #454d5c 0%, #1c212b 42%, #05070c 100%)',
    padding: 11,
    transform: 'rotateY(-11deg) rotateX(3deg) rotateZ(0.4deg)',
    transformStyle: 'preserve-3d',
    boxShadow:
      '0 50px 90px -25px rgba(0,0,0,0.65), 0 0 130px -35px var(--accent-dim), inset 0 1.5px 0 rgba(255,255,255,0.22), inset 0 0 0 1px rgba(255,255,255,0.07), inset 0 -1px 0 rgba(0,0,0,0.6)',
  },
  sideButtonLeft1: {
    position: 'absolute',
    left: -3,
    top: '18%',
    width: 3,
    height: 28,
    borderRadius: '2px 0 0 2px',
    background: 'linear-gradient(180deg, #3a4150, #14171e)',
  },
  sideButtonLeft2: {
    position: 'absolute',
    left: -3,
    top: '28%',
    width: 3,
    height: 46,
    borderRadius: '2px 0 0 2px',
    background: 'linear-gradient(180deg, #3a4150, #14171e)',
  },
  sideButtonRight: {
    position: 'absolute',
    right: -3,
    top: '23%',
    width: 3,
    height: 54,
    borderRadius: '0 2px 2px 0',
    background: 'linear-gradient(180deg, #3a4150, #14171e)',
  },
  phoneScreen: {
    position: 'relative',
    borderRadius: 38,
    background: 'var(--panel)',
    overflow: 'hidden',
    paddingBottom: 16,
    boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.5)',
  },
  glassSheen: {
    position: 'absolute',
    inset: 0,
    zIndex: 3,
    pointerEvents: 'none',
    background: 'linear-gradient(122deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 22%, rgba(255,255,255,0) 78%, rgba(255,255,255,0.05) 100%)',
  },
  notch: {
    position: 'absolute',
    top: 9,
    left: '50%',
    transform: 'translateX(-50%)',
    width: 84,
    height: 24,
    borderRadius: 999,
    background: '#010203',
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05)',
    zIndex: 2,
  },
  notchCam: {
    position: 'absolute',
    top: 17,
    left: 'calc(50% + 26px)',
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: 'radial-gradient(circle at 35% 35%, #3a5570, #060a10 70%)',
    zIndex: 2,
  },
  phoneStatusBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 18px 0', fontSize: 13, fontWeight: 600 },
  statusIcons: { display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-primary)' },
  appTopbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px 14px' },
  appBrand: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 800, letterSpacing: '0.02em' },
  appBrandMark: { width: 16, height: 16, borderRadius: 5, background: 'var(--accent)', flexShrink: 0 },
  appTopActions: { display: 'flex', alignItems: 'center', gap: 12 },
  sectionHeadRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 16 },
  marketList: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 },
  marketRow: {
    display: 'grid',
    gridTemplateColumns: '24px 1fr 44px auto',
    alignItems: 'center',
    gap: 8,
    padding: '7px 8px',
    borderRadius: 10,
    border: '1px solid transparent',
  },
  marketRowActive: { background: 'var(--panel-alt)', border: '1px solid var(--border)' },
  coinBadge: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 800,
    color: '#fff',
    flexShrink: 0,
  },
  tradePanel: { marginTop: 12, background: 'var(--panel-alt)', borderRadius: 12, padding: 12 },
  liveTag: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: 'var(--buy)' },
  liveDot: { width: 5, height: 5, borderRadius: '50%', background: 'var(--buy)' },
  tradeBtn: {
    flex: 1,
    textAlign: 'center',
    padding: '9px 0',
    borderRadius: 9,
    fontSize: 12,
    fontWeight: 800,
    color: '#04121b',
  },
  appNav: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '12px 18px 0',
    marginTop: 14,
    borderTop: '1px solid var(--border)',
  },
  appNavItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 3,
    fontSize: 9,
    fontWeight: 700,
    color: 'var(--text-tertiary)',
    paddingTop: 10,
  },
};
