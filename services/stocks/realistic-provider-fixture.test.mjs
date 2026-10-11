import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeHistoryFixture } from './realistic-provider-fixture.mjs';

const end=1791630000000;
for(const provider of ['binance','bybit'])test(`${provider}: shared benchmark fixture honors native limit/end/order with identical underlying candles`,()=>{
  const bybit=provider==='bybit',url=new URL(bybit?'https://api.bybit.com/v5/market/kline':'https://api.binance.com/api/v3/klines');
  url.searchParams.set('symbol','AAPL_FIXTURE');url.searchParams.set('interval',bybit?'15':'15m');url.searchParams.set(bybit?'end':'endTime',String(end));
  const read=limit=>{url.searchParams.set('limit',String(limit));const body=nativeHistoryFixture(url);return bybit?body.result.list:body;};
  const small=read(300),wide=read(600);assert.equal(small.length,300);assert.equal(wide.length,600);
  assert.deepEqual(bybit?wide.slice(0,300):wide.slice(-300),small);
  assert.equal(Number((bybit?small[0]:small.at(-1))[0]),end);
  assert.equal(small.filter(row=>Number(row[0])<end).length,299);
  assert.ok(bybit?Number(small[0][0])>Number(small[1][0]):Number(small[0][0])<Number(small[1][0]));
  url.searchParams.set(bybit?'end':'endTime',String(end+1));
  assert.equal(read(300).filter(row=>Number(row[0])<end+1).length,300);
});
test('capacity fixture denies unknown transport and invalid native pagination without I/O',()=>{
  assert.throws(()=>nativeHistoryFixture('https://example.com/api/v3/klines'),/FIXTURE_TRANSPORT_DENIED/);
  assert.throws(()=>nativeHistoryFixture('https://api.binance.com/v5/market/kline'),/FIXTURE_TRANSPORT_DENIED/);
  assert.throws(()=>nativeHistoryFixture('https://api.binance.com/api/v3/klines?interval=15m&limit=1001'),/pagination/);
});
