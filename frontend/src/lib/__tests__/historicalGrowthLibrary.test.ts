/**
 * Admin → Listings, historical growth window (History20): the committed
 * catalogue metadata, the browser model against the server's reference, the
 * rotation and the pack import. Synthetic fixtures only; the owner's pack is
 * read solely by the local-only test at the end (HISTORY20_ZIP).
 */
import { deflateRawSync } from 'zlib';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { HISTORY20_CATALOG, HISTORY20_PACK, HISTORY20_ROTATION } from '../../pages/admin/historicalGrowthCatalog';
import * as browser from '../../pages/admin/historicalGrowthModel';
import * as server from '../../../../src/shared/listingHistoricalGrowth';
import { importHistory20, packFiles, readZipEntries } from '../../pages/admin/historicalGrowthPack';
import { historicalGrowthProvenance, nextRotationScenario } from '../../pages/admin/ListingHistoricalGrowthPanel';
import { newListingMovement, rebaseListingMovement, validateListingMovement } from '../../pages/admin/listingMovementModel';

const DAY = 86_400_000;
const rows = (days: number, ohlc: boolean) => Array.from({ length: days }, (_, d) => {
  const date = new Date(Date.UTC(2019, 3, 1) + d * DAY).toISOString().slice(0, 10);
  const close = 10 * Math.exp(d * 0.09 + 0.2 * Math.sin(d / 2.5)), open = close * (1 - 0.01 * Math.cos(d));
  return ohlc ? { date, open, high: Math.max(open, close) * 1.02, low: Math.min(open, close) * 0.97, close } : { date, close };
});
const OHLC = { provider: 'Binance Vision', asset: 'LINK', quote: 'USDT', metric: 'spot daily OHLCV', dataKind: 'exchange_ohlcv', timeframe: '1d', sliceSha256: 'd'.repeat(64), license: 'CC-BY-NC-SA-4.0 plus Binance Vision Dataset Terms' } as const;
const REF = { provider: 'Coin Metrics', asset: 'XMR', quote: 'USD', metric: 'PriceUSD', dataKind: 'daily_reference', timeframe: '1d', sliceSha256: 'e'.repeat(64), license: 'CC-BY-NC-4.0' } as const;

describe('the committed History20 catalogue (metadata only)', () => {
  test('exactly 20 scenarios: distinct IDs, assets, source slices and files; every target inside +7248% … +15324%', () => {
    expect(HISTORY20_CATALOG).toHaveLength(20);
    for (const key of ['id', 'asset', 'sourceSliceSha256', 'scenarioFileSha256', 'sourceUrl'] as const) expect(new Set(HISTORY20_CATALOG.map(i => i[key])).size).toBe(20);
    for (const item of HISTORY20_CATALOG) {
      expect(Number(item.targetPeakGrowthPercent)).toBeGreaterThanOrEqual(7248);
      expect(Number(item.targetPeakGrowthPercent)).toBeLessThanOrEqual(15324);
      expect(item.alpha).toBeGreaterThan(0);
      expect(item.dataKind === 'exchange_ohlcv' ? item.provider : 'Coin Metrics').toBe(item.provider);
    }
    expect(HISTORY20_CATALOG.filter(i => i.dataKind === 'exchange_ohlcv')).toHaveLength(13);
    expect(HISTORY20_PACK.rightsStatus).toBe('PUBLIC_COMMERCIAL_NOT_CLEARED');
  });

  test('the rotation is the deterministic 20-ID cycle, one step per listing ID, starting at BotLab 01\'s window', () => {
    expect(HISTORY20_ROTATION).toEqual(HISTORY20_CATALOG.map(i => i.id));
    expect(nextRotationScenario(0)).toEqual({ id: 'VHX-01-BTC', position: 1 });
    expect(nextRotationScenario(1).id).toBe('VHX-02-ETH');
    expect(nextRotationScenario(19).id).toBe('VHX-20-NEAR');
    expect(nextRotationScenario(20).id).toBe('VHX-01-BTC');
    // 04_NEXT_LISTING_DRAFT.json names this scenario file by its SHA-256.
    expect(HISTORY20_CATALOG[0].scenarioFileSha256).toBe('689c4ea7bf0368651f7a25e92d3dc25b30673acbd4ff8de71820587ec63dfcb3');
  });

  test('the metadata file carries no price series', () => {
    const source = readFileSync(resolve(__dirname, '../../pages/admin/historicalGrowthCatalog.ts'), 'utf8');
    expect(source).not.toMatch(/normalized_path|open:|close:|logs/);
    expect(source.length).toBeLessThan(25_000);
  });
});

