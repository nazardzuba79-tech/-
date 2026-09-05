/** Decorative identities for the fictional catalogue, never account/verification data.
 * VX-001 deliberately stays absent: its existing uploaded operator photo wins.
 * Portraits and mascots are original generated demo artwork, not real customers.
 */
export type TraderMark = 'quant' | 'red-dot' | 'globe' | 'mountain' | 'mandala'
  | 'coffee' | 'atlas' | 'river' | 'constellation' | 'tiger' | 'flow' | 'leaf'
  | 'delta' | 'nexa' | 'kite' | 'zen' | 'lion' | 'blocks' | 'dragon' | 'whale'
  | 'lightning' | 'owl' | 'monogram';

export type TraderVisual = Readonly<{
  avatarSrc?: string;
  mark?: TraderMark;
  initials?: string;
  accent?: string;
  background?: string;
  /** Surface treatment only; carries no ranking or endorsement meaning. */
  highlight?: 'gold' | 'silver' | 'copper';
}>;

const TRADER_VISUALS: Readonly<Record<string, TraderVisual>> = {
  'VX-002': { mark: 'quant', accent: '#a7e2f2', background: '#182934', highlight: 'silver' },
  'VX-003': { mark: 'red-dot', accent: '#ee776a', background: '#291c21', highlight: 'copper' },
  'VX-004': { avatarSrc: '/copy-trading/avatars/sakura-quant.webp', accent: '#e6a8ad' },
  'VX-005': { avatarSrc: '/copy-trading/avatars/seoul-sigma.webp', accent: '#8ebbad' },
  'VX-006': { mark: 'globe', accent: '#a8cce2', background: '#1c273b' },
  'VX-007': { avatarSrc: '/copy-trading/avatars/moon-rabbit.webp', accent: '#c7a9f2', highlight: 'copper' },
  'VX-008': { mark: 'mountain', accent: '#e7dac1', background: '#293238', highlight: 'gold' },
  'VX-009': { mark: 'mandala', accent: '#ddaf69', background: '#33291f' },
  'VX-010': { avatarSrc: '/copy-trading/avatars/panda-block.webp', accent: '#a3cc9b' },
  'VX-011': { mark: 'coffee', accent: '#edc299', background: '#483329' },
  'VX-012': { mark: 'atlas', accent: '#e9e1c8', background: '#313b47' },
  'VX-013': { mark: 'river', accent: '#a4dfd6', background: '#183a3e' },
  'VX-014': { mark: 'constellation', accent: '#b4b8ff', background: '#232140' },
  'VX-015': { mark: 'tiger', accent: '#eac181', background: '#463027' },
  'VX-016': { mark: 'flow', accent: '#eaeee2', background: '#52625c' },
  'VX-017': { mark: 'leaf', accent: '#b5d295', background: '#283c2c' },
  'VX-018': { mark: 'delta', accent: '#d1d6dc', background: '#353947' },
  'VX-019': { mark: 'nexa', accent: '#81cadc', background: '#16323b' },
  'VX-020': { mark: 'kite', accent: '#f1b688', background: '#4a3332' },
  'VX-021': { mark: 'monogram', initials: 'iq', accent: '#e9dfbf', background: '#4b403b' },
  'VX-022': { mark: 'zen', accent: '#d6d5c8', background: '#343d3a' },
  'VX-023': { mark: 'lion', accent: '#9ecbf0', background: '#243752' },
  'VX-024': { mark: 'mandala', accent: '#f0a6b2', background: '#452834' },
  'VX-025': { mark: 'blocks', accent: '#c0a4f1', background: '#34274e' },
  'VX-026': { mark: 'dragon', accent: '#9fd8b1', background: '#19382d' },
  'VX-027': { mark: 'whale', accent: '#9bd8ee', background: '#1f344f' },
  'VX-028': { mark: 'lightning', accent: '#f4c783', background: '#573929' },
  'VX-029': { mark: 'owl', accent: '#c1b6ee', background: '#322b49' },
  'VX-030': { mark: 'monogram', initials: 'VH', accent: '#f0ada9', background: '#452b33' },
  'VX-031': { mark: 'delta', accent: '#b4d6c6', background: '#284138' },
};

const DEFAULT_VISUAL: TraderVisual = Object.freeze({});

export function getTraderVisual(traderId: string): TraderVisual {
  return Object.prototype.hasOwnProperty.call(TRADER_VISUALS, traderId) ? TRADER_VISUALS[traderId] : DEFAULT_VISUAL;
}
