import BigNumber from 'bignumber.js';
import { amount, decimal, linearPnl, selectRiskTier, validateContractOrder, validateProfile, weightedEntry, consumeBook } from '../math';
import type { ContractRules, ModelProfile, Side } from '../types';

const D = BigNumber.clone({ DECIMAL_PLACES: 36, ROUNDING_MODE: BigNumber.ROUND_HALF_EVEN, EXPONENTIAL_AT: 100 });
const n = (x: string) => decimal(x);
const out = (x: BigNumber) => amount(x);
const positive = (x: string) => decimal(x, 'amount', true);
const active = (o: DemoOrder) => o.status === 'OPEN' || o.status === 'PARTIALLY_FILLED';
export type DemoMarginType = 'CROSS' | 'ISOLATED';
/** Stored states written before margin mode existed are all Cross. */
export const DEFAULT_MARGIN_TYPE: DemoMarginType = 'CROSS';
export const DEMO_STATE_VERSION = 2;
export const NATIVE_DEMO_MODEL = Object.freeze({
  version: 'VOLTEX_NATIVE_MARGIN_V3',
  /** Both are real here: see `demoAccount` for the split and `positionRisk` for the per-bucket tier. */
  marginModes: Object.freeze(['CROSS', 'ISOLATED'] as const),
  settlementAsset: 'USDT',
  /** Owner-set custom demo cash-flow per 8h UTC settlement (signed fraction of position value). NOT provider funding. */
  funding: Object.freeze({ longCashflow: '-0.001', shortCashflow: '0.004', unit: 'FRACTION', intervalMs: 28_800_000 }),
  fundingSource: 'CUSTOM_DEMO_MODEL',
  historicalPath: 'OPEN_LOW_HIGH_CLOSE', simulated: true,
  historicalLimit: 'BUY_IF_LOW_LTE_LIMIT_SELL_IF_HIGH_GTE_LIMIT',
  /** Assumed candle path resolution by age at calculation time: ≤7d 1m, ≤45d 15m, older 1h. */
  historyResolution: Object.freeze(['1m<=7d', '15m<=45d', '1h']),
  /** Cross is answered on the shared account; Isolated is answered on the position's own posted margin. */
  liquidation: 'CROSS_ACCOUNT_EQUITY_LTE_MAINTENANCE | ISOLATED_POSITION_MARGIN_PLUS_PNL_LTE_MAINTENANCE',
});
export class DemoEngineError extends Error { constructor(public code: string) { super(code); } }
export interface DemoInstrument { rules: ContractRules; profile: ModelProfile }
export interface DemoProtection { takeProfit: string | null; stopLoss: string | null; triggerBy: 'MARK' | 'LAST'; quantity: string | null }
export interface DemoOrder {
  id: string; symbol: string; side: Side; type: 'MARKET' | 'LIMIT'; quantity: string; remaining: string;
  filled: string; averagePrice: string | null; price: string | null; leverage: string; reserved: string;
  status: 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED'; createdAt: number;
  positionId: string | null; reduceOnly: boolean; protection: DemoProtection; historical: boolean;
  /** Which risk bucket this order fills into. An order never crosses buckets. */
  marginType: DemoMarginType;
}
export interface DemoPosition {
  id: string; symbol: string; side: Side; quantity: string; entryPrice: string; leverage: string;
  status: 'OPEN' | 'CLOSED' | 'LIQUIDATED'; openedAt: number; closedAt: number | null;
  markPrice: string; lastPrice: string; entryNotional: string; realizedGross: string;
  openingFees: string; closingFees: string; fundingNet: string; roiBasis: string; closedRoiBasis: string;
  protection: DemoProtection; historical: boolean; lastFundingAt: number;
  marginType: DemoMarginType;
  /**
   * ISOLATED only: margin actually MOVED OUT of `walletBalance` and posted
   * against this position. It is what the position can lose and all it can
   * lose. Always '0' on a CROSS position, which is backed by the account.
   */
  isolatedMargin: string;
}
export interface DemoEvent {
  id: string; kind: 'OPEN' | 'CLOSE' | 'TAKE_PROFIT' | 'STOP_LOSS' | 'LIQUIDATION' | 'FUNDING' | 'CANCEL' | 'LEVERAGE' | 'PROTECTION';
  time: number; positionId: string | null; orderId: string | null; symbol: string;
  quantity: string; price: string | null; fee: string; cashflow: string;
  pricing: 'OBSERVED_BOOK' | 'LIVE_QUOTE_MODEL' | 'SELECTED_POINT' | 'OHLC_PATH_MODEL' | 'MARK_SETTLEMENT' | 'COMMAND';
}
export interface BookConsumption {
  /** Legacy field kept for states persisted before the identity change; unused. */
  fingerprint: string;
  bids: Record<string, string>; asks: Record<string, string>;
  seen?: { bids: Record<string, string>; asks: Record<string, string> };
}
export interface ObservedBook { bids: { price: string; quantity: string }[]; asks: { price: string; quantity: string }[]; timestamp: number }
/** How long an observed snapshot may be consumed against, and how long its ledger is kept. */
export const OBSERVED_BOOK_MAX_AGE_MS = 5000;
/**
 * THE IDENTITY OF AN OBSERVED BOOK IS THE PROVIDER SNAPSHOT, NOT THE SLICE.
 *
 * Every command stores only the depth it needed (`truncateBook`), so the
 * same provider snapshot reaches the engine as different arrays: a close of
 * 1 keeps `[1 @ 100]`, the next close of 2 keeps `[1 @ 100, 1 @ 99]`. Keying
 * the consumption ledger by a hash of those arrays gave each slice its own
 * ledger, and the second command bought the `1 @ 100` the first had already
 * taken. The key is therefore `symbol:bookGeneratedAt` — the provider's own
 * snapshot time — and OPEN and CLOSE share it. A level that two slices
 * report with different quantities cannot come from one snapshot and is
 * refused as INCONSISTENT_BOOK. A new provider timestamp is a new snapshot
 * and new liquidity: that is the versioned replenishment rule of this model.
 */
