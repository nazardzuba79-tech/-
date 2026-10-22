import { withdrawableRows } from '../native/withdrawable';

describe('what a Cross trading account can withdraw', () => {
  const wallet = (available: string, rows: { asset: string; available: string }[]) => ({
    account: { available }, collateral: { settleAsset: 'USDT' }, rows,
  });

  it('caps the settle asset by the free margin, so margin behind a position is never claimed', () => {
    expect(withdrawableRows(wallet('750', [{ asset: 'USDT', available: '1000' }]))).toEqual([{ asset: 'USDT', available: '750' }]);
  });

  it('keeps the row figure when free margin is larger', () => {
    expect(withdrawableRows(wallet('5000', [{ asset: 'USDT', available: '1000' }]))).toEqual([{ asset: 'USDT', available: '1000' }]);
  });

  it('never goes below zero', () => {
    expect(withdrawableRows(wallet('-20', [{ asset: 'USDT', available: '1000' }]))).toEqual([{ asset: 'USDT', available: '0' }]);
  });

  it('leaves other assets at their own row figure', () => {
    expect(withdrawableRows(wallet('0', [{ asset: 'BTC', available: '0.5' }]))).toEqual([{ asset: 'BTC', available: '0.5' }]);
  });
});
