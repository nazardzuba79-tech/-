import { orderDepositDestinations } from '../depositOrder';

const rail = (asset: string, network: string, standard = 'Native') => ({ chain: `${asset.toLowerCase()}:${network}`, assets: [asset], standard, address: `${asset}-${network}` });
const catalogue = [
  rail('BTC', 'bitcoin'), rail('ETH', 'ethereum'), rail('USDT', 'ethereum', 'ERC-20'), rail('USDT', 'tron', 'TRC-20'),
  rail('USDC', 'ethereum', 'ERC-20'), rail('BNB', 'bsc'), rail('SOL', 'solana'), rail('POL', 'polygon'), rail('TON', 'ton'),
];

describe('deposit destinations: USDT on TRC-20 first', () => {
  it('puts USDT · TRC-20 first, then USDT ERC-20, then the catalogue order', () => {
    expect(orderDepositDestinations(catalogue).map(d => d.chain)).toEqual([
      'usdt:tron', 'usdt:ethereum', 'btc:bitcoin', 'eth:ethereum', 'usdc:ethereum', 'bnb:bsc', 'sol:solana', 'pol:polygon', 'ton:ton',
    ]);
  });
  it('changes only the order: the same destinations, untouched', () => {
    const ordered = orderDepositDestinations(catalogue);
    expect(ordered).toHaveLength(catalogue.length);
    for (const d of catalogue) expect(ordered).toContain(d);
    expect(catalogue[0].chain).toBe('btc:bitcoin'); // input not mutated
  });
  it('without TRC-20, USDT still leads; without USDT, nothing moves', () => {
    const noTron = catalogue.filter(d => d.chain !== 'usdt:tron');
    expect(orderDepositDestinations(noTron)[0].chain).toBe('usdt:ethereum');
    const noUsdt = catalogue.filter(d => !d.assets.includes('USDT'));
    expect(orderDepositDestinations(noUsdt)).toEqual(noUsdt);
  });
});
