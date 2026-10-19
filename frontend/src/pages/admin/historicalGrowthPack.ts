/**
 * Import of the owner's History20 pack on THIS device, for the admin's private
 * preview only. The ZIP (or its extracted folder) is read in the browser;
 * nothing is uploaded. Every file used is checked against the SHA-256 the
 * repository carries (historicalGrowthCatalog.ts), every window is rebuilt
 * from its source CSV and must reproduce the pack's normalized_path. Only
 * ln(P/A) values are kept (IndexedDB); the source prices and volume are not.
 *
 * A hash proves which file this is, not who may use it: the sources are
 * CC BY-NC / CC BY-NC-SA + Binance Vision Dataset Terms, publication stays
 * blocked (HISTORICAL_RIGHTS_UNVERIFIED).
 */
import { HISTORY20_CATALOG, HISTORY20_PACK, type HistoricalGrowthCatalogItem } from './historicalGrowthCatalog';
import { buildHistoricalGrowthProgram, historicalGrowthParity, historicalGrowthProblem, parseHistoricalGrowthCsv, type HistoricalGrowthProgram } from './historicalGrowthModel';

export const HISTORY20_MAX_ZIP_BYTES = 32 * 1024 * 1024;
export const HISTORY20_MAX_ENTRY_BYTES = 4 * 1024 * 1024;
/** The import refuses a rebuilt window farther than this from the pack's normalized_path. */
export const HISTORY20_PARITY_LIMIT = 1e-7;
const DB_NAME = 'voltex.admin.historical-growth.v1';
const STORE = 'windows';
const PACK_DIR = HISTORY20_PACK.name + '/';

export interface HistoricalGrowthWindowRecord {
  version: 1;
  scenarioId: string;
  program: HistoricalGrowthProgram;
  /** Largest relative difference to the pack's normalized_path (P0 = 1). */
  parityMaxRelError: number;
  scenarioFileSha256: string;
  catalogSha256: string;
  importedAt: string;
}
export interface History20ImportReport {
  scenarios: number; rows: number; filesVerified: number; maxParityRelError: number; storedBytes: number;
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Нужен защищённый браузер с поддержкой SHA-256');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

async function inflateRaw(bytes: Uint8Array, expected: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('Браузер не умеет распаковывать ZIP: выберите распакованную папку пакета');
  // ZIP's declared uncompressed size is untrusted: do NOT buffer the whole
  // stream before checking it. An attacker could advertise 1 KB but inflate
  // several GB in an admin browser, before file hashes are checked.
  if (!Number.isSafeInteger(expected) || expected > HISTORY20_MAX_ENTRY_BYTES) throw new Error('Файл в архиве слишком большой');
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > expected || total > HISTORY20_MAX_ENTRY_BYTES) throw new Error('Размер распакованного файла не совпадает с ZIP');
      chunks.push(value);
    }
    if (total !== expected) throw new Error('Размер распакованного файла не совпадает с ZIP');
    const result = new Uint8Array(total);
    let cursor = 0;
    for (const chunk of chunks) { result.set(chunk, cursor); cursor += chunk.byteLength; }
    return result;
  } finally {
    // Stop remaining decompression on a dishonest size, regardless of hash.
    try { await reader.cancel(); } catch { /* stream already closed or errored */ }
    reader.releaseLock();
  }
}

/** Minimal ZIP reader (stored/deflate, no ZIP64, no encryption) for the entries `wanted` accepts. */
export async function readZipEntries(zip: Uint8Array, wanted: (name: string) => boolean): Promise<Map<string, Uint8Array>> {
  if (zip.length > HISTORY20_MAX_ZIP_BYTES) throw new Error('Архив больше 32 МБ');
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65_535); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('Это не ZIP-архив пакета');
  const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), offset = view.getUint32(end + 16, true);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff || offset + size > end) throw new Error('ZIP64 и повреждённые архивы не поддерживаются');
  const out = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  for (let i = 0, at = offset; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('Повреждённый каталог ZIP');
    const flags = view.getUint16(at + 8, true), method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true), plain = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true), extra = view.getUint16(at + 30, true), comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(zip.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extra + comment;
    if (name.endsWith('/') || !wanted(name)) continue;
    if (name.startsWith('/') || name.split('/').includes('..') || name.includes('\\')) throw new Error('Небезопасный путь в архиве: ' + name);
    if (flags & 1) throw new Error('Зашифрованные архивы не поддерживаются');
    if (plain > HISTORY20_MAX_ENTRY_BYTES) throw new Error('Файл в архиве слишком большой: ' + name);
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error('Повреждённый файл в ZIP: ' + name);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = zip.subarray(start, start + compressed);
    if (data.length !== compressed) throw new Error('Обрезанный ZIP: ' + name);
    out.set(name, method === 0 ? (compressed === plain ? data.slice() : (() => { throw new Error('Повреждённый файл в ZIP: ' + name); })())
      : method === 8 ? await inflateRaw(data, plain) : (() => { throw new Error('Неподдерживаемое сжатие в ZIP: ' + name); })());
  }
  return out;
}