export function bookConsumptionKey(symbol: string, book: { timestamp: number }) { return `${symbol}:${book.timestamp}`; }
export function consumeObservedBook(s: DemoState, symbol: string, book: ObservedBook, direction: 'BUY' | 'SELL', quantity: string, time: number, limitPrice?: string) {
  if (time < book.timestamp || time - book.timestamp > OBSERVED_BOOK_MAX_AGE_MS) throw new DemoEngineError('STALE_BOOK');
  const key = bookConsumptionKey(symbol, book);
  const used: BookConsumption = s.bookConsumption[key] ??= { fingerprint: key, bids: {}, asks: {} };
  used.seen ??= { bids: {}, asks: {} };
  for (const side of ['bids', 'asks'] as const) {
    for (const level of book[side]) {
      const price = out(n(level.price)), observed = out(positive(level.quantity));
      const before = used.seen[side][price];
      if (before !== undefined && before !== observed) throw new DemoEngineError('INCONSISTENT_BOOK');
      used.seen[side][price] = observed;
    }
  }
  const levels = (side: 'bids' | 'asks') => book[side]
    .map(x => ({ price: x.price, quantity: out(D.maximum(0, n(x.quantity).minus(used[side][out(n(x.price))] ?? '0'))) }))
    .filter(x => n(x.quantity).gt(0));
  const result = consumeBook(direction, quantity, { bids: levels('bids'), asks: levels('asks') }, limitPrice);
  const side = direction === 'BUY' ? 'asks' : 'bids';
  const record = (fill: { price: string; quantity: string }) => { const p = out(n(fill.price)); used[side][p] = out(n(used[side][p] ?? '0').plus(fill.quantity)); };
  const prune = () => { for (const k of Object.keys(s.bookConsumption)) if (Number(k.split(':')[1]) < time - OBSERVED_BOOK_MAX_AGE_MS) delete s.bookConsumption[k]; };
  return { fills: result.fills, record, prune };
}
export interface DemoState {
  version: 2; walletBalance: string; initialDeposit: string; positions: DemoPosition[];
  orders: DemoOrder[]; events: DemoEvent[]; instruments: Record<string, DemoInstrument>;
  marks: Record<string, { mark: string; last: string; time: number }>;
  applied: Record<string, string>;
  /**
   * Observed liquidity already consumed from a provider snapshot, keyed by
   * the SOURCE snapshot identity (`symbol:bookGeneratedAt`) — never by the
   * levels a command happened to keep. `bids`/`asks` are quantity consumed
   * per price; `seen` is the quantity each price level was OBSERVED to hold,
   * so two slices of one snapshot that disagree about a level are refused.
   */
  bookConsumption: Record<string, BookConsumption>;
  time: number; nextEvent: number;
}
export interface DemoOrderInput {
  id: string; symbol: string; side: Side; type: 'MARKET' | 'LIMIT'; quantity: string; leverage: string;
  price?: string; reduceOnly?: boolean; positionId?: string; protection?: Partial<DemoProtection>; historical?: boolean;
  /** Omitted on instructions journaled before margin mode existed; those are Cross. */
  marginType?: DemoMarginType;
}
export const noProtection = (): DemoProtection => ({ takeProfit: null, stopLoss: null, triggerBy: 'MARK', quantity: null });
export function emptyDemoState(balance: string, time: number): DemoState {
  if (n(balance).lt(0) || !Number.isSafeInteger(time) || time < 0) throw new DemoEngineError('INVALID_INITIAL_STATE');
  return { version: DEMO_STATE_VERSION, walletBalance: out(n(balance)), initialDeposit: out(n(balance)), positions: [], orders: [], events: [],
    instruments: {}, marks: {}, applied: {}, bookConsumption: {}, time, nextEvent: 1 };
}
/**
 * READ A STORED STATE FORWARD.
 *
 * Version 1 predates margin mode. Every position and order it holds was
 * opened under the only model that existed, so it is Cross with no posted
 * margin — that is a fact about those rows, not a default chosen for
 * convenience, and it keeps `walletBalance` meaning exactly what it meant
 * when the row was written. Called on every read of a persisted snapshot
 * and of a replay checkpoint; already-current states pass through
 * unchanged.
 */