describe('the browser model equals the server reference', () => {
  test.each([['OHLC', OHLC, true], ['reference', REF, false]] as const)('%s: same stored program, alpha, daily model and fold', (_label, source, ohlc) => {
    const input = { scenarioId: 'VHX-07-LINK', source, targetPeakGrowthPercent: '10084', rows: rows(90, ohlc) };
    const a = browser.buildHistoricalGrowthProgram(input), b = server.buildHistoricalGrowthProgram(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(browser.historicalGrowthAlpha(a)).toBe(server.historicalGrowthAlpha(b));
    expect(browser.historicalGrowthDailyModel(a, '2')).toEqual(server.historicalGrowthDailyModel(b, '2'));
    expect(browser.historicalGrowthMaxPrice('2', '10084')).toBe(server.historicalGrowthMaxPrice('2', '10084'));
    expect(browser.historicalGrowthFold('LINK')).toBe(server.historicalGrowthFold('LINK'));
    expect(browser.historicalGrowthProblem(a)).toBeNull();
    expect(browser.historicalGrowthProblem({ ...a, logsSha256: '0'.repeat(64) })).toContain('Контрольная сумма');
  });

  test('intraday model: v2 by default on both sides, v1 on request; switching keeps the stored logs; ids are bound to the data kind', () => {
    for (const [source, ohlc] of [[OHLC, true], [REF, false]] as const) {
      const input = { scenarioId: 'VHX-07-LINK', source, targetPeakGrowthPercent: '10084', rows: rows(60, ohlc) };
      const v2 = browser.buildHistoricalGrowthProgram(input), v1 = browser.buildHistoricalGrowthProgram({ ...input, intrabarVersion: 1 });
      expect(v2.intrabar).toBe(ohlc ? 'SEEDED_BRIDGE_OHLC_V2' : 'SEEDED_BRIDGE_REFERENCE_V2');
      expect(JSON.stringify(v1)).toBe(JSON.stringify(server.buildHistoricalGrowthProgram({ ...input, intrabarVersion: 1 })));
      expect(browser.historicalGrowthWithIntrabar(v2, 1)).toEqual(v1);
      expect(browser.historicalGrowthWithIntrabar(v1, 2)).toEqual(v2);
      expect(browser.historicalGrowthIntrabarVersion(v1)).toBe(1);
      expect(browser.historicalGrowthProblem(v1)).toBeNull();
      expect(browser.historicalGrowthProblem({ ...v2, intrabar: ohlc ? 'SEEDED_BRIDGE_REFERENCE_V2' : 'SEEDED_BRIDGE_OHLC_V2' })).toContain('Модель внутри суток');
    }
  });

  test('labels: daily values are the observation; intraday paths, reference wicks and volume are the MODEL', () => {
    const ref = historicalGrowthProvenance({ intrabar: 'SEEDED_BRIDGE_REFERENCE_V2', source: { dataKind: 'daily_reference', provider: 'Coin Metrics', metric: 'PriceUSD' } });
    expect(ref.observed).toContain('одна опорная цена Coin Metrics PriceUSD на сутки');
    expect(ref.observed).toContain('Дневного максимума и минимума в источнике нет');
    expect(ref.modeled).toMatch(/^МОДЕЛЬ v2/);
    expect(ref.modeled).toContain('тени, максимум и минимум выдуманы моделью');
    expect(ref.modeled).toContain('не объём площадки');
    const ohlc = historicalGrowthProvenance({ intrabar: 'SEEDED_BRIDGE_OHLC_V2', source: { dataKind: 'exchange_ohlcv', provider: 'Binance Vision', metric: 'spot daily OHLCV' } });
    expect(ohlc.observed).toContain('Свеча 1d в симуляции равна дневному бару источника');
    expect(ohlc.modeled).toContain('порядок и время максимума и минимума неизвестны');
    expect(historicalGrowthProvenance({ intrabar: 'SEEDED_OHLC_PATH_V1', source: { dataKind: 'exchange_ohlcv', provider: 'Binance Vision', metric: 'spot daily OHLCV' } }).modeled).toMatch(/^МОДЕЛЬ v1 \(базовая линия/);
  });

  test('the source CSV parser keeps no volume and refuses a malformed row', () => {
    const parsed = browser.parseHistoricalGrowthCsv('date,open,high,low,close,volume\n2020-01-01,1,2,0.5,1.5,999\n', 'exchange_ohlcv');
    expect(parsed).toEqual([{ date: '2020-01-01', open: 1, high: 2, low: 0.5, close: 1.5 }]);
    expect(() => browser.parseHistoricalGrowthCsv('date,close\n2020-01-01,abc\n', 'daily_reference')).toThrow('Неверное число');
    expect(() => browser.parseHistoricalGrowthCsv('date,open,high,low,close\n', 'daily_reference')).toThrow('заголовок');
  });
});

describe('the form rules', () => {
  const program = browser.buildHistoricalGrowthProgram({ scenarioId: 'VHX-01-BTC', source: REF, targetPeakGrowthPercent: '11872.45', rows: rows(60, false) });
  const window = browser.historicalWindowMovement(newListingMovement('2'), '2', program);

  test('the window replaces the stages; P0 changes the cap to exactly P0 · M; mixing modes is refused', () => {
    expect(window).toMatchObject({ growth: 'historical-window', stages: [], afterGrowth: 'range', first24hGainPercent: '0', maxPrice: '239.449' });
    expect(validateListingMovement('2', window)).toBeNull();
    expect(rebaseListingMovement(window, '2', '4').maxPrice).toBe('478.898');
    expect(validateListingMovement('2', { ...window, stages: newListingMovement('2').stages })).toContain('заменяет этапы');
    expect(validateListingMovement('2', { ...window, maxPrice: '239.45' })).toContain('P0 · (1 + G/100)');
    expect(validateListingMovement('2', { ...window, growth: undefined })).toContain('историческое окно');
    expect(validateListingMovement('2', newListingMovement('2'))).toBeNull();
  });
});

describe('the pack import', () => {
  /** A minimal ZIP: one deflated and one stored entry. */
  function zip(entries: [string, string, 'deflate' | 'store'][]) {
    const parts: Buffer[] = [], central: Buffer[] = [];
    let offset = 0;
    for (const [name, text, mode] of entries) {
      const plain = Buffer.from(text), data = mode === 'deflate' ? deflateRawSync(plain) : plain, nameBytes = Buffer.from(name);
      const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(mode === 'deflate' ? 8 : 0, 8);
      local.writeUInt32LE(data.length, 18); local.writeUInt32LE(plain.length, 22); local.writeUInt16LE(nameBytes.length, 26);
      const head = Buffer.alloc(46); head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(mode === 'deflate' ? 8 : 0, 10);
      head.writeUInt32LE(data.length, 20); head.writeUInt32LE(plain.length, 24); head.writeUInt16LE(nameBytes.length, 28); head.writeUInt32LE(offset, 42);
      parts.push(local, nameBytes, data); central.push(head, nameBytes); offset += 30 + nameBytes.length + data.length;
    }
    const dir = Buffer.concat(central), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
    return new Uint8Array(Buffer.concat([...parts, dir, end]));
  }

  test('reads stored and deflated entries and maps them into the pack folder', async () => {
    const files = packFiles(await readZipEntries(zip([
      ['VOLTEX_History20_Claude_20261018/catalog.json', '{"x":1}', 'deflate'],
      ['VOLTEX_History20_Claude_20261018/data/source/VHX-01-BTC.csv', 'date,close\n', 'store'],
      ['VOLTEX_History20_Claude_20261018/charts/VHX-01-BTC.png', 'not read', 'store'],
    ]), () => true));
    expect([...files.keys()].sort()).toEqual(['catalog.json', 'data/source/VHX-01-BTC.csv']);
    expect(new TextDecoder().decode(files.get('catalog.json'))).toBe('{"x":1}');
  });

  test('bounds ZIP inflation before hashing when declared plain size is forged', async () => {
    const bytes = zip([['VOLTEX_History20_Claude_20261018/catalog.json', 'X'.repeat(128 * 1024), 'deflate']]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // One stored local record followed directly by its central-directory header.
    const central = 30 + view.getUint16(26, true) + view.getUint32(18, true);
    expect(view.getUint32(central, true)).toBe(0x02014b50);
    view.setUint32(central + 24, 16, true); // lies about actual 128 KiB payload
    await expect(readZipEntries(bytes, () => true)).rejects.toThrow('Размер распакованного файла');
    const importer = readFileSync(resolve(__dirname, '../../pages/admin/historicalGrowthPack.ts'), 'utf8');
    expect(importer).not.toContain('new Response(stream).arrayBuffer()');
  });

  test('refuses an unsafe path and a catalogue that is not the committed one', async () => {
    await expect(readZipEntries(zip([['../evil/catalog.json', '{}', 'store']]), () => true)).rejects.toThrow('Небезопасный путь');
    const forged = new Map([['catalog.json', new TextEncoder().encode('{"scenarios":[]}')]]);
    await expect(importHistory20(forged)).rejects.toThrow('SHA-256 не совпадает');
  });
});

const ZIP = process.env.HISTORY20_ZIP ?? '';
// Register the licensed owner-pack test only when explicitly supplied.
// With a wrong local path it FAILS; without a private ZIP CI runs all feasible tests.
if (ZIP) {
  test('local only: the owner\'s ZIP imports all 20 windows, each reproducing normalized_path', async () => {
  expect(existsSync(ZIP)).toBe(true);
  const { records, report } = await importHistory20(packFiles(await readZipEntries(new Uint8Array(readFileSync(ZIP)), () => true)));
  expect(records.map(r => r.scenarioId)).toEqual(HISTORY20_ROTATION);
  expect(report.scenarios).toBe(20);
  expect(report.rows).toBe(8637);
  expect(report.maxParityRelError).toBeLessThan(1e-7);
  // Only ln(P/A) is kept: no source price or volume text survives the import.
  expect(JSON.stringify(records)).not.toMatch(/258\.009398|960664\.24|normalized_path/);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report));
});
}
