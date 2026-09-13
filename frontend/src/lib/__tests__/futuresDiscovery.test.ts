import { discoverFuturesSymbols, FuturesUniverseInstrument } from '../futuresDiscovery';

const instrument = (symbol: string, overrides = {}): FuturesUniverseInstrument => ({
  symbol, marketType: 'linear_perpetual', status: 'Trading', quoteAsset: 'USDT', settleAsset: 'USDT', ...overrides,
});

test('all 761 real contracts remain discoverable with only 28 executable contracts', () => {
  const instruments = Array.from({ length: 761 }, (_, n) => instrument(`ASSET${n}/USDT`));
  const executable = instruments.slice(0, 28).map(i => i.symbol);
  const result = discoverFuturesSymbols(executable, { available: true, value: { instruments } });
  expect(result).toHaveLength(761);
  expect(result).toContain('ASSET760/USDT');
  expect(executable).toHaveLength(28);
  expect(executable).not.toContain('ASSET760/USDT');
});

test('excludes dated, inverse, USDC and inactive contracts; retains in-flight execution symbols', () => {
  const instruments = [instrument('BTC/USDT'), instrument('BTC/USDT'),
    instrument('DATED/USDT', { marketType: 'linear_futures' }),
    instrument('INVERSE/USDT', { marketType: 'inverse' }),
    instrument('USDC/USDC', { quoteAsset: 'USDC', settleAsset: 'USDC' }),
    instrument('CLOSED/USDT', { status: 'Closed' })];
  expect(discoverFuturesSymbols(['HELD/USDT'], { available: true, value: { instruments } }))
    .toEqual(['HELD/USDT', 'BTC/USDT']);
});

test('unavailable discovery keeps only the authoritative executable set, never invented rows', () => {
  expect(discoverFuturesSymbols(['BTC/USDT'], null)).toEqual(['BTC/USDT']);
  expect(discoverFuturesSymbols(['BTC/USDT'], { available: false })).toEqual(['BTC/USDT']);
});