export type StoredDemoState = Omit<DemoState,'version'|'positions'|'orders'> & {
  version: number;
  positions: (Omit<DemoPosition,'marginType'|'isolatedMargin'> & Partial<Pick<DemoPosition,'marginType'|'isolatedMargin'>>)[];
  orders: (Omit<DemoOrder,'marginType'> & Partial<Pick<DemoOrder,'marginType'>>)[];
};
export function migrateDemoState(state: StoredDemoState | DemoState): DemoState {
  if (state.version === DEMO_STATE_VERSION) return state as DemoState;
  const stored = state as StoredDemoState;
  return {
    ...stored,
    version: DEMO_STATE_VERSION,
    positions: stored.positions.map((p) => ({
      ...p,
      marginType: p.marginType ?? DEFAULT_MARGIN_TYPE,
      isolatedMargin: p.isolatedMargin ?? '0',
    })),
    orders: stored.orders.map((o) => ({ ...o, marginType: o.marginType ?? DEFAULT_MARGIN_TYPE })),
  };
}
function requireTime(s: DemoState, time: number) {
  if (!Number.isSafeInteger(time) || time < s.time) throw new DemoEngineError('NON_CHRONOLOGICAL_EVENT');
}
function emit(s: DemoState, e: Omit<DemoEvent, 'id'>) { s.events.push({ ...e, id: `e${s.nextEvent++}` }); }
function instrument(s: DemoState, symbol: string): DemoInstrument {
  const value = s.instruments[symbol]; if (!value) throw new DemoEngineError('INSTRUMENT_MISSING'); return value;
}
export function registerDemoInstrument(s: DemoState, i: DemoInstrument) {
  validateProfile(i.profile); s.instruments[i.rules.symbol] = structuredClone(i);
}
function exposure(s: DemoState, symbol: string, mark: string, marginType: DemoMarginType) {
  // Exposure is read PER BUCKET: an isolated position is its own risk book,
  // so a cross tier must not be widened by it and vice versa.
  return s.positions.filter(p => p.status === 'OPEN' && p.symbol === symbol && p.marginType === marginType).reduce((v,p) => v.plus(n(p.quantity).times(mark)), new D(0))
    .plus(s.orders.filter(o => active(o) && !o.reduceOnly && o.symbol === symbol && o.marginType === marginType).reduce((v,o) => v.plus(n(o.remaining).times(D.maximum(mark,o.price ?? mark))), new D(0)));
}
/**
 * ONE POSITION'S OWN RISK, at a mark this caller chooses.
 *
 * The tier is selected on the notional of the bucket this position belongs
 * to — for CROSS that is every cross position on the contract sharing the
 * account, for ISOLATED it is this position alone, because that is the
 * whole point of isolating it. The continuous tier deduction is then
 * allocated across the bucket in proportion to notional, exactly as it was
 * before; an isolated bucket of one simply receives all of it.
 *
 * `mark` is a parameter rather than `p.markPrice` so the liquidation search
 * can ask "what would this position's requirement be at that price" without
 * mutating anything.
 */
export function positionRisk(s: DemoState, p: DemoPosition, mark: string) {
  const profile = instrument(s,p.symbol).profile, value = n(p.quantity).times(mark);
  const bucket = s.positions.filter(x => x.status === 'OPEN' && x.symbol === p.symbol && x.marginType === p.marginType);
  const total = bucket.reduce((v,x) => v.plus(n(x.quantity).times(mark)), new D(0));
  const tier = selectRiskTier(out(total), profile);
  const deduction = total.gt(0) ? n(tier.deduction).times(value).div(total) : new D(0);
  return {
    value,
    maintenance: D.maximum(0,value.times(tier.maintenanceRate).minus(deduction)).plus(value.times(profile.takerFeeRate)),
    initial: value.div(p.leverage).plus(value.times(profile.takerFeeRate)),
    unrealized: new D(linearPnl(p.side,p.quantity,p.entryPrice,mark)),
  };
}
/** An ISOLATED position stands on its posted margin alone: this is what is left of it. */
export function isolatedHealth(s: DemoState, p: DemoPosition, mark: string) {
  const risk = positionRisk(s,p,mark);
  return n(p.isolatedMargin).plus(risk.unrealized).minus(risk.maintenance);
}
export const isolatedLiquidatable = (s: DemoState, p: DemoPosition) =>
  p.marginType === 'ISOLATED' && p.status === 'OPEN' && isolatedHealth(s,p,p.markPrice).lte(0);
/**
 * WHAT AN ISOLATED LIQUIDATION MAY COST: the posted margin, and not one
 * unit more.
 *
 * The bankruptcy price is where this position's own P&L has consumed
 * exactly what was posted against it. Between two observed marks the price
 * can GAP straight through it — a jump from 50 000 to 30 000 is one tick as
 * far as this engine is concerned — and settling such a position at the
 * far mark would bill the shared account for a loss the trader explicitly
 * ring-fenced. It would also make the mode a label: the account would be
 * backing the position after all, just later.
 *
 * So an isolated liquidation settles at the bankruptcy price when the
 * observed price is beyond it. The post is consumed, the account is square,
 * and the shortfall the venue would have absorbed is not invented as the
 * owner's loss. A price that has NOT reached bankruptcy settles where it
 * actually is, so an ordinary liquidation still realises its real P&L.
 */
export function isolatedBankruptcyBound(p: DemoPosition): string {
  const bankruptcy = n(p.quantity).gt(0)
    ? (p.side === 'LONG'
        ? n(p.entryPrice).minus(n(p.isolatedMargin).div(p.quantity))
        : n(p.entryPrice).plus(n(p.isolatedMargin).div(p.quantity)))
    : n(p.entryPrice);
  const floored = D.maximum(0, bankruptcy);
  return out(p.side === 'LONG' ? D.maximum(p.lastPrice, floored) : D.minimum(p.lastPrice, floored));
}
/**
 * THE SHARED ACCOUNT — and what has been taken out of it.
 *
 * Cross positions are backed by one pool of collateral, so their margin,
 * their maintenance requirement and their P&L all land on the account.
 *
 * An isolated position is NOT backed by that pool. Its margin was moved out
 * of `walletBalance` when it filled, so the account can neither spend it
 * nor be liquidated for it: its requirement is absent from `usedMargin` and
 * `maintenanceMargin`, and its P&L is absent from `equity`. That is the
 * whole difference between the two modes, and it is made here once.
 *
 * `isolatedMargin` and `isolatedUnrealizedPnl` are reported separately so
 * the Wallet can still show the owner everything they own without the
 * terminal having to add anything up itself.
 */
