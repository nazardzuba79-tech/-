import type { DemoInstrument } from '../native/engine';
import { replayNativeDemo, type NativeInstruction, type ReplayBar } from '../native/replay';

const T = 1_728_000_000_000;

const instrument: DemoInstrument = {
  rules: {
    symbol: 'ZECUSDT',
    tickSize: '0.1',
    qtyStep: '1',
    minOrderQty: '1',
    maxOrderQty: '10000',
    maxMarketOrderQty: '10000',
    minNotionalValue: '5',
    minLeverage: '1',
    maxLeverage: '100',
    leverageStep: '1',
  },
  profile: {
    pricingModelVersion: 'fixture',
    feeModelVersion: 'fixture',
    riskModelVersion: 'fixture',
    takerFeeRate: '0.00055',
    makerFeeRate: '0.0002',
    liquidationFeeRate: '0',
    slippageBps: '0',
    riskTiers: [
      { maxNotional: '100000', maintenanceRate: '0.005', deduction: '0', maxLeverage: '20' },
      { maxNotional: '10000000', maintenanceRate: '0.01', deduction: '500', maxLeverage: '5' },
    ],
    assumptions: [],
  },
};

const bar: ReplayBar = {
  time: T,
  intervalMs: 60_000,
  trade: { timestamp: T, open: '500', low: '500', high: '2000', close: '2000' },
  mark: { timestamp: T, open: '500', low: '500', high: '2000', close: '2000' },
};

test('market close remains allowed after a profitable position grows into a tier below its entry leverage', () => {
  const open: NativeInstruction = {
    id: 'open-zec',
    kind: 'OPEN',
    at: T,
    order: {
      id: 'position-zec',
      symbol: 'ZECUSDT',
      side: 'LONG',
      type: 'MARKET',
      quantity: '100',
      leverage: '10',
      marginType: 'CROSS',
    },
    instrument,
    mark: '500',
    last: '500',
    point: '500',
  };
  const close: NativeInstruction = {
    id: 'close-zec',
    kind: 'CLOSE',
    at: T + 59_999,
    positionId: 'position-zec',
    quantity: '100',
    price: '2000',
    book: {
      timestamp: T + 59_999,
      bids: [{ price: '2000', quantity: '100' }],
      asks: [],
    },
  };

  // At entry the 50k notional permits 10x. At the close mark the same
  // position is worth 200k, whose entry tier permits only 5x. That lower
  // admission ceiling must never trap an already-open position: CLOSE is
  // risk-reducing and must be able to exit at the observed book.
  const state = replayNativeDemo({
    deposit: '1000000',
    instructions: [open, close],
    bars: { ZECUSDT: [bar] },
    asOf: T + 60_000,
  });

  expect(state.positions[0]).toMatchObject({
    id: 'position-zec',
    status: 'CLOSED',
    quantity: '0',
    leverage: '10',
  });
  expect(state.events.filter((event) => event.kind === 'CLOSE')).toHaveLength(1);
  expect(state.events.find((event) => event.kind === 'CLOSE')).toMatchObject({
    positionId: 'position-zec',
    quantity: '100',
    price: '2000',
  });
});