const needed = (name: string) => /(^|\/)VOLTEX_History20_Claude_20261018\/(catalog\.json|data\/source\/VHX-\d{2}-[A-Z0-9]+\.csv|data\/scenarios\/VHX-\d{2}-[A-Z0-9]+\.json)$/.test(name);

/** The files the import reads, keyed by their path inside the pack folder (whatever the ZIP's top folder). */
export function packFiles(entries: Map<string, Uint8Array>): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const [name, bytes] of entries) {
    const at = name.lastIndexOf(PACK_DIR);
    if (at >= 0 && needed(name)) out.set(name.slice(at + PACK_DIR.length), bytes);
  }
  return out;
}

async function verifiedText(files: Map<string, Uint8Array>, path: string, sha256: string): Promise<string> {
  const bytes = files.get(path);
  if (!bytes) throw new Error('В пакете нет файла ' + path);
  if (await sha256Bytes(bytes) !== sha256) throw new Error('SHA-256 не совпадает: ' + path);
  return new TextDecoder().decode(bytes);
}

function sourceOf(item: HistoricalGrowthCatalogItem) {
  return { provider: item.provider, asset: item.asset, quote: item.quote, metric: item.metric, dataKind: item.dataKind, timeframe: '1d' as const,
    sliceSha256: item.sourceSliceSha256, license: item.license };
}

/**
 * Verify and rebuild all 20 windows. Refuses the whole pack on any mismatch:
 * a different catalogue, a file whose hash is not the committed one, a
 * scenario flagged for release, a gap, invalid OHLC or a rebuilt path that
 * does not reproduce normalized_path.
 */
export async function importHistory20(files: Map<string, Uint8Array>, now = new Date()): Promise<{ records: HistoricalGrowthWindowRecord[]; report: History20ImportReport }> {
  const catalog = JSON.parse(await verifiedText(files, 'catalog.json', HISTORY20_PACK.catalogSha256));
  const ids = Array.isArray(catalog?.scenarios) ? catalog.scenarios.map((s: { id?: unknown }) => s.id) : [];
  if (catalog.all_20_data_verified !== true || catalog.release_allowed !== false || JSON.stringify(ids) !== JSON.stringify(HISTORY20_CATALOG.map(i => i.id)))
    throw new Error('Каталог пакета не совпадает с ожидаемыми 20 сценариями');
  const records: HistoricalGrowthWindowRecord[] = [];
  let rows = 0, worst = 0, verified = 1;
  for (const item of HISTORY20_CATALOG) {
    const csv = await verifiedText(files, `data/source/${item.id}.csv`, item.sourceSliceSha256);
    const scenario = JSON.parse(await verifiedText(files, `data/scenarios/${item.id}.json`, item.scenarioFileSha256));
    verified += 2;
    if (scenario.id !== item.id || scenario.public_publish_allowed !== false || scenario.real_money_trading_allowed !== false
        || scenario.source_volume_in_simulator !== false || Number(scenario.target_peak_growth_pct) !== Number(item.targetPeakGrowthPercent)
        || scenario.clock?.default !== 'REAL_TIME' || scenario.clock?.source_step_seconds !== 86400)
      throw new Error('Сценарий не соответствует каталогу: ' + item.id);
    const program = buildHistoricalGrowthProgram({ scenarioId: item.id, source: sourceOf(item), targetPeakGrowthPercent: item.targetPeakGrowthPercent,
      rows: parseHistoricalGrowthCsv(csv, item.dataKind) });
    if (program.logs.length !== item.rows || program.source.firstDate !== item.windowStart || program.source.lastDate !== item.windowEnd)
      throw new Error('Окно источника не соответствует каталогу: ' + item.id);
    const parity = historicalGrowthParity(program, scenario.normalized_path);
    if (!(parity <= HISTORY20_PARITY_LIMIT)) throw new Error(`Траектория ${item.id} не воспроизводит normalized_path пакета`);
    worst = Math.max(worst, parity); rows += program.logs.length;
    records.push({ version: 1, scenarioId: item.id, program, parityMaxRelError: parity, scenarioFileSha256: item.scenarioFileSha256,
      catalogSha256: HISTORY20_PACK.catalogSha256, importedAt: now.toISOString() });
  }
  return { records, report: { scenarios: records.length, rows, filesVerified: verified, maxParityRelError: worst,
    storedBytes: new TextEncoder().encode(JSON.stringify(records)).byteLength } };
}

