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
  // Optional real gradient ring around the card (a padded outer div whose
  // own background shows through as a border), for themes where a plain
  // CSS `border` (a single flat color) reads too faint — e.g. the Dark
  // card's neon cyan-to-purple rim. When set, this takes over from `border`.
  borderGradient?: string;
  // Flat, minimal face (single-tone fill, no brushed-metal streaks, no
  // hex/bolt watermark, a plain 3x3-dot chip, a small product-name label
  // under the wordmark) — a direct port of a Bolt.new reference's BankCard
  // design, used only by the gold VIP card. Icy White/VIP keeps the
  // original brushed-metal + neon-ring face.
  flat?: boolean;
  // Small uppercase label under the wordmark in flat mode (e.g. "CRYPTO
  // CARD") — a fixed card-face convention, not translated, same spirit as
  // "DEBIT"/"VISA" already being fixed English elsewhere on the face.
  flatSubtitle?: string;
}

// Flat, true gold — the same #ffd166->#f7a600 family as the VIP-cashback
// badge sitting right below the card on CardPage. Minimal face (see `flat`
// above) instead of the brushed-metal treatment the black card keeps.
export const BASE_CARD_THEME: CardTheme = {
  background: '#f0cd74',
  border: '1px solid rgba(140,100,10,0.16)',
  boxShadow: '0 20px 44px rgba(150,110,10,0.18), 0 6px 16px rgba(150,110,10,0.1)',
  chipTone: 'gold',
  hexTint: 'rgba(120,80,10,0.16)',
  textColor: '#231704',
  flat: true,
  flatSubtitle: 'CRYPTO CARD',
};

// Dark graphite metal with a genuine neon violet-to-cyan gradient ring — the
// Icy White card's visual redesign (still the same product/tier underneath,
// only the face changed: no more silver brushed metal, no hex/bolt
// watermark). Colors below are design tokens reconstructed from the user's
// reference image (via a vision-model color read), not guessed — matte
// graphite rather than flat black, glow skewed purple-heavy on one side.
// borderGradient paints as a real 2px ring (see CardFace's wrapper div
// below), not just a soft shadow, so it reads as a crisp glowing edge.
export const ICY_CARD_THEME: CardTheme = {
  background: 'linear-gradient(135deg, #4a4f59 0%, #30343d 28%, #1d2027 62%, #15181e 100%)',
  border: '1px solid rgba(120,150,200,0.22)',
  borderGradient: 'linear-gradient(135deg, #9b3cff 0%, #704bff 27%, #536fff 52%, #258dff 78%, #00c8ff 100%)',
  boxShadow: '0 0 24px rgba(139,53,255,0.4), 0 0 44px rgba(0,191,255,0.28), 35px 38px 45px rgba(0,0,0,0.48)',
  chipTone: 'silver',
  hexTint: 'rgba(0,0,0,0)',
  textColor: '#c6cad2',
};

// EMV chip icon for the card's top-left corner — tone follows the card's
// own metal finish (gold on the rose-gold card, silver on the Icy White one).
function ChipIcon({ tone }: { tone: 'gold' | 'silver' }) {
  const fill = tone === 'gold' ? '#dcb877' : '#c4c8d0';
  const line = tone === 'gold' ? '#a9843f' : '#737881';
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

// Plain 3x3-dot chip for the flat card face — matches the reference's
// minimal chip instead of the etched-EMV-outline ChipIcon above.
function SimpleChip({ textColor }: { textColor: string }) {
  return (
    <div style={{ ...styles.simpleChip, borderColor: textColor }}>
      <div style={styles.simpleChipGrid}>
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} style={{ ...styles.simpleChipCell, background: textColor }} />
        ))}
      </div>
    </div>
  );
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

