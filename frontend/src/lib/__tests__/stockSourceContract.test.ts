import { readFileSync } from 'fs';
import { resolve } from 'path';
import { admitStockHistory, mergeAdmittedStockHistory, mergeStockSourceGaps } from '../../pages/stocks/global/readWork';

const mint = 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W', pool = '4pCZCVEiYyT4efNdXUdL2tJF8VGMgiMXrZWq6FiNXhRw';
const id = `SOLANA:${mint}:${pool}`, time = 1792922400;
const gates = { programIdentity: true, poolState: true, mintChronology: true, feeChronology: true, completeness: true, executionBinding: true };
// Pure disposable response fixture; this is not evidence of an accepted market.
const page = (): any => ({ schema: 'voltex.solana-ohlcv.v1', instrumentId: id, interval: '1m',
  priceKind: 'raw-token', quoteCurrency: 'USDC', range: { from: time, to: time + 180 },
  candles: [{ time, open: 10, high: 12, low: 9, close: 11, volume: 4, tradeCount: 2, proofDigest: 'a'.repeat(64) }],
  gaps: [{ time: time + 60, reason: 'NO_TRADES' }, { time: time + 120, reason: 'UNKNOWN' }],
  provenance: { status: 'ACCEPTED', intervalComplete: true, finality: 'finalized', acceptedTradeCount: 2,
    receiptsHash: 'b'.repeat(64), gates: { ...gates }, synthetic: false, source: { network: 'solana-mainnet-beta', mint, pool,
      quoteMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', program: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK' } } });

test('versioned source envelope admits only executed buckets and preserves explicit gaps', () => {
  const input = page(), admitted = admitStockHistory(input, id, '1m');
  expect(admitted.error).toBeUndefined(); expect(admitted.candles).toEqual(input.candles);
  expect(admitted.gaps).toEqual(input.gaps); expect(admitted.ownSource).toBe(true);
});

test.each(Object.keys(gates))('a missing %s gate rejects numeric rows', gate => {
  const input = page(); input.provenance.gates[gate] = false;
  expect(admitStockHistory(input, id, '1m').candles).toEqual([]);
});

test.each([
  ['wrong schema', (p: any) => { p.schema = 'unknown'; }],
  ['wrong mint', (p: any) => { p.provenance.source.mint = pool; }],
  ['wrong requested identity', (p: any) => { p.instrumentId = 'BYBIT:AAPLXUSDT'; }],
  ['wrong interval', (p: any) => { p.interval = '5m'; }],
  ['wrong network', (p: any) => { p.provenance.source.network = 'devnet'; }],
  ['wrong program', (p: any) => { p.provenance.source.program = mint; }],
  ['wrong quote mint', (p: any) => { p.provenance.source.quoteMint = mint; }],
  ['equity-equivalent masquerade', (p: any) => { p.priceKind = 'equity'; }],
  ['synthetic prices', (p: any) => { p.provenance.synthetic = true; }],
  ['unfinalized prices', (p: any) => { p.provenance.finality = 'confirmed'; }],
  ['zero price', (p: any) => { p.candles[0].open = 0; }],
  ['NaN price', (p: any) => { p.candles[0].high = NaN; }],
  ['zero volume', (p: any) => { p.candles[0].volume = 0; }],
  ['invalid OHLC', (p: any) => { p.candles[0].low = 12; }],
  ['missing coverage', (p: any) => { p.gaps.pop(); }],
  ['duplicate candles', (p: any) => { p.candles.push(p.candles[0]); }],
  ['overlapping gap', (p: any) => { p.gaps[0].time = time; }],
  ['bad trade count', (p: any) => { p.provenance.acceptedTradeCount = 3; }],
  ['bad receipt hash', (p: any) => { p.provenance.receiptsHash = 'no'; }],
  ['missing candle digest', (p: any) => { delete p.candles[0].proofDigest; }],
  ['off-grid candle', (p: any) => { p.candles[0].time++; }],
])('%s fails closed', (_name, corrupt) => {
  const input = page(); (corrupt as (p: any) => void)(input);
  const admitted = admitStockHistory(input, id, '1m');
  expect(admitted.candles).toEqual([]); expect(admitted.error).toBe('SOURCE_UNAVAILABLE');
});

test('revoked source range evicts prior admitted candles, including paging cache', () => {
  const input = page(), old = [{ ...input.candles[0], time: time - 60 }, input.candles[0]];
  input.provenance.status = 'UNKNOWN'; input.provenance.intervalComplete = false;
  input.provenance.acceptedTradeCount = 0; input.candles = [];
  input.gaps.unshift({ time, reason: 'UNKNOWN' });
  const admitted = admitStockHistory(input, id, '1m');
  expect(mergeAdmittedStockHistory(old, admitted)).toEqual([old[0]]);
  expect(mergeAdmittedStockHistory(old, admitStockHistory({ provenance: null, candles: [] }, id, '1m'))).toEqual([]);
});

test('own-source identity cannot fall back to an unproven legacy page', () => {
  expect(admitStockHistory({ candles: page().candles }, id, '1m').candles).toEqual([]);
  const cex = { candles: page().candles };
  expect(admitStockHistory(cex, 'BYBIT:AAPLXUSDT', '15m').candles).toBe(cex.candles);
});

test('unchanged gap pages preserve chart dependencies, corrections replace them', () => {
  const admitted = admitStockHistory(page(), id, '1m'), old = admitted.gaps;
  expect(mergeStockSourceGaps(old, admitted)).toBe(old);
  const empty: any[] = [];
  expect(mergeStockSourceGaps(empty, admitStockHistory({ candles: [] }, 'BYBIT:AAPLXUSDT', '15m'))).toBe(empty);
  const corrected = { ...admitted, gaps: [{ time: time + 60, reason: 'UNKNOWN' }] };
  expect(mergeStockSourceGaps(old, corrected)).toEqual(corrected.gaps);
});

test.each(['SPYx', 'CRCLx'])('real %s pipeline output is consumed as UNKNOWN at 1m/5m/1h', ticker => {
  const report = JSON.parse(readFileSync(resolve(__dirname, '../../../../research/solana-xstocks/proof-615-20261026', `${ticker}-source-replay.json`), 'utf8'));
  expect(report.acceptedIntervals).toBe(0); expect(report.acceptedMarkets).toBe(0);
  for (const [interval, input] of Object.entries<any>(report.pages)) {
    const admitted = admitStockHistory(input, input.instrumentId, interval);
    expect(admitted.candles).toEqual([]); expect(admitted.gaps).toEqual(input.gaps);
    expect(admitted.error).toBe('SOURCE_UNAVAILABLE');
  }
});
