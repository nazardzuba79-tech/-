import { formatBookAmount, livePerpetualTurnover } from '../terminalPresentation';
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
test('formatting never modifies source values or aggregates', () => { const levels=[{quantity:0.1234567890123,price:12.3456789}]; const before=JSON.stringify(levels); for(const level of levels) { formatBookAmount(level.quantity); formatBookAmount(level.price*level.quantity); } expect(JSON.stringify(levels)).toBe(before); });
test('exact live perpetual turnover and real zero are available', () => { expect(livePerpetualTurnover(state(),'BTC/USDT',now)).toBe(123456789); expect(livePerpetualTurnover(state({quoteVolume24h:0}),'BTC/USDT',now)).toBe(0); });
test.each([{marketType:'spot'}, {marketType:'linear_futures'}, {marketType:'inverse_perpetual'}, {pair:'ETH/USDT'}, {quoteAsset:'USD'}, {settleAsset:'BTC'}, {turnoverAsset:'BTC'}, {stale:true}, {fetchedAt:now-30001}, {receivedAt:now-30001}, {fetchedAt:NaN}, {fetchedAt:now+6000}, {quoteVolume24h:null}, {quoteVolume24h:NaN}, {quoteVolume24h:-1}, {providerSymbol:'ETHUSDT'}] as Partial<LiveQuote>[])('reject mismatched, expired or malformed turnover %j', patch => expect(livePerpetualTurnover(state(patch),'BTC/USDT',now)).toBeNull());
test.each(['disabled','connecting','stale'] as const)('non-live stream gives no turnover: %s', status => expect(livePerpetualTurnover(state({},status),'BTC/USDT',now)).toBeNull());
