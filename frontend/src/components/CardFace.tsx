import type { CSSProperties } from 'react';

/** Shared brushed-metal card visual — used on both CardPage (the full
 * product page) and AuthPage (as a promotional banner for logged-out
 * visitors). Pulled out of CardPage so both places render the exact same
 * design instead of two components drifting apart. */

export interface CardTheme {
  background: string;
  border: string;
  boxShadow: string;
  chipTone: 'gold' | 'silver';
  hexTint: string;
  textColor: string;
}

// Warm rose-gold brushed metal — the base Voltex Crypto Card.
export const BASE_CARD_THEME: CardTheme = {
  background: 'linear-gradient(125deg, #f6d9c9 0%, #eab89e 22%, #f9e3d6 40%, #dfa084 58%, #f2c7ae 76%, #e6ab8e 100%)',
  border: '1px solid rgba(120,70,45,0.18)',
  boxShadow: '0 24px 50px rgba(120,70,45,0.22), 0 8px 20px rgba(120,70,45,0.12)',
  chipTone: 'gold',
  hexTint: 'rgba(120,70,45,0.16)',
  textColor: '#2b1a0c',
};

// Dark graphite metal with a cyan-to-purple neon rim glow — the Icy White
// card's visual redesign (still the same product/tier underneath, only the
// face changed: no more silver brushed metal, no hex/bolt watermark). The
// glow is two overlapping colored shadow layers rather than a literal
// gradient border, since a plain <div style> border can't carry a gradient
// on its own — this reads the same at card size.
export const ICY_CARD_THEME: CardTheme = {
  background: 'linear-gradient(145deg, #1a1d24 0%, #0c0e12 28%, #202430 52%, #0a0c10 76%, #161920 100%)',
  border: '1px solid rgba(120,150,200,0.22)',
  boxShadow:
    '0 0 0 1px rgba(24,200,255,0.14), 0 0 34px rgba(24,200,255,0.22), 0 0 60px rgba(108,92,231,0.22), 0 24px 50px rgba(0,0,0,0.5)',
  chipTone: 'silver',
  hexTint: 'rgba(0,0,0,0)',
  textColor: '#f2f4f7',
};

// EMV chip icon for the card's top-left corner — tone follows the card's
// own metal finish (gold on the rose-gold card, silver on the Icy White one).
function ChipIcon({ tone }: { tone: 'gold' | 'silver' }) {
  const fill = tone === 'gold' ? '#dcb877' : '#c9ced5';
  const line = tone === 'gold' ? '#a9843f' : '#8a919b';
  return (
    <svg width="34" height="26" viewBox="0 0 34 26" xmlns="http://www.w3.org/2000/svg">
      <rect x="0.5" y="0.5" width="33" height="25" rx="4" fill={fill} stroke={line} strokeWidth="0.75" />
      <line x1="11.5" y1="0.5" x2="11.5" y2="25.5" stroke={line} strokeWidth="0.75" />
      <line x1="22.5" y1="0.5" x2="22.5" y2="25.5" stroke={line} strokeWidth="0.75" />
      <line x1="0.5" y1="9" x2="33.5" y2="9" stroke={line} strokeWidth="0.75" />
      <line x1="0.5" y1="17" x2="33.5" y2="17" stroke={line} strokeWidth="0.75" />
      <rect x="11.5" y="9" width="11" height="8" fill="none" stroke={line} strokeWidth="0.75" />
    </svg>
  );
}

// Large tone-on-tone hexagon + bolt watermark, the card's main brand mark —
// a low-opacity tint of the card's own finish, not a separate colored logo.
function HexEmblem({ tint }: { tint: string }) {
  return (
    <svg
      style={{ position: 'absolute', top: '16%', right: -18, width: 170, height: 170, pointerEvents: 'none' }}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
    >
      <polygon points="50,4 91,27 91,73 50,96 9,73 9,27" fill="none" stroke={tint} strokeWidth="3" />
      <path d="M54 20L28 52h20l-3 28 30-36H55l3-24z" fill={tint} />
    </svg>
  );
}