/** Read a ZIP or the files of an extracted folder (webkitRelativePath) and import them. */
export async function importHistory20FromFiles(selected: readonly File[]) {
  if (selected.length === 1 && /\.zip$/i.test(selected[0].name)) {
    if (selected[0].size > HISTORY20_MAX_ZIP_BYTES) throw new Error('Архив больше 32 МБ');
    return importHistory20(packFiles(await readZipEntries(new Uint8Array(await selected[0].arrayBuffer()), needed)));
  }
  const entries = new Map<string, Uint8Array>();
  for (const file of selected) {
    const name = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    if (!needed(name)) continue;
    if (file.size > HISTORY20_MAX_ENTRY_BYTES) throw new Error('Файл слишком большой: ' + name);
    entries.set(name, new Uint8Array(await file.arrayBuffer()));
  }
  return importHistory20(packFiles(entries));
}

/** A stored record is used only if it is still the committed scenario and its logs pass the checksum. */
export function verifyHistoricalGrowthRecord(record: HistoricalGrowthWindowRecord): void {
  const item = HISTORY20_CATALOG.find(i => i.id === record?.scenarioId);
  if (!item || record.version !== 1 || record.catalogSha256 !== HISTORY20_PACK.catalogSha256 || record.scenarioFileSha256 !== item.scenarioFileSha256
      || record.program?.scenarioId !== item.id || record.program.targetPeakGrowthPercent !== item.targetPeakGrowthPercent
      || record.program.source.sliceSha256 !== item.sourceSliceSha256 || !(record.parityMaxRelError <= HISTORY20_PARITY_LIMIT))
    throw new Error('Локальное окно не соответствует каталогу');
  const problem = historicalGrowthProblem(record.program);
  if (problem) throw new Error(problem);
}

// No module initialization side-effects or browser storage access on import.
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Локальная библиотека недоступна в этом браузере')); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'scenarioId' }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Не удалось открыть хранилище исторических окон'));
    request.onblocked = () => reject(new Error('Хранилище занято другой вкладкой'));
  });
}
async function transact<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore, accept: (value: T) => void, reject: (error: Error) => void) => void): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    let value: T, settled = false;
    const fail = (e: Error) => { if (!settled) { settled = true; db.close(); reject(e); } };
    try {
      const tx = db.transaction(STORE, mode);
      tx.oncomplete = () => { if (!settled) { settled = true; db.close(); resolve(value); } };
      tx.onabort = () => fail(new Error('Операция с локальными окнами отменена'));
      tx.onerror = () => fail(new Error('Ошибка локального хранилища'));
      op(tx.objectStore(STORE), v => { value = v; }, fail);
    } catch { fail(new Error('Локальная библиотека недоступна')); }
  });
}

export async function listHistoricalGrowthWindows(): Promise<HistoricalGrowthWindowRecord[]> {
  const records = await transact<HistoricalGrowthWindowRecord[]>('readonly', (store, accept, reject) => {
    const request = store.getAll();
    request.onsuccess = () => accept(request.result as HistoricalGrowthWindowRecord[]);
    request.onerror = () => reject(new Error('Не удалось прочитать локальные окна'));
  });
  // Verified after the transaction: a damaged record never reaches a card or a draft.
  return records.filter(record => { try { verifyHistoricalGrowthRecord(record); return true; } catch { return false; } });
}

export async function saveHistoricalGrowthWindows(records: readonly HistoricalGrowthWindowRecord[]): Promise<void> {
  for (const record of records) verifyHistoricalGrowthRecord(record);
  await transact<void>('readwrite', (store, accept, reject) => {
    let left = records.length;
    if (!left) { accept(undefined); return; }
    for (const record of records) {
      const put = store.put(record);
      put.onsuccess = () => { if (--left === 0) accept(undefined); };
      put.onerror = () => reject(new Error('Не удалось сохранить окна; проверьте свободное место'));
    }
  });
}

export async function clearHistoricalGrowthWindows(): Promise<void> {
  await transact<void>('readwrite', (store, accept, reject) => {
    const request = store.clear();
    request.onsuccess = () => accept(undefined);
    request.onerror = () => reject(new Error('Не удалось очистить локальные окна'));
  });
}
