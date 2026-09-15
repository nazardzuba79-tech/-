import type { Trader } from './traders';

/**
 * Lightweight, deterministic TEST catalogue used only for the invite-only list.
 * These are fictional demo aliases, not customer identities or real verified traders.
 * Keeping them local means hundreds of rows add no API polling, websocket, chart,
 * profile or background-worker load.
 */
const PREFIXES = [
  'Alpha','Apex','Atlas','Aurora','Beacon','Blue','Cipher','Core','Delta','Echo',
  'Flux','Gamma','Helix','Iron','Jade','Kinetic','Luna','Nova','Omega','Orion',
];
const SUFFIXES = [
  'Arc','Byte','Capital','Chain','Edge','Flow','Grid','Labs','Matrix','Node',
  'Pulse','Quant','River','Sigma','Stack','Trade',
];
const REGIONS = ['Singapore','Japan','South Korea','Hong Kong','Switzerland','Germany','United Kingdom','United Arab Emirates','Australia','Canada'];
const TONES = ['blue','green','orange','rose','slate'];
const STRATEGIES: Array<Pick<Trader, 'strategy' | 'category' | 'risk'>> = [
  { strategy: 'Quantitative Strategy', category: 'quant', risk: 'Moderate' },
  { strategy: 'Swing Trader', category: 'swing', risk: 'Moderate' },
  { strategy: 'Trend Strategy', category: 'trend', risk: 'Moderate' },
  { strategy: 'Futures Specialist', category: 'futures', risk: 'High' },
  { strategy: 'Market Neutral', category: 'arbitrage', risk: 'Low' },
  { strategy: 'Multi-Asset Trader', category: 'multi-asset', risk: 'Moderate' },
  { strategy: 'Long-Term Investor', category: 'long-term', risk: 'Low' },
];

const round = (value: number, digits = 2) => Number(value.toFixed(digits));

export const lockedTraderCatalog: Trader[] = Array.from({ length: 320 }, (_, index) => {
  const serial = index + 1;
  const prefix = PREFIXES[index % PREFIXES.length];
  const suffix = SUFFIXES[Math.floor(index / PREFIXES.length) % SUFFIXES.length];
  const strategy = STRATEGIES[index % STRATEGIES.length];
  const roi7 = round((((index * 37) % 1700) - 260) / 100);
  const roi30 = round(roi7 * 2.25 + (((index * 19) % 260) - 80) / 100);
  const roi90 = round(roi30 * 2.1 + (((index * 23) % 420) - 130) / 100);
  const roiAll = round(roi90 * 1.8 + ((index * 11) % 700) / 100);
  const winRate = round(52 + ((index * 29) % 3600) / 100);
  const drawdown = round(2.4 + ((index * 17) % 2500) / 100);
  const copiers = (index * 97) % 1400;
  const aum = 18_000 + ((index * 7919) % 3_200_000);
  const volume = round(0.6 + ((index * 41) % 3200) / 100);
  return {
    id: `VX-LOCK-${String(serial).padStart(4, '0')}`,
    name: `${prefix}${suffix}${String(serial).padStart(3, '0')}`,
    initials: `${prefix[0]}${suffix[0]}`,
    tone: TONES[index % TONES.length],
    region: REGIONS[index % REGIONS.length],
    strategy: strategy.strategy,
    category: strategy.category,
    roi7,
    roi30,
    roi90,
    roiAll,
    winRate,
    drawdown,
    copiers,
    aum,
    volume,
    risk: strategy.risk,
    activeMonths: 3 + (index % 30),
    performanceFee: 0.1,
  };
});