export function demoAccount(s: DemoState) {
  let upl = new D(0), mm = new D(0), im = new D(0), reserve = new D(0);
  let isolatedMargin = new D(0), isolatedUpl = new D(0), isolatedMaintenance = new D(0);
  for (const p of s.positions.filter(p => p.status === 'OPEN')) {
    const mark = s.marks[p.symbol]?.mark; if (!mark) throw new DemoEngineError('MARK_MISSING');
    const risk = positionRisk(s,p,mark);
    if (p.marginType === 'ISOLATED') {
      isolatedMargin = isolatedMargin.plus(p.isolatedMargin);
      isolatedUpl = isolatedUpl.plus(risk.unrealized);
      isolatedMaintenance = isolatedMaintenance.plus(risk.maintenance);
      continue;
    }
    mm = mm.plus(risk.maintenance);
    im = im.plus(risk.initial);
    upl = upl.plus(risk.unrealized);
  }
  for (const o of s.orders.filter(active)) reserve = reserve.plus(o.reserved);
  const equity = n(s.walletBalance).plus(upl);
  return { walletBalance: s.walletBalance, initialDeposit: s.initialDeposit, unrealizedPnl: out(upl), equity: out(equity),
    usedMargin: out(im), orderReserve: out(reserve), available: out(D.maximum(0,equity.minus(im).minus(reserve))),
    maintenanceMargin: out(mm), maintenanceRatio: equity.gt(0) ? out(mm.div(equity)) : null,
    isolatedMargin: out(isolatedMargin), isolatedUnrealizedPnl: out(isolatedUpl), isolatedMaintenanceMargin: out(isolatedMaintenance),
    // Only CROSS positions can be liquidated by the account. An isolated
    // one answers for itself, so it must not make this true.
    liquidatable: s.positions.some(p => p.status === 'OPEN' && p.marginType === 'CROSS') && equity.lte(mm),
    deficit: out(D.maximum(0,n(s.walletBalance).negated())) };
}
export function demoPositionView(s: DemoState,p: DemoPosition) {
  const unrealized = p.status === 'OPEN' ? linearPnl(p.side,p.quantity,p.entryPrice,p.markPrice) : '0';
  const realized = out(n(p.realizedGross).minus(p.openingFees).minus(p.closingFees).plus(p.fundingNet));
  const net = out(n(unrealized).plus(realized));
  return { ...p, unrealizedPnl: unrealized, realizedPnl: realized, netPnl: net,
    roiPercent: n(p.status==='OPEN'?p.roiBasis:p.closedRoiBasis).gt(0) ? out(n(p.status==='OPEN'?unrealized:net).div(p.status==='OPEN'?p.roiBasis:p.closedRoiBasis).times(100)) : null,
    liquidationPrice: p.status === 'OPEN' ? estimateDemoLiquidationPrice(s,p.id) : null,
    // The basis is named, because the two are not the same number: one is
    // answered against the whole account, the other against this position's
    // own posted margin.
    liquidationStatus: (p.marginType === 'ISOLATED' ? 'ISOLATED_POSITION_ESTIMATE' : 'ACCOUNT_CROSS_ESTIMATE') as 'ISOLATED_POSITION_ESTIMATE' | 'ACCOUNT_CROSS_ESTIMATE',
    marginMode: p.marginType };
}
function validateProtection(s: DemoState, p: {symbol:string;side:Side;quantity:string}, protection: DemoProtection, price: string) {
  if (!['MARK','LAST'].includes(protection.triggerBy)) throw new DemoEngineError('INVALID_TRIGGER_SOURCE');
  const r = instrument(s,p.symbol).rules;
  for (const [kind,v] of [['TP',protection.takeProfit],['SL',protection.stopLoss]] as const) {
    if (v === null) continue;
    if (!positive(v).mod(r.tickSize).isZero()) throw new DemoEngineError('INVALID_TRIGGER_STEP');
    const above = p.side === 'LONG' ? kind === 'TP' : kind === 'SL';
    if (above ? n(v).lte(price) : n(v).gte(price)) throw new DemoEngineError('INVALID_TRIGGER_PRICE');
  }
  if (protection.quantity !== null && (!positive(protection.quantity).mod(r.qtyStep).isZero() || n(protection.quantity).gt(p.quantity))) throw new DemoEngineError('INVALID_PROTECTION_QUANTITY');
}
function getPosition(s: DemoState,id: string): DemoPosition {
  const p = s.positions.find(p => p.id === id && p.status === 'OPEN'); if (!p) throw new DemoEngineError('POSITION_NOT_OPEN'); return p;
}
function reserveFor(s: DemoState,o: DemoOrder,price: string) {
  const profile = instrument(s,o.symbol).profile;
  return o.reduceOnly ? '0' : out(n(o.remaining).times(price).times(new D(1).div(o.leverage).plus(n(profile.takerFeeRate).times(2))));
}
export function placeDemoOrder(s: DemoState,input: DemoOrderInput,time: number) {
  const fingerprint = JSON.stringify(input);
  if (s.applied[input.id]) { if (s.applied[input.id] !== fingerprint) throw new DemoEngineError('IDEMPOTENCY_CONFLICT'); return s.orders.find(o => o.id === input.id)!; }
  requireTime(s,time);
  if (!input.id || !['LONG','SHORT'].includes(input.side) || !['MARKET','LIMIT'].includes(input.type)) throw new DemoEngineError('INVALID_ORDER');
  const rules = instrument(s,input.symbol), quote = s.marks[input.symbol]; if (!quote) throw new DemoEngineError('MARK_MISSING');
  const price = input.type === 'LIMIT' ? input.price : quote.last;
  if (!price) throw new DemoEngineError('LIMIT_PRICE_REQUIRED');
  validateContractOrder({rules:rules.rules, profile:rules.profile, quantity:input.quantity,price,leverage:input.leverage,market:input.type==='MARKET'});
  if (input.reduceOnly) {
    if (!input.positionId) throw new DemoEngineError('POSITION_ID_REQUIRED');
    const p=getPosition(s,input.positionId);
    if (p.symbol!==input.symbol || p.side===input.side) throw new DemoEngineError('INVALID_REDUCE_SIDE');
    // Closing quantity belongs to ONE bucket. A cross order cannot release
    // margin posted against an isolated position, or the isolation is a label.
    if (p.marginType!==(input.marginType??DEFAULT_MARGIN_TYPE)) throw new DemoEngineError('MARGIN_TYPE_MISMATCH');
    if (n(input.quantity).gt(p.quantity)) throw new DemoEngineError('CLOSE_EXCEEDS_POSITION');
  }
  const marginType=input.marginType??DEFAULT_MARGIN_TYPE;
  if(!['CROSS','ISOLATED'].includes(marginType))throw new DemoEngineError('INVALID_MARGIN_TYPE');
  const protection = {...noProtection(),...input.protection};
  if (input.reduceOnly && (protection.takeProfit!==null || protection.stopLoss!==null)) throw new DemoEngineError('REDUCE_ORDER_PROTECTION');
  validateProtection(s,{...input,quantity:input.quantity},protection,price);
  const o:DemoOrder = {...input, marginType, reduceOnly:!!input.reduceOnly, historical:!!input.historical, price:input.type==='LIMIT'?price:null,
    remaining:input.quantity, filled:'0', averagePrice:null, reserved:'0', status:'OPEN', createdAt:time, positionId:input.positionId??null,protection};
  o.reserved=reserveFor(s,o,price);
  // Margin for an isolated position is still FUNDED from the shared wallet —
  // what isolation changes is that once posted it stops backing anything
  // else. So the affordability question at placement is the same one.
  if (!o.reduceOnly && (demoAccount(s).liquidatable || n(o.reserved).gt(demoAccount(s).available))) throw new DemoEngineError('INSUFFICIENT_DEMO_MARGIN');
  const tier=selectRiskTier(out(exposure(s,o.symbol,quote.mark,marginType).plus(o.reduceOnly?'0':n(o.quantity).times(D.maximum(price,quote.mark)))),rules.profile);
  if (tier.maxLeverage && n(o.leverage).gt(tier.maxLeverage)) throw new DemoEngineError('TIER_LEVERAGE_EXCEEDED');
  s.orders.push(o);s.applied[input.id]=fingerprint;s.time=time;return o;
}
function settleClose(s: DemoState,p:DemoPosition,quantity:string,price:string,time:number,kind:DemoEvent['kind'],pricing:DemoEvent['pricing'],orderId:string|null,maker=false) {
  const qty=positive(quantity);if(qty.gt(p.quantity))throw new DemoEngineError('CLOSE_EXCEEDS_POSITION');
  const profile=instrument(s,p.symbol).profile,fee=qty.times(price).times(maker?profile.makerFeeRate:profile.takerFeeRate);
  const gross=n(linearPnl(p.side,quantity,p.entryPrice,price));
  s.walletBalance=out(n(s.walletBalance).plus(gross).minus(fee));
  p.realizedGross=out(n(p.realizedGross).plus(gross));p.closingFees=out(n(p.closingFees).plus(fee));
  const releasedBasis=n(p.roiBasis).times(qty).div(p.quantity);
  p.roiBasis=out(n(p.roiBasis).minus(releasedBasis));p.closedRoiBasis=out(n(p.closedRoiBasis).plus(releasedBasis));
  // The isolated post comes home in the same proportion as the quantity
  // that is leaving. On a liquidation the loss debited just above has
  // already consumed most of it, which is exactly why an isolated position
  // cannot cost the account more than it posted.
  if(p.marginType==='ISOLATED'){
    const releasedMargin=n(p.isolatedMargin).times(qty).div(p.quantity);
    p.isolatedMargin=out(n(p.isolatedMargin).minus(releasedMargin));
    s.walletBalance=out(n(s.walletBalance).plus(releasedMargin));
  }
  p.quantity=out(n(p.quantity).minus(qty));p.markPrice=price;p.lastPrice=price;
  emit(s,{kind,time,positionId:p.id,orderId,symbol:p.symbol,quantity,price,fee:out(fee),cashflow:out(gross.minus(fee)),pricing});
  if(n(p.quantity).isZero()) {
    p.status=kind==='LIQUIDATION'?'LIQUIDATED':'CLOSED';p.closedAt=time;p.protection=noProtection();
    for(const o of s.orders.filter(o=>active(o)&&o.positionId===p.id&&o.id!==orderId))cancelDemoOrder(s,o.id,time);
  }else if(p.protection.quantity!==null && n(p.protection.quantity).gt(p.quantity))p.protection.quantity=p.quantity;
}
export function fillDemoOrder(s:DemoState,id:string,quantity:string,price:string,time:number,pricing:DemoEvent['pricing'],maker=false) {
  requireTime(s,time);const o=s.orders.find(o=>o.id===id);if(!o||!active(o))throw new DemoEngineError('ORDER_NOT_OPEN');
  if(positive(quantity).gt(o.remaining))throw new DemoEngineError('FILL_EXCEEDS_ORDER');positive(price);
  if(o.price && (o.side==='LONG'?n(price).gt(o.price):n(price).lt(o.price)))throw new DemoEngineError('FILL_OUTSIDE_LIMIT');
  if(o.reduceOnly) {
    const p=getPosition(s,o.positionId!);quantity=out(D.minimum(quantity,p.quantity));
    settleClose(s,p,quantity,price,time,'CLOSE',pricing,o.id,maker);
  } else {
    // Same symbol+direction increases one LIVE position, opposite direction remains a hedge.
    // Each historical test entry stays its own position (own entry marker, P&L and card).
    let p=o.historical?undefined:s.positions.find(p=>p.status==='OPEN'&&!p.historical&&p.symbol===o.symbol&&p.side===o.side&&p.marginType===o.marginType);
    if(o.historical)p=s.positions.find(p=>p.id===o.id&&p.status==='OPEN');
    if(p && p.leverage!==o.leverage)throw new DemoEngineError('SET_EXISTING_POSITION_LEVERAGE_FIRST');
    const prof=instrument(s,o.symbol).profile,fee=n(quantity).times(price).times(maker?prof.makerFeeRate:prof.takerFeeRate);
    const nextReserve=out(n(o.remaining).minus(quantity).times(o.price??price).times(new D(1).div(o.leverage).plus(n(prof.takerFeeRate).times(2))));
    const need=n(quantity).times(price).div(o.leverage).plus(fee).plus(n(quantity).times(price).times(prof.takerFeeRate));
    if(need.plus(nextReserve).gt(n(demoAccount(s).available).plus(o.reserved)))throw new DemoEngineError('INSUFFICIENT_FILL_MARGIN');
    if(!p) {
      p={id:o.id,symbol:o.symbol,side:o.side,quantity:'0',entryPrice:price,leverage:o.leverage,status:'OPEN',openedAt:time,closedAt:null,
        markPrice:s.marks[o.symbol].mark,lastPrice:s.marks[o.symbol].last,entryNotional:'0',realizedGross:'0',openingFees:'0',closingFees:'0',
        fundingNet:'0',roiBasis:'0',closedRoiBasis:'0',protection:structuredClone(o.protection),historical:o.historical,lastFundingAt:time,
        marginType:o.marginType,isolatedMargin:'0'};s.positions.push(p);
    }
    p.entryPrice=weightedEntry([{quantity:p.quantity,price:p.entryPrice},{quantity,price}].filter(x=>n(x.quantity).gt(0)));
    p.quantity=out(n(p.quantity).plus(quantity));p.entryNotional=out(n(p.entryNotional).plus(n(quantity).times(price)));
    p.roiBasis=out(n(p.roiBasis).plus(n(quantity).times(price).div(p.leverage)));
    p.openingFees=out(n(p.openingFees).plus(fee));s.walletBalance=out(n(s.walletBalance).minus(fee));o.positionId=p.id;
    // ISOLATION HAPPENS HERE. The margin for this fill LEAVES the shared
    // wallet and is posted against the position. After this line the
    // account cannot spend it, cannot be liquidated for it, and cannot use
    // it to hold up any other position — which is the only thing that
    // makes the mode real rather than a label on a row.
    if(p.marginType==='ISOLATED'){
      const posted=n(quantity).times(price).div(p.leverage);
      p.isolatedMargin=out(n(p.isolatedMargin).plus(posted));
      s.walletBalance=out(n(s.walletBalance).minus(posted));
    }
    emit(s,{kind:'OPEN',time,positionId:p.id,orderId:o.id,symbol:p.symbol,quantity,price,fee:out(fee),cashflow:out(fee.negated()),pricing});
  }
  o.averagePrice=weightedEntry([{quantity:o.filled,price:o.averagePrice??price},{quantity,price}].filter(x=>n(x.quantity).gt(0)));
  o.filled=out(n(o.filled).plus(quantity));o.remaining=out(n(o.remaining).minus(quantity));o.reserved=reserveFor(s,o,o.price??price);
  o.status=n(o.remaining).isZero()?'FILLED':'PARTIALLY_FILLED';s.time=time;
  if(o.reduceOnly&&active(o)&&!s.positions.some(p=>p.id===o.positionId&&p.status==='OPEN'))cancelDemoOrder(s,o.id,time);
}
export function cancelDemoOrder(s:DemoState,id:string,time:number) {
  requireTime(s,time);const o=s.orders.find(o=>o.id===id);if(!o)throw new DemoEngineError('ORDER_NOT_FOUND');if(!active(o))return;
  o.status='CANCELLED';o.reserved='0';s.time=time;emit(s,{kind:'CANCEL',time,positionId:o.positionId,orderId:id,symbol:o.symbol,quantity:o.remaining,price:null,fee:'0',cashflow:'0',pricing:'COMMAND'});
}
export function closeDemoPosition(s:DemoState,id:string,quantity:string|undefined,price:string,time:number,pricing:DemoEvent['pricing']='SELECTED_POINT') {
  requireTime(s,time);const p=getPosition(s,id),q=quantity??p.quantity;
  if(!positive(q).mod(instrument(s,p.symbol).rules.qtyStep).isZero())throw new DemoEngineError('INVALID_QUANTITY_STEP');
  settleClose(s,p,q,price,time,'CLOSE',pricing,null);s.time=time;
}
export function protectDemoPosition(s:DemoState,id:string,change:Partial<DemoProtection>,time:number) {
  requireTime(s,time);const p=getPosition(s,id),next={...p.protection,...change};
  validateProtection(s,p,next,next.triggerBy==='MARK'?p.markPrice:p.lastPrice);p.protection=next;s.time=time;
  emit(s,{kind:'PROTECTION',time,positionId:id,orderId:null,symbol:p.symbol,quantity:'0',price:null,fee:'0',cashflow:'0',pricing:'COMMAND'});
}
export function setDemoLeverage(s:DemoState,id:string,leverage:string,time:number) {
  requireTime(s,time);const p=getPosition(s,id),i=instrument(s,p.symbol);
  validateContractOrder({rules:i.rules,profile:i.profile,quantity:p.quantity,price:p.entryPrice,leverage,market:true});
  if(s.orders.some(o=>active(o)&&o.positionId===id))throw new DemoEngineError('CANCEL_ORDERS_BEFORE_LEVERAGE');
  const before=p.leverage,postedBefore=p.isolatedMargin,walletBefore=s.walletBalance;p.leverage=leverage;
  // An isolated position's posted margin IS its leverage. Re-sizing it to
  // the new requirement moves the difference to or from the wallet, so
  // lowering leverage funds the position and raising it releases cash —
  // rather than leaving a post that no longer means anything.
  if(p.marginType==='ISOLATED'){
    const required=n(p.quantity).times(p.entryPrice).div(leverage);
    const delta=required.minus(p.isolatedMargin);
    p.isolatedMargin=out(required);s.walletBalance=out(n(s.walletBalance).minus(delta));
  }
  const a=demoAccount(s);
  const short=n(a.equity).lt(n(a.usedMargin).plus(a.orderReserve))||n(s.walletBalance).lt(0)||isolatedLiquidatable(s,p);
  if(short){p.leverage=before;p.isolatedMargin=postedBefore;s.walletBalance=walletBefore;throw new DemoEngineError('INSUFFICIENT_DEMO_MARGIN');}
  // Leverage changes margin requirements, NEVER quantity, entry or absolute P&L.
  p.roiBasis=out(n(p.quantity).times(p.entryPrice).div(leverage));s.time=time;
  emit(s,{kind:'LEVERAGE',time,positionId:id,orderId:null,symbol:p.symbol,quantity:'0',price:null,fee:'0',cashflow:'0',pricing:'COMMAND'});
}
export function markDemoAccount(s:DemoState,marks:Record<string,{mark:string;last:string}>,time:number) {
  requireTime(s,time);for(const[symbol,v]of Object.entries(marks)){positive(v.mark);positive(v.last);s.marks[symbol]={...v,time};}
  for(const p of s.positions.filter(p=>p.status==='OPEN')){const v=s.marks[p.symbol];if(!v)throw new DemoEngineError('MARK_MISSING');p.markPrice=v.mark;p.lastPrice=v.last;}
  s.time=time;
}
export function settleDemoFunding(s:DemoState,time:number) {
  requireTime(s,time);if(time%NATIVE_DEMO_MODEL.funding.intervalMs!==0)throw new DemoEngineError('NOT_FUNDING_BOUNDARY');
  for(const p of s.positions.filter(p=>p.status==='OPEN'&&p.openedAt<time&&p.lastFundingAt<time)){
    if(s.marks[p.symbol]?.time!==time)throw new DemoEngineError('FUNDING_MARK_NOT_AT_SETTLEMENT');
    const rate=p.side==='LONG'?NATIVE_DEMO_MODEL.funding.longCashflow:NATIVE_DEMO_MODEL.funding.shortCashflow;
    const flow=n(p.quantity).times(p.markPrice).times(rate);
    if(p.marginType==='ISOLATED'){
      // Into and out of the post, so funding can actually walk an isolated
      // position into liquidation instead of silently draining the account
      // that is supposed to be shielded from it. A flow larger than what is
      // posted cannot leave a negative post: the remainder falls to the
      // account, which is the only place left for it, and the next risk
      // pass closes the position.
      const next=n(p.isolatedMargin).plus(flow);
      p.isolatedMargin=out(D.maximum(0,next));
      if(next.lt(0))s.walletBalance=out(n(s.walletBalance).plus(next));
    } else s.walletBalance=out(n(s.walletBalance).plus(flow));
    p.fundingNet=out(n(p.fundingNet).plus(flow));p.lastFundingAt=time;
    emit(s,{kind:'FUNDING',time,positionId:p.id,orderId:null,symbol:p.symbol,quantity:p.quantity,price:p.markPrice,fee:'0',cashflow:out(flow),pricing:'MARK_SETTLEMENT'});
  }s.time=time;
}
export function evaluateDemoRiskAndProtection(s:DemoState,time:number,pricing:DemoEvent['pricing']='OHLC_PATH_MODEL') {
  requireTime(s,time);
  // Isolated first, and one at a time: a position whose own post is gone is
  // closed on its own, and the rest of the account — including every other
  // isolated position — is untouched by it.
  for(const p of s.positions.filter(p=>p.status==='OPEN'&&p.marginType==='ISOLATED')){
    if(!isolatedLiquidatable(s,p))continue;
    for(const o of s.orders.filter(o=>active(o)&&o.positionId===p.id))cancelDemoOrder(s,o.id,time);
    settleClose(s,p,p.quantity,isolatedBankruptcyBound(p),time,'LIQUIDATION',pricing,null);
  }
  if(demoAccount(s).liquidatable){
    for(const o of s.orders.filter(o=>active(o)&&o.marginType==='CROSS'))cancelDemoOrder(s,o.id,time);
    // Only the shared book is swept. An isolated position is not collateral
    // for the account and is not seized to save it.
    for(const p of s.positions.filter(p=>p.status==='OPEN'&&p.marginType==='CROSS'))settleClose(s,p,p.quantity,p.lastPrice,time,'LIQUIDATION',pricing,null);
  }
  for(const p of s.positions.filter(p=>p.status==='OPEN')) {
    const v=n(p.protection.triggerBy==='MARK'?p.markPrice:p.lastPrice),{takeProfit:tp,stopLoss:sl}=p.protection;
    const stop=sl!==null&&(p.side==='LONG'?v.lte(sl):v.gte(sl));
    const profit=tp!==null&&(p.side==='LONG'?v.gte(tp):v.lte(tp));
    if(stop||profit){const q=p.protection.quantity??p.quantity;settleClose(s,p,q,p.lastPrice,time,stop?'STOP_LOSS':'TAKE_PROFIT',pricing,null);p.protection=noProtection();}
  }s.time=time;
}
/** Observable depth is consumed only inside this private state; NEVER written to any public book. */
export function executeDemoBook(s:DemoState,id:string,book:ObservedBook,time:number){
  const o=s.orders.find(o=>o.id===id);if(!o||!active(o))throw new DemoEngineError('ORDER_NOT_OPEN');
  const direction=o.side==='LONG'?'BUY':'SELL';
  const consumed=consumeObservedBook(s,o.symbol,book,direction,o.remaining,time,o.price??undefined);
  for(const f of consumed.fills){fillDemoOrder(s,id,f.quantity,f.price,time,'OBSERVED_BOOK');consumed.record(f);}
  if(o.type==='MARKET'&&active(o))cancelDemoOrder(s,id,time);
  consumed.prune();
}
/**
 * THE LIQUIDATION REFERENCE FOR ONE POSITION — on the basis that actually applies to it.
 *
 * CROSS: the Mark price of ITS contract at which the whole account reaches equity <= maintenance,
 * with every other contract frozen at its current Mark. Same-contract cross hedges move together.
 * null = the shared collateral keeps the account solvent for every price in the adverse direction
 * (or the contract is fully hedged).
 *
 * ISOLATED: the Mark at which THIS position's posted margin plus its own P&L reaches its own
 * maintenance requirement. The rest of the account is not consulted, because it is not backing
 * this position — so an isolated liquidation price is nearer than a cross one on the same account,
 * and it moves when the post moves rather than when the account does. Other isolated positions on
 * the same contract are held still: each stands on its own money.
 */
