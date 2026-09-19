import type { DemoInstrument } from '../native/engine';
import { replayNativeDemo, type NativeInstruction, type ReplayBar } from '../native/replay';

const T = 1_728_000_000_000;

const instrument: DemoInstrument = {
  rules: {
    symbol: 'ZECUSDT',
    tickSize: '0.1',
    qtyStep: '1',
    minOrderQty: '1',
    maxOrderQty: '10',
    maxMarketOrderQty: '10',
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

function openInstructions(count:number):NativeInstruction[]{
  return Array.from({length:count},(_,index)=>({
    id:`open-zec-${index}`,
    kind:'OPEN' as const,
    at:T,
    order:{
      id:`position-zec-${index}`,
      symbol:'ZECUSDT',
      side:'LONG' as const,
      type:'MARKET' as const,
      quantity:'10',
      leverage:'10',
      marginType:'CROSS' as const,
    },
    instrument,
    mark:'500',
    last:'500',
    point:'500',
  }));
}

test('one close action can unwind a position accumulated above the per-order max after it grows into a lower-leverage tier', () => {
  // Ten individually valid 10-ZEC orders accumulate into one 100-ZEC live
  // position. The contract's per-order market max is still only 10 ZEC.
  const opens=openInstructions(10);
  const close: NativeInstruction = {
    id: 'close-zec',
    kind: 'CLOSE',
    at: T + 59_999,
    positionId: 'position-zec-0',
    quantity: '100',
    price: '2000',
    book: {
      timestamp: T + 59_999,
      bids: [{ price: '2000', quantity: '100' }],
      asks: [],
    },
  };

  // At entry the final 50k notional permits 10x. At the close mark the same
  // position is worth 200k, whose entry tier permits only 5x. A risk-reducing
  // close must not be trapped by either the 10-ZEC admission max or the 5x
  // entry ceiling. It may consume only the observed book and nothing else.
  const state = replayNativeDemo({
    deposit: '1000000',
    instructions: [...opens, close],
    bars: { ZECUSDT: [bar] },
    asOf: T + 60_000,
  });

  expect(state.positions[0]).toMatchObject({
    id: 'position-zec-0',
    status: 'CLOSED',
    quantity: '0',
    leverage: '10',
  });
  expect(state.events.filter((event) => event.kind === 'CLOSE')).toHaveLength(1);
  expect(state.events.find((event) => event.kind === 'CLOSE')).toMatchObject({
    positionId: 'position-zec-0',
    quantity: '100',
    price: '2000',
    pricing: 'OBSERVED_BOOK',
  });
});

test('repeated close commands never reuse liquidity from the same observed book snapshot', () => {
  const opens=openInstructions(2);
  const book={timestamp:T+59_998,bids:[{price:'2000',quantity:'10'}],asks:[]};
  const first:NativeInstruction={
    id:'close-one',kind:'CLOSE',at:T+59_998,positionId:'position-zec-0',quantity:'10',price:'2000',book,
  };
  const second:NativeInstruction={
    id:'close-two',kind:'CLOSE',at:T+59_999,positionId:'position-zec-0',quantity:'10',price:'2000',book,
  };
  const state=replayNativeDemo({deposit:'1000000',instructions:[...opens,first,second],bars:{ZECUSDT:[bar]},asOf:T+60_000});

  expect(state.positions[0]).toMatchObject({status:'OPEN',quantity:'10'});
  expect(state.events.filter(event=>event.kind==='CLOSE')).toHaveLength(1);
});

describe('book-consumption identity is the provider snapshot, not the stored slice', () => {
  // The service stores only the depth a command needs (`truncateBook`), so
  // one provider snapshot reaches the engine as DIFFERENT arrays. The ledger
  // of what was already taken from it must not depend on the slice.
  const T2 = T + 59_990;
  const level = (price: string, quantity: string) => ({ price, quantity });

  test('a second CLOSE sliced deeper from the SAME snapshot cannot buy the level the first CLOSE already took', () => {
    const opens = openInstructions(2); // 20 ZEC long
    const first: NativeInstruction = {
      id: 'close-one', kind: 'CLOSE', at: T2, positionId: 'position-zec-0', quantity: '1', price: '2000',
      book: { timestamp: T2, bids: [level('2000', '1')], asks: [] },
    };
    const second: NativeInstruction = {
      id: 'close-two', kind: 'CLOSE', at: T2 + 1, positionId: 'position-zec-0', quantity: '2', price: '2000',
      book: { timestamp: T2, bids: [level('2000', '1'), level('1999', '1')], asks: [] },
    };
    const state = replayNativeDemo({ deposit: '1000000', instructions: [...opens, first, second], bars: { ZECUSDT: [bar] }, asOf: T + 60_000 });
    const closes = state.events.filter((e) => e.kind === 'CLOSE');
    // 1 @ 2000 once, then only the 1 @ 1999 that was still untouched.
    expect(closes.map((e) => [e.quantity, e.price])).toEqual([['1', '2000'], ['1', '1999']]);
    expect(state.positions[0]).toMatchObject({ status: 'OPEN', quantity: '18' });
  });

  test('a market OPEN and a CLOSE on the same snapshot share one ledger', () => {
    const opens = openInstructions(2);
    const shortOpen: NativeInstruction = {
      id: 'open-short', kind: 'OPEN', at: T2, mark: '2000', last: '2000', instrument,
      order: { id: 'position-short', symbol: 'ZECUSDT', side: 'SHORT', type: 'MARKET', quantity: '1', leverage: '10', marginType: 'CROSS' },
      book: { timestamp: T2, bids: [level('2000', '1')], asks: [] },
    };
    const close: NativeInstruction = {
      id: 'close-long', kind: 'CLOSE', at: T2 + 1, positionId: 'position-zec-0', quantity: '2', price: '2000',
      book: { timestamp: T2, bids: [level('2000', '1'), level('1999', '1')], asks: [] },
    };
    const state = replayNativeDemo({ deposit: '1000000', instructions: [...opens, shortOpen, close], bars: { ZECUSDT: [bar] }, asOf: T + 60_000 });
    expect(state.events.filter((e) => e.kind === 'OPEN' && e.positionId === 'position-short').map((e) => [e.quantity, e.price])).toEqual([['1', '2000']]);
    expect(state.events.filter((e) => e.kind === 'CLOSE').map((e) => [e.quantity, e.price])).toEqual([['1', '1999']]);
  });

  test('two slices that disagree about a level cannot be one snapshot', () => {
    const opens = openInstructions(2);
    const first: NativeInstruction = {
      id: 'close-a', kind: 'CLOSE', at: T2, positionId: 'position-zec-0', quantity: '1', price: '2000',
      book: { timestamp: T2, bids: [level('2000', '1')], asks: [] },
    };
    const second: NativeInstruction = {
      id: 'close-b', kind: 'CLOSE', at: T2 + 1, positionId: 'position-zec-0', quantity: '1', price: '2000',
      book: { timestamp: T2, bids: [level('2000', '5')], asks: [] },
    };
    expect(() => replayNativeDemo({ deposit: '1000000', instructions: [...opens, first, second], bars: { ZECUSDT: [bar] }, asOf: T + 60_000 }))
      .toThrow('INCONSISTENT_BOOK');
  });

  test('a NEW provider snapshot is new liquidity', () => {
    const opens = openInstructions(2);
    const first: NativeInstruction = {
      id: 'close-c', kind: 'CLOSE', at: T2, positionId: 'position-zec-0', quantity: '1', price: '2000',
      book: { timestamp: T2, bids: [level('2000', '1')], asks: [] },
    };
    const second: NativeInstruction = {
      id: 'close-d', kind: 'CLOSE', at: T2 + 2, positionId: 'position-zec-0', quantity: '1', price: '2000',
      book: { timestamp: T2 + 2, bids: [level('2000', '1')], asks: [] },
    };
    const state = replayNativeDemo({ deposit: '1000000', instructions: [...opens, first, second], bars: { ZECUSDT: [bar] }, asOf: T + 60_000 });
    expect(state.events.filter((e) => e.kind === 'CLOSE')).toHaveLength(2);
    expect(state.positions[0]).toMatchObject({ quantity: '18' });
  });
});
