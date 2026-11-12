import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { endianness } from 'os';
import { join } from 'path';
import catalog from '../../shared/history20Regimes.json';
import { History20MinuteReplay, REGIME_MINUTES } from '../../shared/history20MinuteReplay';
import { testMarketCandles } from '../testMarkets/testMarketService';
import type { TestAssetConfig } from '../testMarkets/testAssetConfig';
import { ListingValidationError } from './listingConfig';

export const regimeOptions = catalog.records.map(
  ({ id, title, pair, start, endExclusive, sourceFrame, rows, sha256 }) => ({
    id,
    title,
    pair,
    start,
    endExclusive,
    sourceFrame,
    rows,
    sha256,
  }),
);

/** Only an explicitly mounted offline private pack opts the admin API in.
 * Verify the ENTIRE pinned rotation before offering even the first scenario. */
export function loadRegimePack(dir: string) {
  const pack = new Map<string, History20MinuteReplay>();
  for (const record of catalog.records) {
    const bytes = readFileSync(join(dir, record.sha256 + '.bin'));
    if (
      bytes.length !== record.rows * 40 ||
      createHash('sha256').update(bytes).digest('hex') !== record.sha256
    )
      throw Error('History20 digest mismatch: ' + record.id);
    const values =
      endianness() === 'LE' && bytes.byteOffset % 8 === 0
        ? new Float64Array(bytes.buffer, bytes.byteOffset, record.rows * 5)
        : Float64Array.from({ length: record.rows * 5 }, (_, i) => bytes.readDoubleLE(i * 8));
    pack.set(record.id, new History20MinuteReplay(values));
  }
  return pack;
}
let installed: { directory: string; pack: ReturnType<typeof loadRegimePack> } | undefined;
export function privateRegimes() {
  const dir = process.env.HISTORY20_PRIVATE_REGIME_DIR;
  if (!dir || process.env.NODE_ENV === 'production') return undefined;
  if (installed?.directory !== dir) installed = { directory: dir, pack: loadRegimePack(dir) };
  return installed.pack;
}
export function regimeCandles(asset: TestAssetConfig, interval: string, at: number, limit = 160) {
  const engine = privateRegimes()?.get(asset.history20Regime ?? '');
  if (!engine)
    throw new ListingValidationError('REGIME_PACK_UNAVAILABLE', 'Проверенный приватный набор не подключён');
  if (
    asset.history20RegimeSha256 !==
    regimeOptions.find((record) => record.id === asset.history20Regime)?.sha256
  )
    throw new ListingValidationError(
      'REGIME_DIGEST_MISMATCH',
      'Контрольная сумма сохранённого сценария не совпадает',
    );
  if (!Object.prototype.hasOwnProperty.call(REGIME_MINUTES, interval))
    throw new ListingValidationError('INVALID_INTERVAL', 'Недопустимый интервал');
  return testMarketCandles(asset, interval, at, limit, engine);
}