export function estimateDemoLiquidationPrice(s:DemoState,positionId:string):string|null{
  const p=s.positions.find(x=>x.id===positionId&&x.status==='OPEN');if(!p)return null;
  const current=s.marks[p.symbol];if(!current)return null;
  const isolated=p.marginType==='ISOLATED';
  // The direction the search walks. Cross nets same-contract hedges because
  // they share the collateral; an isolated position is alone by definition.
  const same=s.positions.filter(x=>x.status==='OPEN'&&x.symbol===p.symbol&&x.marginType==='CROSS');
  const net=isolated
    ? (p.side==='LONG'?new D(p.quantity):new D(p.quantity).negated())
    : same.reduce((v,x)=>x.side==='LONG'?v.plus(x.quantity):v.minus(x.quantity),new D(0));
  if(net.isZero())return null;
  const health=(price:BigNumber)=>{
    const mark=out(price),probe:DemoState={...s,positions:s.positions.map(x=>x.status==='OPEN'&&x.symbol===p.symbol?{...x,markPrice:mark}:x),marks:{...s.marks,[p.symbol]:{...current,mark}}};
    if(isolated)return isolatedHealth(probe,probe.positions.find(x=>x.id===p.id)!,mark);
    const a=demoAccount(probe);return n(a.equity).minus(a.maintenanceMargin);
  };
  const m0=n(current.mark);if(health(m0).lte(0))return current.mark;
  const tick=n(instrument(s,p.symbol).rules.tickSize);
  let lo:BigNumber,hi:BigNumber;
  if(net.gt(0)){
    lo=tick;hi=m0;if(health(lo).gt(0))return null;
  }else{
    lo=m0;hi=m0.times(2);let i=0;
    while(health(hi).gt(0)){if(++i>60)return null;hi=hi.times(2);}
  }
  for(let i=0;i<200&&hi.minus(lo).gt(tick.div(100));i++){
    const mid=lo.plus(hi).div(2),h=health(mid);
    if(net.gt(0)){if(h.lte(0))lo=mid;else hi=mid;}else{if(h.gt(0))lo=mid;else hi=mid;}
  }
  // Round toward the current price so the reference is never later than the model boundary.
  const value=net.gt(0)?hi.div(tick).integerValue(BigNumber.ROUND_CEIL).times(tick):lo.div(tick).integerValue(BigNumber.ROUND_FLOOR).times(tick);
  return value.gt(0)?out(value):null;
}
