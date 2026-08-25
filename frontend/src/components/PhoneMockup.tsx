import type { CSSProperties } from 'react';

/** Generic illustrative phone-app preview shared by the marketing landing
 * page and the login/register hero — not tied to any real account, purely a
 * UI mockup (same convention as v0's own export). A CSS-built device shell
 * (titanium bezel, dynamic-island notch, glass sheen, physical buttons, and
 * a slight 3D tilt) rather than a flat rounded card, so it reads as an
 * actual phone instead of a rounded rectangle. Callers control
 * placement/size via `style`/`className`. */
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
            <span>●●●</span>
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
            <div style={{ fontSize: 26, fontWeight: 800, marginTop: 3 }}>
              2,206.30 <span style={{ fontSize: 14, color: 'var(--text-tertiary)' }}>USDT</span>
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
            <div style={styles.phoneBtnRow}>
              <span style={styles.phoneSmallBtn}>Deposit</span>
              <span style={styles.phoneSmallBtn}>Withdraw</span>
            </div>
            <div style={styles.phonePnlBox}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span>
                  <span style={{ color: 'var(--text-tertiary)' }}>Live P&amp;L </span>
                  <span className="text-buy mono">+0.28</span>
                </span>
                <span>
                  <span style={{ color: 'var(--text-tertiary)' }}>Realized </span>
                  <span className="text-sell mono">-0.42</span>
                </span>
              </div>
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
  phoneStatusBar: { display: 'flex', justifyContent: 'space-between', padding: '24px 18px 6px', fontSize: 13, fontWeight: 600 },
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
  phoneStatLine: { display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 6 },
  phoneBtnRow: { display: 'flex', gap: 8, marginTop: 14 },
  phoneSmallBtn: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--accent)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '9px 0',
  },
  phonePnlBox: { marginTop: 14, background: 'var(--panel-alt)', borderRadius: 10, padding: 11 },
};
