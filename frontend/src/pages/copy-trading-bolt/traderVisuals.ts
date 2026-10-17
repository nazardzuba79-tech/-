/** Decorative identities for the fictional catalogue, never account/verification data.
 * VX-001 deliberately stays absent: its existing uploaded operator photo wins.
 * Portraits and mascots are original generated demo artwork, not real customers.
 */
export type TraderMark = 'quant' | 'red-dot' | 'globe' | 'mountain' | 'mandala'
  | 'coffee' | 'atlas' | 'river' | 'constellation' | 'tiger' | 'flow' | 'leaf'
  | 'delta' | 'nexa' | 'kite' | 'zen' | 'lion' | 'blocks' | 'dragon' | 'whale'
  | 'lightning' | 'owl' | 'monogram' | 'coffee-creature' | 'sleepy-tiger'
  | 'kiwi-bird' | 'pixel-dragon' | 'moon-owl' | 'chrome-visor' | 'prism-face'
  | 'pixel-sentinel' | 'neon-orbit' | 'ink-reader' | 'coral-editor' | 'aqua-pilot';

export type TraderIdentityCategory = 'mascot' | 'digital' | 'portrait' | 'abstract' | 'initials';

export type TraderVisual = Readonly<{
  /** Artwork taxonomy only; never consumed by ranking or business logic. */
  category?: TraderIdentityCategory;
  avatarSrc?: string;
  mark?: TraderMark;
  initials?: string;
  accent?: string;
  background?: string;
  /** Surface treatment only; carries no ranking or endorsement meaning. */
  highlight?: 'gold' | 'silver' | 'copper';
}>;

const TRADER_VISUALS: Readonly<Record<string, TraderVisual>> = {
  'VX-002': { category: 'abstract', mark: 'quant', accent: '#8dd9ed', background: '#152e3b', highlight: 'silver' },
  'VX-003': { category: 'digital', avatarSrc: '/copy-trading/avatars/red-glass-mask.webp', mark: 'red-dot', accent: '#ee776a', background: '#291c21', highlight: 'copper' },
  'VX-004': { category: 'portrait', avatarSrc: '/copy-trading/avatars/sakura-ink.webp', mark: 'ink-reader', accent: '#e6a8ad', background: '#efe5d5' },
  'VX-005': { category: 'portrait', avatarSrc: '/copy-trading/avatars/seoul-cyber.webp', mark: 'aqua-pilot', accent: '#8ebbad', background: '#162b42' },
  'VX-006': { category: 'abstract', mark: 'globe', accent: '#e9bd7d', background: '#392d25' },
  'VX-007': { category: 'mascot', avatarSrc: '/copy-trading/avatars/moon-rabbit.webp', mark: 'owl', accent: '#c7a9f2', background: '#272137', highlight: 'copper' },
  'VX-008': { category: 'abstract', mark: 'mountain', accent: '#e7dac1', background: '#293238', highlight: 'gold' },
  'VX-009': { category: 'abstract', mark: 'mandala', accent: '#ccacfa', background: '#312549' },
  'VX-010': { category: 'mascot', avatarSrc: '/copy-trading/avatars/panda-block.webp', mark: 'tiger', accent: '#a3cc9b', background: '#26392c' },
  'VX-011': { category: 'mascot', mark: 'coffee-creature', accent: '#edc299', background: '#c8e3dc' },
  'VX-012': { category: 'digital', mark: 'chrome-visor', accent: '#e9e1c8', background: '#181d2a' },
  'VX-013': { category: 'abstract', mark: 'river', accent: '#a4dfd6', background: '#183a3e' },
  'VX-014': { category: 'abstract', mark: 'constellation', accent: '#b4b8ff', background: '#232140' },
  'VX-015': { category: 'mascot', mark: 'sleepy-tiger', accent: '#eac181', background: '#e6b562' },
  'VX-016': { category: 'mascot', avatarSrc: '/copy-trading/avatars/otter-break.webp', mark: 'coffee', accent: '#eaeee2', background: '#52625c' },
  'VX-017': { category: 'mascot', mark: 'kiwi-bird', accent: '#b5d295', background: '#e1ead0' },
  'VX-018': { category: 'abstract', mark: 'delta', accent: '#d1d6dc', background: '#353947' },
  'VX-019': { category: 'abstract', mark: 'nexa', accent: '#91dfbd', background: '#1d3934' },
  'VX-020': { category: 'digital', mark: 'prism-face', accent: '#f1b688', background: '#eacbd6' },
  'VX-021': { category: 'initials', accent: '#ccc9be', background: '#393c36' },
  'VX-022': { category: 'portrait', mark: 'ink-reader', accent: '#d6d5c8', background: '#efe5d5' },
  'VX-023': { category: 'portrait', mark: 'coral-editor', accent: '#9ecbf0', background: '#e7b8ab' },
  'VX-024': { category: 'initials', accent: '#d2c8cd', background: '#3d343b' },
  'VX-025': { category: 'digital', mark: 'pixel-sentinel', accent: '#c0a4f1', background: '#272140' },
  'VX-026': { category: 'mascot', mark: 'pixel-dragon', accent: '#9fd8b1', background: '#d1deb1' },
  'VX-027': { category: 'portrait', mark: 'aqua-pilot', accent: '#9bd8ee', background: '#193f56' },
  'VX-028': { category: 'digital', mark: 'neon-orbit', accent: '#f4c783', background: '#160d29' },
  'VX-029': { category: 'mascot', mark: 'moon-owl', accent: '#c1b6ee', background: '#18293d' },
  'VX-030': { category: 'initials', accent: '#cecbd5', background: '#37333f' },
  'VX-031': { category: 'abstract', mark: 'zen', accent: '#b4d6c6', background: '#284138' },
};

const DEFAULT_VISUAL: TraderVisual = Object.freeze({});

// The 432 invitation-only aliases have no financial data. Give each a stable
// mark/palette pair instead of recycling the same initials and six backgrounds.
// 24 silhouettes × 18 palettes = 432 identities, with no random/render clock.
const DIRECTORY_MARKS: readonly TraderMark[] = ['quant', 'red-dot', 'globe', 'mountain', 'mandala', 'coffee',
  'atlas', 'river', 'constellation', 'tiger', 'flow', 'leaf', 'delta', 'nexa', 'kite', 'zen',
  'lion', 'blocks', 'dragon', 'whale', 'lightning', 'owl', 'neon-orbit', 'monogram'];
const DIRECTORY_VISUALS = Array.from({ length: 432 }, (_, index): TraderVisual => {
  const palette = Math.floor(index / DIRECTORY_MARKS.length);
  const hue = (palette * 137 + (index % DIRECTORY_MARKS.length) * 47) % 360;
  return Object.freeze({ category: 'abstract', mark: DIRECTORY_MARKS[index % DIRECTORY_MARKS.length],
    initials: `V${index + 1}`, accent: `hsl(${hue} 65% 75%)`, background: `hsl(${hue} 32% 17%)` });
});

export function getTraderVisual(traderId: string): TraderVisual {
  const directoryId = /^VX-L(\d{3})$/.exec(traderId);
  if (directoryId) return DIRECTORY_VISUALS[Number(directoryId[1]) - 1] ?? DEFAULT_VISUAL;
  return Object.prototype.hasOwnProperty.call(TRADER_VISUALS, traderId) ? TRADER_VISUALS[traderId] : DEFAULT_VISUAL;
}
