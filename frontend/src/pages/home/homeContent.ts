import { marketplaceTraders, Trader } from '../copy-trading-bolt/traders';

/**
 * The homepage deliberately spotlights existing marketplace strategies.
 * These ids are aliases from the Copy Trading catalogue, not user
 * identities and not a second homepage-only financial model.
 */
export const HOME_COPY_TRADER_IDS = ['VX-013', 'VX-006', 'VX-004', 'VX-003'] as const;

export const HOME_COPY_TRADERS: Trader[] = HOME_COPY_TRADER_IDS.map((id) => {
  const trader = marketplaceTraders.find((candidate) => candidate.id === id);
  if (!trader) throw new Error(`Homepage Copy Trading strategy ${id} is missing`);
  return trader;
});

/**
 * No downloaded or reconstructed logos are used. These official company
 * names are rendered as restrained typographic references and accompanied
 * by explicit non-affiliation copy in the section itself.
 */
export const HOME_INSTITUTION_NAMES = [
  'Nasdaq',
  'NYSE',
  'CME Group',
  'Interactive Brokers',
  'Saxo Bank',
  'UBS Switzerland',
] as const;