// Border-ring thickness when a theme uses borderGradient (see CardTheme).
const RING_WIDTH = 2;

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
  imageSrc,
  imageWidth = 340,
}: {
  theme: CardTheme;
  last4: string;
  holderName: string;
  network?: 'visa' | 'mastercard';
  // When set, renders this real photo/render instead of the CSS-built
  // face below — used for the Icy White card's dark redesign, sourced
  // straight from the user's own reference image.
  imageSrc?: string;
  // Display width in px for the imageSrc branch — callers with more room
  // (e.g. a wide promo banner) can size it up so it's easier to make out.
  imageWidth?: number;
}) {
  if (imageSrc) {
    // The real photo's own aspect ratio (530:440) — reusing CARD_VISUAL_BASE's
    // 1.586 (credit-card) aspect would force a crop tight enough to cut into
    // the photo's own background chart graphic and stacked-card shadow.
    return (
      <img
        src={imageSrc}
        alt="Voltex card"
        className="card-tilt"
        style={{ position: 'relative', width: imageWidth, aspectRatio: '530 / 440', borderRadius: 18, display: 'block', objectFit: 'contain' }}
      />
    );
  }

  if (theme.flat) {
    return (
      <div className="card-tilt" style={{ ...CARD_VISUAL_BASE, background: theme.background, border: theme.border, boxShadow: theme.boxShadow }}>
        <div style={styles.flatSheen} />
        <div style={styles.cardVisualTop}>
          <div style={styles.flatBrand}>
            <span style={{ ...styles.cardVisualWordmark, color: theme.textColor }}>
              VO<span style={styles.flatWordmarkL}>L</span>TEX
            </span>
            {theme.flatSubtitle && <span style={{ ...styles.flatSubtitle, color: theme.textColor }}>{theme.flatSubtitle}</span>}
          </div>
          <SimpleChip textColor={theme.textColor} />
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ ...styles.cardVisualNumber, color: theme.textColor }} className="mono">
          •••• •••• •••• {last4}
        </div>
        <div style={{ height: 16 }} />
        <div style={styles.cardVisualBottom}>
          <div style={styles.flatHolderStack}>
            <span style={{ ...styles.flatHolderLabel, color: theme.textColor }}>Card Holder</span>
            <span style={{ ...styles.cardVisualHolder, color: theme.textColor, marginTop: 1 }} className="mono">
              {holderName}
            </span>
          </div>
          <div style={styles.cardNetworkStack}>
            {network === 'mastercard' ? <MastercardMark /> : <VisaMark color={theme.textColor} />}
          </div>
        </div>
      </div>
    );
  }

  const content = (
    <>
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
            VO
            {/* The gold-gradient "L" only reads correctly against a dark
                finish (it's how the Icy White card's L pops) — on the gold
                card itself, a gold-on-gold gradient would just vanish, so
                that card's L stays plain like the rest of the wordmark. */}
            <span style={theme.chipTone === 'silver' ? styles.cardVisualWordmarkL : undefined}>L</span>TEX
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
    </>
  );

  // A plain CSS `border` can only ever be one flat color — for a theme
  // that wants a real cyan-to-purple gradient ring, the ring has to be
  // painted as this outer div's own background, showing through a padding
  // gap around an inner div that holds the actual dark card fill.
  if (theme.borderGradient) {
    return (
      <div className="card-tilt" style={{ ...CARD_VISUAL_BASE, padding: RING_WIDTH, display: 'block', background: theme.borderGradient, boxShadow: theme.boxShadow }}>
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            borderRadius: 18 - RING_WIDTH,
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: theme.background,
            boxShadow: 'inset 0 0 35px rgba(0,0,0,0.28)',
          }}
        >
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="card-tilt" style={{ ...CARD_VISUAL_BASE, background: theme.background, border: theme.border, boxShadow: theme.boxShadow }}>
      {content}
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
  // Subtle radial highlight for the flat card face — the reference's own
  // sheen, not the brushed card's diagonal streak+wide sweep.
  flatSheen: {
    position: 'absolute',
    inset: 0,
    background: 'radial-gradient(120% 80% at 85% 10%, rgba(255,255,255,0.4), transparent 55%)',
    pointerEvents: 'none',
  },
  flatBrand: { display: 'flex', flexDirection: 'column', gap: 2 },
  flatSubtitle: { fontSize: 9, fontWeight: 700, letterSpacing: '0.24em', opacity: 0.6, marginTop: 1 },
  flatWordmarkL: { opacity: 0.85 },
  flatHolderStack: { display: 'flex', flexDirection: 'column', gap: 2 },
  flatHolderLabel: { fontSize: 8, fontWeight: 600, letterSpacing: '0.14em', opacity: 0.55, textTransform: 'uppercase' },
  simpleChip: {
    width: 32,
    height: 24,
    borderRadius: 5,
    border: '1px solid',
    opacity: 0.9,
    position: 'relative',
    background: 'rgba(255,255,255,0.12)',
  },
  simpleChipGrid: {
    position: 'absolute',
    inset: 3,
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gridTemplateRows: 'repeat(3, 1fr)',
    gap: 1.5,
  },
  simpleChipCell: { opacity: 0.35, borderRadius: 0.5 },
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
