/**
 * Local historical-movement catalogue for the admin's PRIVATE preview only.
 *
 * An operator can import CSV once and select 1/7/30/90-day movements later.
 * Raw source OHLC prices/volume are discarded after import; IndexedDB retains
 * only signed PPM moves. No network requests or public simulation publishing.
 * A SHA-256 checks cached MOVEMENTS, never the source's authenticity/license.
 */
import { parseHistoricalMovementCsv, selectHistoricalMovements, type HistoricalSource, type HistoricalClip, type HistoricalCsvSelection } from './listingHistoricalImport';

export const HISTORICAL_ARCHIVE_MAX_ITEMS = 8;
export const HISTORICAL_ARCHIVE_MAX_TOTAL_BYTES = 12 * 1024 * 1024;
// Never open the experimental v1 raw-CSV database: no production deployment used it.
const DB_NAME = 'voltex.admin.historical-movements.v2';
const STORE = 'archives';
const HOUR = 3_600_000;
const SOURCES: readonly HistoricalSource[] = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];

export interface HistoricalArchive {
  version: 2;
  id: string;
  source: HistoricalSource;
  name: string;
  firstHour: string;
  endExclusive: string;
  hours: number;
  /** Original uploaded CSV byte count, metadata only. Raw bytes are discarded. */
  byteLength: number;
  /** Actual size of encoded PPM movement array, used for local archive quota. */
  storedBytes: number;
  /** Source file SHA-256 as an unverified fingerprint; NOT re-verifiable from PPM. */
  sha256: string;
  /** SHA-256 of the locally stored relative movements; verified on every read. */
  movementDigest: string;
  /** Signed PPM, never the source's absolute OHLC prices or volume. */
  movements: [number,number,number][];
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

/** Validates ALL input CSV rows before reducing them to relative movements. */
export function historicalArchiveInfo(csv: string, source: HistoricalSource): Pick<HistoricalArchive,'firstHour'|'endExclusive'|'hours'|'byteLength'> {
  const byteLength = new TextEncoder().encode(csv).byteLength;
  if (byteLength > 3 * 1024 * 1024) throw new Error('Исторический архив превышает 3 МБ');
  const parsed = parseHistoricalMovementCsv(csv,source);
  const hours = parsed.bars.length, start = Date.parse(parsed.sourceStart);
  return { firstHour: parsed.sourceStart, endExclusive: new Date(start + hours * HOUR).toISOString(), hours, byteLength };
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
  return selectHistoricalMovements({sourceStart:archive.firstHour,bars:archive.movements}, archive.source, selection);
}

export async function sha256Text(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Нужен защищённый браузер с поддержкой SHA-256');
  const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

/** Parse once; source dollar prices and volume do not survive this function. */
export async function prepareHistoricalArchive(csv: string, source: HistoricalSource, fileName: string): Promise<HistoricalArchive> {
  if (!SOURCES.includes(source)) throw new Error('Неизвестный источник исторических свечей');
  const byteLength=new TextEncoder().encode(csv).byteLength;
  if(byteLength>3*1024*1024)throw new Error('Исторический архив превышает 3 МБ');
  const parsed=parseHistoricalMovementCsv(csv,source);
  const hours=parsed.bars.length, sourceStart=parsed.sourceStart;
  const movements=parsed.bars;
  const storedText=JSON.stringify(movements);
  const storedBytes=new TextEncoder().encode(storedText).byteLength;
  const [sha256,movementDigest]=await Promise.all([sha256Text(csv),sha256Text(storedText)]);
  return {
    version:2,id:source.replace('/','-')+':'+sha256,
    source,name:fileName.slice(0,120).replace(/[\u0000-\u001f]/g,''),
    firstHour:sourceStart,endExclusive:new Date(Date.parse(sourceStart)+hours*HOUR).toISOString(),
    hours,byteLength,storedBytes,sha256,movementDigest,movements,
    provenance:'USER_SUPPLIED_UNVERIFIED',
  };
}

export async function verifyHistoricalArchive(archive: HistoricalArchive): Promise<void> {
  if (!archive || archive.version !== 2 || !SOURCES.includes(archive.source)
      || archive.provenance !== 'USER_SUPPLIED_UNVERIFIED'
      || !/^[a-f0-9]{64}$/.test(archive.sha256)
      || !/^[a-f0-9]{64}$/.test(archive.movementDigest)
      || archive.id !== archive.source.replace('/','-') + ':' + archive.sha256
      || !Number.isSafeInteger(archive.byteLength) || archive.byteLength <= 0 || archive.byteLength > 3*1024*1024
      || !Number.isSafeInteger(archive.storedBytes) || archive.storedBytes <= 0
      || !Array.isArray(archive.movements) || archive.movements.length !== archive.hours
      || archive.hours < 24 || archive.hours > 12000
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/.test(archive.firstHour))
    throw new Error('Локальный архив повреждён');
  const start=Date.parse(archive.firstHour);
  if (!Number.isFinite(start)||new Date(start).toISOString() !== archive.firstHour
      || archive.endExclusive !== new Date(start+archive.hours*HOUR).toISOString())
    throw new Error('Неверные даты локального архива');
  for (const bar of archive.movements) {
    if (!Array.isArray(bar) || bar.length !== 3 || bar.some(v=>!Number.isSafeInteger(v))
        || bar[0] < Math.max(0,bar[2]) || bar[0]>4_000_000
        || bar[1]>Math.min(0,bar[2]) || bar[1]<=-1_000_000
        || bar[2]<=-1_000_000 || bar[2]>4_000_000)
      throw new Error('Локальный архив содержит некорректные движения');
  }
  const storedText=JSON.stringify(archive.movements);
  if (new TextEncoder().encode(storedText).byteLength!==archive.storedBytes
      || await sha256Text(storedText)!==archive.movementDigest)
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
          others.reduce((sum,x)=>sum+x.storedBytes,record.storedBytes)>HISTORICAL_ARCHIVE_MAX_TOTAL_BYTES){
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
