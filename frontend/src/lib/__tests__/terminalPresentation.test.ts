import { formatBookAmount, formatBookTotal, formatCompactBookValue, livePerpetualTurnover } from '../terminalPresentation';
import type { LiveQuote, LiveState } from '../liveMarketTypes';

const now = 1_800_000_000_000;
const quote = { id: 'linear_perpetual:BTCUSDT', pair: 'BTC/USDT', providerSymbol:'BTCUSDT', provider:'bybit', marketType:'linear_perpetual', baseAsset:'BTC', quoteAsset:'USDT', settleAsset:'USDT', turnoverAsset:'USDT', receivedAt:now, fetchedAt:now, stale:false, quoteVolume24h:123456789 } as LiveQuote;
const state = (patch: Partial<LiveQuote> = {}, status: LiveState['status'] = 'live'): LiveState => ({ status, revision:1, rows:new Map([[quote.id, {...quote, ...patch}]]) });
test.each([0, 0.000000000045123456, 0.00123456789, 1.23456789, 12345.123456789, 123456789123])('book display stays compact and finite: %s', value => {
  const formatted = formatBookAmount(value);
  expect(formatted.length).toBeLessThanOrEqual(13);
  expect(formatted).not.toBe('—');
  expect(value === 0 ? formatted === '0' : Number(formatted.replace(/,/g,'')) > 0).toBe(true);
});
test.each([NaN, Infinity, -1])('malformed display is unavailable: %s', value => expect(formatBookAmount(value)).toBe('—'));

test.each([0, 0.024589, 1.2345, 123.4567, 123456.789012, 999999999.999, 1.2345e12,
  0.0001234567, 1.23456e-12, Number.MIN_VALUE, Number.MAX_VALUE])('compact book cells fit eight characters without losing nonzero levels: %s', value => {
  for (const kind of ['amount', 'total'] as const) {
    const formatted = formatCompactBookValue(value, kind);
    expect(formatted.length).toBeLessThanOrEqual(8);
    expect(formatted).not.toBe('—');
    expect(value === 0 ? formatted === '0' : parseFloat(formatted.replace(/,/g, '')) > 0).toBe(true);
    const full = kind === 'total' ? formatBookTotal(value) : formatBookAmount(value);
    if (full.length <= 8) expect(formatted).toBe(full);
  }
});

test.each([NaN, Infinity, -Infinity, -1])('compact malformed values remain unavailable: %s', value => {
  expect(formatCompactBookValue(value)).toBe('—');
  expect(formatCompactBookValue(value, 'total')).toBe('—');
});

test('compact amount and quote total retain their separate numerical meaning', () => {
  const quantity = 123456.789012;
  const price = 123.4;
  expect(formatCompactBookValue(quantity)).toBe('123.46K');
  expect(formatCompactBookValue(price * quantity, 'total')).toBe('15.23M');
  expect(formatCompactBookValue(0.0001234567)).toBe('1.235e-4');
});
test('formatting never modifies source values or aggregates', () => { const levels=[{quantity:0.1234567890123,price:12.3456789}]; const before=JSON.stringify(levels); for(const level of levels) { formatBookAmount(level.quantity); formatBookAmount(level.price*level.quantity); } expect(JSON.stringify(levels)).toBe(before); });
test('exact live perpetual turnover and real zero are available', () => { expect(livePerpetualTurnover(state(),'BTC/USDT',now)).toBe(123456789); expect(livePerpetualTurnover(state({quoteVolume24h:0}),'BTC/USDT',now)).toBe(0); });
test.each([{marketType:'spot'}, {marketType:'linear_futures'}, {marketType:'inverse_perpetual'}, {pair:'ETH/USDT'}, {quoteAsset:'USD'}, {settleAsset:'BTC'}, {turnoverAsset:'BTC'}, {stale:true}, {fetchedAt:now-30001}, {receivedAt:now-30001}, {fetchedAt:NaN}, {fetchedAt:now+6000}, {quoteVolume24h:null}, {quoteVolume24h:NaN}, {quoteVolume24h:-1}, {providerSymbol:'ETHUSDT'}] as Partial<LiveQuote>[])('reject mismatched, expired or malformed turnover %j', patch => expect(livePerpetualTurnover(state(patch),'BTC/USDT',now)).toBeNull());
test.each(['disabled','connecting','stale'] as const)('non-live stream gives no turnover: %s', status => expect(livePerpetualTurnover(state({},status),'BTC/USDT',now)).toBeNull());
