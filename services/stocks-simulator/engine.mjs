// Standalone paper ledger. No wallet, Prisma, broker or exchange dependencies.
export const SYMBOLS = ['AAPL', 'NVDA', 'MSFT', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'COST', 'NFLX'];
export const CURRENCIES = ['USDT', 'USDC'];
export const SCALE = 100_000_000n;
export const MAX_QUOTE_AGE_MS = 180_000;
const MAX_VALUE = 100_000_000n * SCALE;
export class SimError extends Error { constructor(code) { super(code); this.code = code; } }
export function check(condition, code) { if (!condition) throw new SimError(code); }
export function units(value, positive = false) {
  check(typeof value === 'string' && /^\d{1,9}(\.\d{1,8})?$/.test(value), 'INVALID_DECIMAL');
  const [whole, fraction = ''] = value.split('.');
  const n = BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, '0'));
  check(n <= MAX_VALUE && (!positive || n > 0n), 'INVALID_AMOUNT'); return n;
}
export function decimal(n) {
  const negative = n < 0n; const a = negative ? -n : n;
  return (negative ? '-' : '') + a / SCALE + '.' + (a % SCALE).toString().padStart(8, '0');
}
const ceil = (a, b) => (a + b - 1n) / b;
const gross = (p, q, buy) => buy ? ceil(p * q, SCALE) : p * q / SCALE;
const fee = (value, bps) => ceil(value * BigInt(bps), 10_000n);
const pair = (s, c) => `${s}/${c}`;
export function createState(now = Date.now()) {
  return { schema: 1, revision: 0, createdAt: now, settings: { feeBps: 0, usdPerUnit: { USDT: '1.00000000', USDC: '1.00000000' }, conversion: 'fixed-test-rate' },
    wallets: { USDT: { cash: '10000.00000000', reserved: '0.00000000' }, USDC: { cash: '10000.00000000', reserved: '0.00000000' } },
    positions: {}, orders: [], fills: [], quotes: {}, realized: { USDT: '0.00000000', USDC: '0.00000000' } };
}
export function quoteStatus(q, now) {
  if (!q) return 'QUOTE_UNAVAILABLE';
  if (q.provider !== 'Twelve Data' || !SYMBOLS.includes(q.symbol) || q.currency !== 'USD' || q.interval !== '1min') return 'INVALID_QUOTE';
  try { units(q.priceUsd, true); } catch { return 'INVALID_QUOTE'; }
  if (!Number.isSafeInteger(q.timestamp) || !Number.isSafeInteger(q.receivedAt) || q.timestamp > now + 5_000 || q.receivedAt > now + 5_000) return 'INVALID_QUOTE';
  if (now - q.timestamp > MAX_QUOTE_AGE_MS || now - q.receivedAt > 30_000) return 'QUOTE_STALE';
  if (q.marketOpen !== true) return 'MARKET_CLOSED';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  if (['Sat', 'Sun'].includes(parts.weekday) || minutes < 570 || minutes >= 960) return 'MARKET_CLOSED';
  return 'READY';
}
export function convertedPrice(state, quote, currency, side = 'BUY') {
  const n = units(quote.priceUsd, true) * SCALE, rate = units(state.settings.usdPerUnit[currency], true);
  return side === 'BUY' ? ceil(n, rate) : n / rate;
}
function position(state, symbol, currency) {
  return state.positions[pair(symbol, currency)] ??= { symbol, currency, quantity: decimal(0n), reserved: decimal(0n), cost: decimal(0n), realized: decimal(0n) };
}
export function configure(state, input) {
  check(state.orders.length === 0, 'SETTINGS_LOCKED');
  check(Number.isInteger(input.feeBps) && input.feeBps >= 0 && input.feeBps <= 1000, 'INVALID_FEE');
  for (const c of CURRENCIES) {
    const rate = units(input.usdPerUnit?.[c], true);
    check(rate >= SCALE / 10n && rate <= SCALE * 10n, 'INVALID_RATE');
    state.settings.usdPerUnit[c] = decimal(rate);
    state.wallets[c].cash = decimal(units(input.balances?.[c]));
  }
  state.settings.feeBps = input.feeBps;
}
export function setTestBalances(state, input, now) {
  check(typeof input?.id === 'string' && /^[a-zA-Z0-9-]{16,80}$/.test(input.id), 'INVALID_REQUEST_ID');
  const balances = Object.fromEntries(CURRENCIES.map(c => [c, decimal(units(input.balances?.[c]))]));
  const signature = JSON.stringify(balances); const adjustments = state.adjustments ??= [];
  const existing = adjustments.find(a => a.id === input.id);
  if (existing) { check(existing.signature === signature, 'IDEMPOTENCY_CONFLICT'); return; }
  check(adjustments.length < 1000, 'LEDGER_LIMIT');
  for (const c of CURRENCIES) check(units(balances[c]) >= units(state.wallets[c].reserved), 'RESERVED_FUNDS');
  const previous = Object.fromEntries(CURRENCIES.map(c => [c, state.wallets[c].cash]));
  for (const c of CURRENCIES) state.wallets[c].cash = balances[c];
  adjustments.push({ id: input.id, signature, timestamp: now, balances, previous, reason: 'owner-test-balance-setting' });
}
function request(input) {
  check(input && typeof input === 'object', 'INVALID_ORDER');
  check(typeof input.id === 'string' && /^[a-zA-Z0-9-]{16,80}$/.test(input.id), 'INVALID_REQUEST_ID');
  check(SYMBOLS.includes(input.symbol) && CURRENCIES.includes(input.currency), 'INVALID_PAIR');
  check(['BUY', 'SELL'].includes(input.side) && ['MARKET', 'LIMIT'].includes(input.type), 'INVALID_ORDER');
  const quantity = decimal(units(input.quantity, true));
  const limitPrice = input.type === 'LIMIT' ? decimal(units(input.limitPrice, true)) : null;
  return { id: input.id, symbol: input.symbol, currency: input.currency, side: input.side, type: input.type, quantity, limitPrice };
}
export function submit(state, input, now) {
  const r = request(input); const signature = JSON.stringify(r);
  const existing = state.orders.find(o => o.id === r.id);
  if (existing) { check(existing.signature === signature, 'IDEMPOTENCY_CONFLICT'); return existing; }
  check(state.orders.length < 10_000, 'LEDGER_LIMIT');
  const q = units(r.quantity, true), buy = r.side === 'BUY', quote = state.quotes[r.symbol];
  if (r.type === 'MARKET') check(quoteStatus(quote, now) === 'READY', quoteStatus(quote, now));
  const p = r.type === 'LIMIT' ? units(r.limitPrice, true) : convertedPrice(state, quote, r.currency, r.side);
  const amount = gross(p, q, buy); check(amount > 0n, 'ORDER_TOO_SMALL');
  const reserved = buy ? amount + fee(amount, state.settings.feeBps) : q;
  const wallet = state.wallets[r.currency]; const pos = position(state, r.symbol, r.currency);
  if (buy) {
    check(units(wallet.cash) - units(wallet.reserved) >= reserved, 'INSUFFICIENT_FUNDS');
    wallet.reserved = decimal(units(wallet.reserved) + reserved);
  } else {
    check(units(pos.quantity) - units(pos.reserved) >= q, 'INSUFFICIENT_SHARES');
    pos.reserved = decimal(units(pos.reserved) + q);
  }
  const order = { ...r, signature, feeBps: state.settings.feeBps, reserved: decimal(reserved), status: 'OPEN', createdAt: now, updatedAt: now, fillId: null };
  state.orders.push(order); match(state, r.symbol, now); return order;
}
export function cancel(state, id, now) {
  const order = state.orders.find(o => o.id === id); check(order, 'ORDER_NOT_FOUND');
  if (order.status !== 'OPEN') return order;
  release(state, order); order.status = 'CANCELLED'; order.updatedAt = now; return order;
}
function release(state, order) {
  const owner = order.side === 'BUY' ? state.wallets[order.currency] : position(state, order.symbol, order.currency);
  owner.reserved = decimal(units(owner.reserved) - units(order.reserved)); order.reserved = decimal(0n);
}
export function applyQuote(state, quote, now) {
  check(SYMBOLS.includes(quote?.symbol), 'INVALID_QUOTE');
  const status = quoteStatus(quote, now);
  check(!['INVALID_QUOTE', 'QUOTE_UNAVAILABLE'].includes(status), 'INVALID_QUOTE');
  const old = state.quotes[quote.symbol];
  // Out-of-order provider snapshots must not move valuation or trigger a fill backwards.
  if (old && old.timestamp > quote.timestamp) return;
  state.quotes[quote.symbol] = quote; match(state, quote.symbol, now);
}
export function match(state, symbol, now) {
  const quote = state.quotes[symbol]; if (quoteStatus(quote, now) !== 'READY') return;
  for (const order of state.orders) {
    if (order.symbol !== symbol || order.status !== 'OPEN') continue;
    const buy = order.side === 'BUY', p = convertedPrice(state, quote, order.currency, order.side), q = units(order.quantity);
    if (order.type === 'LIMIT' && (buy ? p > units(order.limitPrice) : p < units(order.limitPrice))) continue;
    const value = gross(p, q, buy), commission = fee(value, order.feeBps);
    if (value === 0n || (!buy && commission > value)) continue;
    const wallet = state.wallets[order.currency], pos = position(state, symbol, order.currency);
    release(state, order);
    let realized = 0n;
    if (buy) {
      check(units(wallet.cash) - units(wallet.reserved) >= value + commission, 'INSUFFICIENT_FUNDS');
      wallet.cash = decimal(units(wallet.cash) - value - commission);
      pos.quantity = decimal(units(pos.quantity) + q); pos.cost = decimal(units(pos.cost) + value + commission);
    } else {
      check(units(pos.quantity) - units(pos.reserved) >= q, 'INSUFFICIENT_SHARES');
      const basis = q === units(pos.quantity) ? units(pos.cost) : units(pos.cost) * q / units(pos.quantity);
      realized = value - commission - basis;
      wallet.cash = decimal(units(wallet.cash) + value - commission);
      pos.quantity = decimal(units(pos.quantity) - q); pos.cost = decimal(units(pos.cost) - basis);
      pos.realized = decimal(BigInt(pos.realized.replace('.', '')) + realized);
      state.realized[order.currency] = decimal(BigInt(state.realized[order.currency].replace('.', '')) + realized);
    }
    const fill = { id: `fill-${order.id}`, orderId: order.id, symbol, currency: order.currency, side: order.side,
      quantity: order.quantity, price: decimal(p), priceUsd: quote.priceUsd, usdPerUnit: state.settings.usdPerUnit[order.currency],
      notional: decimal(value), fee: decimal(commission), realized: decimal(realized), timestamp: now, quoteTimestamp: quote.timestamp, provider: quote.provider };
    state.fills.push(fill); order.status = 'FILLED'; order.fillId = fill.id; order.updatedAt = now;
  }
}
export function validate(state) {
  check(state?.schema === 1 && Number.isSafeInteger(state.revision), 'CORRUPT_LEDGER');
  const ids = new Set();
  for (const o of state.orders) { check(!ids.has(o.id), 'CORRUPT_LEDGER'); ids.add(o.id); }
  check(new Set(state.fills.map(f => f.orderId)).size === state.fills.length, 'CORRUPT_LEDGER');
  for (const c of CURRENCIES) {
    const w = state.wallets[c]; check(units(w.cash) >= units(w.reserved), 'NEGATIVE_BALANCE');
    const reserved = state.orders.filter(o => o.status === 'OPEN' && o.side === 'BUY' && o.currency === c).reduce((n, o) => n + units(o.reserved), 0n);
    check(reserved === units(w.reserved), 'RESERVATION_MISMATCH');
  }
  for (const p of Object.values(state.positions)) {
    check(units(p.quantity) >= units(p.reserved), 'NEGATIVE_SHARES'); units(p.cost);
    const reserved = state.orders.filter(o => o.status === 'OPEN' && o.side === 'SELL' && o.symbol === p.symbol && o.currency === p.currency).reduce((n, o) => n + units(o.reserved), 0n);
    check(reserved === units(p.reserved), 'RESERVATION_MISMATCH');
  }
}
export function snapshot(state, now) {
  const result = structuredClone(state);
  for (const c of CURRENCIES) result.wallets[c].available = decimal(units(state.wallets[c].cash) - units(state.wallets[c].reserved));
  for (const p of Object.values(result.positions)) {
    const q = units(p.quantity), quote = state.quotes[p.symbol];
    p.available = decimal(q - units(p.reserved)); p.average = q ? decimal(units(p.cost) * SCALE / q) : null;
    p.quoteStatus = quoteStatus(quote, now); p.unrealized = null; p.mark = null;
    if (q && p.quoteStatus === 'READY') {
      const price = convertedPrice(state, quote, p.currency, 'SELL');
      p.mark = decimal(price); p.unrealized = decimal(gross(price, q, false) - units(p.cost));
    }
  }
  for (const q of Object.values(result.quotes)) { q.status = quoteStatus(q, now); q.ageSeconds = Math.max(0, Math.floor((now - q.timestamp) / 1000)); }
  result.serverTime = now; result.maxQuoteAgeSeconds = MAX_QUOTE_AGE_MS / 1000;
  // Internal deduplication payload is not needed in the UI.
  for (const order of result.orders) delete order.signature;
  return result;
}
