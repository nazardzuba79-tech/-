import type { CSSProperties } from 'react';

/** Generic illustrative phone-app preview shared by the marketing landing
 * page and the login/register hero — not tied to any real account, purely a
 * UI mockup (same convention as v0's own export). Styled to read as an
 * actual device (notch, metal bezel, side buttons) rather than a flat
 * rounded card, so callers only need to control placement/size via
 * `style`/`className`. */
export function PhoneMockup({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div className={className} style={{ ...styles.phone, ...style }}>
      <span style={styles.sideButtonLeft1} />
      <span style={styles.sideButtonLeft2} />
      <span style={styles.sideButtonRight} />
      <div style={styles.phoneScreen}>
        <span style={styles.notch} />
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
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  phone: {
    position: 'relative',
    width: 320,
    borderRadius: 46,
    background: 'linear-gradient(160deg, #2a303c 0%, #0a0c11 65%)',
    padding: 12,
    boxShadow: '0 30px 80px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.08)',
  },
  sideButtonLeft1: { position: 'absolute', left: -2, top: '19%', width: 3, height: 30, borderRadius: 2, background: '#12151b' },
  sideButtonLeft2: { position: 'absolute', left: -2, top: '30%', width: 3, height: 48, borderRadius: 2, background: '#12151b' },
  sideButtonRight: { position: 'absolute', right: -2, top: '24%', width: 3, height: 56, borderRadius: 2, background: '#12151b' },
  phoneScreen: {
    position: 'relative',
    borderRadius: 36,
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    overflow: 'hidden',
    paddingBottom: 16,
  },
  notch: {
    position: 'absolute',
    top: 8,
    left: '50%',
    transform: 'translateX(-50%)',
    width: 90,
    height: 22,
    borderRadius: 999,
    background: '#05070c',
    zIndex: 2,
  },
  phoneStatusBar: { display: 'flex', justifyContent: 'space-between', padding: '22px 18px 6px', fontSize: 13, fontWeight: 600 },
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
