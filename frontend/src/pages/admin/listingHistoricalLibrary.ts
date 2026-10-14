/**
 * Local historical-movement catalogue for the admin's PRIVATE preview only.
 *
 * Import original operator-provided hourly CSV once and reuse 1/7/30/90-day
 * excerpts across multiple listing drafts. No API/network requests, server
 * storage, licensing inference, financial ledgers or automatic publication.
 * A SHA-256 detects changes to LOCAL cached bytes, not source authenticity.
 */
import { importHistoricalCsv, type HistoricalSource, type HistoricalClip, type HistoricalCsvSelection } from './listingHistoricalImport';

export const HISTORICAL_ARCHIVE_MAX_ITEMS = 8;
export const HISTORICAL_ARCHIVE_MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const DB_NAME = 'voltex.admin.historical-archives.v1';
const STORE = 'archives';
const HOUR = 3_600_000;
const SOURCES: readonly HistoricalSource[] = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];

export interface HistoricalArchive {
  version: 1;
  id: string;
  source: HistoricalSource;
  name: string;
  firstHour: string;
  endExclusive: string;
  hours: number;
  byteLength: number;
  sha256: string;
  /** Only local IndexedDB retains original OHLC text. Never send this to listings API. */
  csv: string;
  provenance: 'USER_SUPPLIED_UNVERIFIED';
}

export interface HistoricalPreset {
  id: string;
  label: string;
  source: HistoricalSource;
  startDateUtc: string;
  hours: 2160;
}
/** Suggested dates, NOT bundled price data. Entries become selectable after a matching import. */
export const HISTORICAL_PRESETS: readonly HistoricalPreset[] = [
  { id:'btc-2018-jan', label:'Bitcoin · январь—март 2018', source:'BTC/USDT', startDateUtc:'2018-01-01', hours:2160 },
  { id:'btc-2018-apr', label:'Bitcoin · апрель—июнь 2018', source:'BTC/USDT', startDateUtc:'2018-04-01', hours:2160 },
  { id:'btc-2018-oct', label:'Bitcoin · октябрь—декабрь 2018', source:'BTC/USDT', startDateUtc:'2018-10-01', hours:2160 },
  { id:'eth-2021-jan', label:'Ethereum · январь—март 2021', source:'ETH/USDT', startDateUtc:'2021-01-01', hours:2160 },
  { id:'eth-2021-apr', label:'Ethereum · апрель—июнь 2021', source:'ETH/USDT', startDateUtc:'2021-04-01', hours:2160 },
  { id:'eth-2021-oct', label:'Ethereum · октябрь—декабрь 2021', source:'ETH/USDT', startDateUtc:'2021-10-01', hours:2160 },
  { id:'sol-2022-jan', label:'Solana · январь—март 2022', source:'SOL/USDT', startDateUtc:'2022-01-01', hours:2160 },
  { id:'sol-2022-apr', label:'Solana · апрель—июнь 2022', source:'SOL/USDT', startDateUtc:'2022-04-01', hours:2160 },
] as const;

function rawRows(text: string): string[] {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (/^timestamp\s*,\s*open\s*,\s*high\s*,\s*low\s*,\s*close/i.test(lines[0] || '')) lines.shift();
  return lines;
}

/** Strict inspection: importHistoricalCsv validates ALL rows, not just first 24. */
export function historicalArchiveInfo(csv: string, source: HistoricalSource): Pick<HistoricalArchive,'firstHour'|'endExclusive'|'hours'|'byteLength'> {
  const byteLength = new TextEncoder().encode(csv).byteLength;
  if (byteLength > 3 * 1024 * 1024) throw new Error('Исторический архив превышает 3 МБ');
  const preview = importHistoricalCsv(csv, source, {hours:24});
  const hours = rawRows(csv).length;
  const start = Date.parse(preview.sourceStart);
  return { firstHour: preview.sourceStart, endExclusive: new Date(start + hours * HOUR).toISOString(), hours, byteLength };
}

export function coversHistoricalSelection(archive: Pick<HistoricalArchive,'source'|'firstHour'|'endExclusive'>, source: HistoricalSource, startDateUtc: string, hours: number): boolean {
  if (archive.source !== source || !Number.isSafeInteger(hours) || hours < 24 || hours > 2400
      || !/^\d{4}-\d{2}-\d{2}$/.test(startDateUtc)) return false;
  const start = Date.parse(startDateUtc + 'T00:00:00.000Z');
  if (!Number.isFinite(start) || new Date(start).toISOString().slice(0,10) !== startDateUtc) return false;
  return start >= Date.parse(archive.firstHour) && start + hours * HOUR <= Date.parse(archive.endExclusive);
}

export function archiveSelection(archive: HistoricalArchive, selection: HistoricalCsvSelection): HistoricalClip {
  if (!SOURCES.includes(archive.source) || archive.provenance !== 'USER_SUPPLIED_UNVERIFIED') throw new Error('Неизвестный локальный архив');
  return importHistoricalCsv(archive.csv, archive.source, selection);
}