// Text-based network mark — swap for the real issuing network's artwork
// once the card partnership is finalized.
function VisaMark({ color }: { color: string }) {
  return <span style={{ ...styles.visaMark, color }}>VISA</span>;
}

// Classic dual-circle Mastercard mark — same placeholder spirit as
// VisaMark above (real network artwork lands once the partnership is
// finalized), geometric rather than text so it reads correctly next to it.
function MastercardMark() {
  return (
    <svg width="34" height="21" viewBox="0 0 34 21" xmlns="http://www.w3.org/2000/svg">
      <circle cx="13" cy="10.5" r="10.5" fill="#EB001B" opacity="0.88" />
      <circle cx="21" cy="10.5" r="10.5" fill="#F79E1B" opacity="0.88" />
    </svg>
  );
}

// Shared layout for both card visuals — only the finish (background/
// border/shadow) differs between the base and Icy White cards.
const CARD_VISUAL_BASE: CSSProperties = {
  position: 'relative',
  width: 300,
  aspectRatio: '1.586',
  borderRadius: 18,
  padding: 24,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

/**
 * Brushed-metal finish, EMV chip, hexagon watermark, masked demo
 * number/cardholder (design placeholders, not real data), the VOLTEX
 * wordmark, and a DEBIT/network lockup. Only the finish, last 4 digits,
 * holder name, and network mark vary between the two cards. Wrap in a
 * `.card-tilt-wrap` div for the hover-tilt effect (see index.css).
 */
export function CardFace({
  theme,
  last4,
  holderName,
  network = 'visa',
}: {
  theme: CardTheme;
  last4: string;
  holderName: string;
  network?: 'visa' | 'mastercard';
}) {
  return (
    <div className="card-tilt" style={{ ...CARD_VISUAL_BASE, background: theme.background, border: theme.border, boxShadow: theme.boxShadow }}>
      <div style={styles.brushedTexture} />
      <HexEmblem tint={theme.hexTint} />
      <div style={styles.cardVisualSheen} />
      <div style={styles.cardVisualTop}>
        <ChipIcon tone={theme.chipTone} />
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ ...styles.cardVisualNumber, color: theme.textColor }} className="mono">
        •••• •••• •••• {last4}
      </div>
      <div style={{ height: 14 }} />
      <div style={styles.cardVisualBottom}>
        <div style={styles.cardVisualBrand}>
          <span style={{ ...styles.cardVisualWordmark, color: theme.textColor }}>
            VO<span style={styles.cardVisualWordmarkL}>L</span>TEX
          </span>
          <span style={{ ...styles.cardVisualHolder, color: theme.textColor }} className="mono">
            {holderName}
          </span>
        </div>
        <div style={styles.cardNetworkStack}>
          <span style={{ ...styles.cardDebitLabel, color: theme.textColor }}>DEBIT</span>
          {network === 'mastercard' ? <MastercardMark /> : <VisaMark color={theme.textColor} />}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  // Fine diagonal brushed-metal streaks, layered over the card's own
  // gradient finish.
  brushedTexture: {
    position: 'absolute',
    inset: 0,
    backgroundImage:
      'repeating-linear-gradient(115deg, rgba(255,255,255,0.28) 0px, rgba(255,255,255,0.28) 1px, rgba(0,0,0,0.035) 2px, transparent 3px, transparent 6px)',
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
  cardVisualNumber: { fontSize: 16, fontWeight: 700, letterSpacing: '0.08em' },
  cardVisualHolder: { fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', marginTop: 8 },
  cardVisualBottom: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' },
  cardVisualBrand: { display: 'flex', flexDirection: 'column', gap: 3 },
  cardVisualWordmark: {
    fontWeight: 800,
    fontSize: 16,
    fontFamily: 'var(--font-mono)',
    letterSpacing: '0.03em',
  },
  cardVisualWordmarkL: {
    backgroundImage: 'linear-gradient(135deg, #ffd166, var(--accent))',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  cardNetworkStack: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 },
  cardDebitLabel: { fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', opacity: 0.7 },
  visaMark: {
    fontFamily: 'var(--font-display)',
    fontWeight: 900,
    fontStyle: 'italic',
    fontSize: 17,
    letterSpacing: '0.01em',
  },
};
