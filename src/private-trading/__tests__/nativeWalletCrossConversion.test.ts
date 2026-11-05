/**
 * Native Cross demo wallet conversion: deterministic replay, not a real
 * trade, not a withdrawal and not a modification of Copy Trading.
 */
import { applyNativeWalletConversion, emptyDemoState } from '../native/engine';
import { accountLedger } from '../native/ledger';
import { instructionDigest, replayNativeDemoAsync, type NativeInstruction } from '../native/replay';
import { nativeCrossFreeUSDT } from '../../services/WalletCrossDemoConversion';
import type { NativeAccount } from '../native/store';

const NOW = 1_790_000_000_000;
const instruction: NativeInstruction = {
  kind: 'WALLET_CONVERSION', id: 'cross-conversion:fixture',
  quoteId: '11111111-1111-4111-8111-111111111111',
  fromAmount: '25000', toAsset: 'EUR', toAmount: '21300',
  at: NOW + 1_000, seq: 1,
};

test('Cross demo conversion USDT debit is a replayable, non-PnL ledger movement', async () => {
  const state = emptyDemoState('1000000', NOW);
  applyNativeWalletConversion(state, instruction.id, instruction.fromAmount, instruction.at);
  expect(state.walletBalance).toBe('975000');
  expect(state.initialDeposit).toBe('1000000');
  expect(state.events).toHaveLength(1);
  expect(state.events[0]).toMatchObject({
    kind: 'WALLET_CONVERSION', cashflow: '-25000', fee: '0', symbol: 'USDT',
  });
  const ledger = accountLedger(state);
  expect(ledger.reconciled).toBe(true);
  expect(ledger.closingBalance).toBe('975000');
  expect(ledger.totals.net).toBe('0');
  expect(ledger.entries.at(-1)).toMatchObject({
    source: 'WALLET_CONVERSION', amount: '-25000',
  });

  const full = await replayNativeDemoAsync({ deposit: '1000000', instructions: [instruction],
    asOf: NOW + 1_000 }, async () => { throw Error('flat account must not need candles'); });
  expect(full.snapshot.walletBalance).toBe(state.walletBalance);
  expect(accountLedger(full.snapshot).reconciled).toBe(true);

  const checkpoint = {
    time: instruction.at, digest: instructionDigest([instruction], Infinity),
    commandCount: 1, state: structuredClone(full.snapshot),
  };
  const restarted = await replayNativeDemoAsync({ deposit: '1000000', instructions: [instruction],
    asOf: NOW + 2_000, checkpoint }, async () => { throw Error('no candles'); });
  expect(restarted.snapshot.walletBalance).toBe('975000');
  await expect(replayNativeDemoAsync({
    deposit: '1000000', instructions: [{ ...instruction, fromAmount: '50000' }],
    asOf: NOW + 2_000, checkpoint,
  }, async () => [])).rejects.toThrow('CHECKPOINT_MISMATCH');
});

test('only actual free, uncommitted native USDT can be converted', () => {
  const state = emptyDemoState('1000000', NOW);
  const base = { revision: 1, deposit: '1000000', createdAt: NOW,
    source: 'DEMO_BALANCE', commands: [], snapshot: state } as NativeAccount;
  expect(nativeCrossFreeUSDT(base)).toBe('1000000');
  expect(() => applyNativeWalletConversion(state, 'overdraw', '1000001', NOW + 1_000))
    .toThrow('CROSS_CONVERSION_INSUFFICIENT_CASH');
  expect(state.walletBalance).toBe('1000000');
  expect(() => applyNativeWalletConversion(state, 'zero', '0', NOW + 1_000))
    .toThrow('INVALID_CONVERSION_AMOUNT');

  state.orders.push({ status: 'OPEN' } as typeof state.orders[number]);
  expect(nativeCrossFreeUSDT({ ...base, snapshot: state })).toBeNull();
  expect(() => applyNativeWalletConversion(state, 'with-order', '100', NOW + 1_000))
    .toThrow('CROSS_CONVERSION_ACTIVE_EXPOSURE');
  state.orders.length = 0;
  state.positions.push({ status: 'OPEN' } as typeof state.positions[number]);
  expect(nativeCrossFreeUSDT({ ...base, snapshot: state })).toBeNull();
  expect(() => applyNativeWalletConversion(state, 'with-position', '100', NOW + 1_000))
    .toThrow('CROSS_CONVERSION_ACTIVE_EXPOSURE');
  expect(state.walletBalance).toBe('1000000');
});