export async function sha256Text(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Нужен защищённый браузер с поддержкой SHA-256');
  const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

export async function prepareHistoricalArchive(csv: string, source: HistoricalSource, fileName: string): Promise<HistoricalArchive> {
  if (!SOURCES.includes(source)) throw new Error('Неизвестный источник исторических свечей');
  const meta = historicalArchiveInfo(csv, source);
  const sha256 = await sha256Text(csv);
  return {
    version:1, id:source.replace('/','-') + ':' + sha256,
    source, name:fileName.slice(0,120).replace(/[\u0000-\u001f]/g, ''),
    ...meta,sha256,csv,provenance:'USER_SUPPLIED_UNVERIFIED',
  };
}

export async function verifyHistoricalArchive(archive: HistoricalArchive): Promise<void> {
  if (!archive || archive.version !== 1 || !SOURCES.includes(archive.source)
      || archive.provenance !== 'USER_SUPPLIED_UNVERIFIED'
      || !/^[a-f0-9]{64}$/.test(archive.sha256)
      || archive.id !== archive.source.replace('/','-') + ':' + archive.sha256)
    throw new Error('Локальный архив повреждён');
  const info = historicalArchiveInfo(archive.csv,archive.source);
  if (info.firstHour !== archive.firstHour || info.endExclusive !== archive.endExclusive
      || info.hours !== archive.hours || info.byteLength !== archive.byteLength
      || await sha256Text(archive.csv) !== archive.sha256)
    throw new Error('Контрольная сумма локального архива не совпадает');
}

// No module initialization side-effects or browser storage access on import.
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve,reject) => {
    if (typeof indexedDB === 'undefined') {reject(new Error('Локальная библиотека недоступна в этом браузере'));return;}
    const request = indexedDB.open(DB_NAME,1);
    request.onupgradeneeded = () => {
      const db=request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE,{keyPath:'id'});
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Не удалось открыть хранилище исторических архивов'));
    request.onblocked = () => reject(new Error('Хранилище занято другой вкладкой'));
  });
}

async function transact<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore, accept: (value:T) => void, reject: (error: Error) => void) => void): Promise<T> {
  const db=await openDatabase();
  return new Promise((resolve,reject) => {
    let value:T, settled=false;
    const fail=(e:Error)=>{if(!settled){settled=true;db.close();reject(e);}};
    try {
      const tx=db.transaction(STORE,mode);
      tx.oncomplete=()=>{if(!settled){settled=true;db.close();resolve(value);}};
      tx.onabort=()=>fail(new Error('Операция с локальными архивами отменена'));
      tx.onerror=()=>fail(new Error('Ошибка локального хранилища'));
      op(tx.objectStore(STORE),v=>{value=v;},fail);
    } catch {fail(new Error('Локальная библиотека недоступна')); }
  });
}

export async function listHistoricalArchives(): Promise<HistoricalArchive[]> {
  return transact('readonly',(store,accept,reject)=>{
    const req=store.getAll();
    req.onsuccess=()=>accept((req.result as HistoricalArchive[]).sort((a,b)=>a.source.localeCompare(b.source)||a.firstHour.localeCompare(b.firstHour)));
    req.onerror=()=>reject(new Error('Не удалось прочитать локальные архивы'));
  });
}

export async function saveHistoricalArchive(record: HistoricalArchive): Promise<void> {
  await verifyHistoricalArchive(record);
  await transact<void>('readwrite',(store,accept,reject)=>{
    const get=store.getAll();
    get.onsuccess=()=>{
      const old=get.result as HistoricalArchive[];
      const others=old.filter(x=>x.id!==record.id);
      if(others.length >= HISTORICAL_ARCHIVE_MAX_ITEMS ||
          others.reduce((sum,x)=>sum+x.byteLength,record.byteLength)>HISTORICAL_ARCHIVE_MAX_TOTAL_BYTES){
        reject(new Error('Локальная библиотека заполнена: удалите ненужные архивы'));return;
      }
      const put=store.put(record);
      put.onsuccess=()=>accept(undefined);
      put.onerror=()=>reject(new Error('Не удалось сохранить архив; проверьте свободное место'));
    };
    get.onerror=()=>reject(new Error('Не удалось проверить свободное место'));
  });
}

export async function loadHistoricalArchive(id: string): Promise<HistoricalArchive> {
  const found=await transact<HistoricalArchive|undefined>('readonly',(store,accept,reject)=>{
    const req=store.get(id);
    req.onsuccess=()=>accept(req.result as HistoricalArchive|undefined);
    req.onerror=()=>reject(new Error('Не удалось прочитать архив'));
  });
  if (!found) throw new Error('Архив не найден на этом устройстве');
  await verifyHistoricalArchive(found);
  return found;
}

export async function deleteHistoricalArchive(id: string): Promise<void> {
  await transact<void>('readwrite',(store,accept,reject)=>{
    const req=store.delete(id);
    req.onsuccess=()=>accept(undefined);
    req.onerror=()=>reject(new Error('Не удалось удалить локальный архив'));
  });
}
