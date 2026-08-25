import type { CSSProperties } from 'react';

/** Generic illustrative phone-app preview shared by the marketing landing
 * page and the login/register hero — not tied to any real account, purely a
 * UI mockup (matching the owner's own reference design: status bar with
 * signal/wifi/battery, settings gear, balance with eye toggle, a smart
 * account switcher row, transfer/deposit/withdraw actions, a trading
 * sub-balance with live/realized P&L, and a maintenance-margin row).
 * Callers control placement/size via `style`/`className`. */
export function PhoneMockup({ className, style }: { className?: string; style?: CSSProperties }) {
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
          <div style={styles.settingsRow}>
            <GearIcon />
          </div>

          <div style={styles.phoneWalletRow}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Your Wallet</div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>0x46GaC...2V9N9</div>
            </div>
            <span style={styles.phoneManageBtn}>Manage</span>
          </div>

          <div style={{ padding: '0 16px' }}>
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Total Balance</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 25, fontWeight: 800, marginTop: 3 }}>
              <EyeIcon />
              2,206.30 <span style={{ fontSize: 13, color: 'var(--text-tertiary)', fontWeight: 700 }}>USDT</span>
            </div>

            <div style={styles.smartAccountRow}>
              <SwapIcon />
              <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>Smart Account</span>
              <span style={{ color: 'var(--text-tertiary)' }}>⇄ Your Wallet</span>
            </div>
            <div style={styles.smartAccountAddr}>
              0x46a5C...2fG89 <CopyIcon />
            </div>

            <div style={{ ...styles.phoneStatLine, marginTop: 12 }}>
              <span style={{ color: 'var(--text-tertiary)' }}>Balance</span>
              <span className="mono" style={{ fontWeight: 700 }}>1,200.00 USDT</span>
            </div>

            <div style={{ marginTop: 14, fontSize: 13, fontWeight: 700 }}>Trading Account</div>
            <div style={styles.phoneStatLine}>
              <span style={{ color: 'var(--text-tertiary)' }}>Margin</span>
              <span className="mono">513.15 USDT</span>
            </div>
            <div style={styles.phoneStatLine}>
              <span style={{ color: 'var(--text-tertiary)' }}>Available</span>
              <span className="mono">493.15 USDT</span>
            </div>

            <div style={styles.phoneTransferBtn}>
              <SwapIcon accent /> Transfer
            </div>
            <div style={styles.phoneBtnRow}>
              <span style={styles.phoneSmallBtn}>
                <DepositIcon /> Deposit
              </span>
              <span style={styles.phoneSmallBtn}>
                <WithdrawIcon /> Withdraw
              </span>
            </div>

            <div style={styles.phonePnlBox}>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Trading balance</div>
              <div style={{ fontSize: 17, fontWeight: 800, marginTop: 2 }}>
                1,006.30 <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 600 }}>USDT</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 10 }}>
                <div>
                  <div style={{ color: 'var(--text-tertiary)' }}>Live P&amp;L</div>
                  <span className="text-buy mono">+0.28 USDT</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: 'var(--text-tertiary)' }}>Realized P&amp;L</div>
                  <span className="text-sell mono">-0.42 USDT</span>
                </div>
              </div>
            </div>

            <div style={styles.maintenanceRow}>
              <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Maintenance Margin Usage</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700 }}>
                15.2% <ChevronRightIcon />
              </span>
            </div>
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
function SwapIcon({ accent }: { accent?: boolean }) {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" {...ICON} style={{ color: accent ? 'var(--accent)' : 'var(--text-tertiary)', flexShrink: 0 }}>
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" {...ICON} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
function DepositIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" {...ICON} style={{ color: 'var(--accent)', flexShrink: 0 }}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="19 12 12 19 5 12" />
    </svg>
  );
}
function WithdrawIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" {...ICON} style={{ color: 'var(--accent)', flexShrink: 0 }}>
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" {...ICON} style={{ color: 'var(--text-tertiary)' }}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
function ChevronRightIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" {...ICON} style={{ color: 'var(--text-tertiary)' }}>
      <polyline points="9 18 15 12 9 6" />
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
  settingsRow: { display: 'flex', justifyContent: 'flex-end', padding: '6px 18px 0' },
  phoneWalletRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: 'var(--panel-alt)',
    borderRadius: 13,
    margin: '10px 16px',
    padding: '10px 13px',
  },
  phoneManageBtn: {
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--accent)',
    border: '1px solid var(--accent)',
    borderRadius: 8,
    padding: '3px 8px',
  },
  smartAccountRow: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, marginTop: 10 },
  smartAccountAddr: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 },
  phoneStatLine: { display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 6 },
  phoneTransferBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 14,
    fontSize: 12.5,
    fontWeight: 700,
    color: 'var(--accent)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '10px 0',
  },
  phoneBtnRow: { display: 'flex', gap: 8, marginTop: 8 },
  phoneSmallBtn: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--accent)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '9px 0',
  },
  phonePnlBox: { marginTop: 14, background: 'var(--panel-alt)', borderRadius: 10, padding: 11 },
  maintenanceRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTop: '1px solid var(--border)',
  },
};
