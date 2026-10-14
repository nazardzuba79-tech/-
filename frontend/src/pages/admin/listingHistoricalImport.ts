/** Browser-side CSV importer. Production frontend builds from frontend/ alone;
 * the backend has its own strict validator in src/shared/listingHistoricalReplay.ts.
 * Only signed PPM MOVEMENTS persist in drafts; never original BTC/ETH prices.
 */
export type HistoricalSource = 'BTC/USDT' | 'ETH/USDT' | 'SOL/USDT';
export interface HistoricalClip {
  source: HistoricalSource;
  sourceStart: string;
  resolution: '1h';
  provenance: 'USER_SUPPLIED_UNVERIFIED';
  bars: [number,number,number][];
}
export interface HistoricalProgram { version:1; clips:HistoricalClip[]; }

export interface HistoricalCsvSelection {
  /** Date at 00:00 UTC. The selected candle must actually exist in the CSV. */
  startDateUtc?: string;
  /** 24, 168, 720 or 2160 real hours; no acceleration/compression of time. */
  hours?: 24 | 168 | 720 | 2160;
}
export function importHistoricalCsv(text: string, source: HistoricalSource, selection: HistoricalCsvSelection = {}): HistoricalClip {
  if (!['BTC/USDT','ETH/USDT','SOL/USDT'].includes(source)) throw Error('Неверный источник');
  if (new TextEncoder().encode(text).byteLength > 3*1024*1024) throw Error('CSV больше 3 МБ');
  const rows = text.replace(/^\uFEFF/,'').trim().split(/\r?\n/);
  if (/^timestamp\s*,\s*open\s*,\s*high\s*,\s*low\s*,\s*close/i.test(rows[0] ?? '')) rows.shift();
  if (rows.length < 24 || rows.length > 12000) throw Error('Исходный файл: 24–12000 последовательных часовых свечей');
  let first = '', firstMs=0, previousTime = -1, previousClose = 0;
  const bars: [number,number,number][] = [];
  for (let i=0;i<rows.length;i++){
    const parts = rows[i].trim().split(',');
    if (parts.length < 5 || parts.length > 7) throw Error('Неверная строка CSV № '+(i+1));
    const stamp=parts[0].trim();
    let at: number;
    if (/^\d{10}$/.test(stamp)) at=Number(stamp)*1000;
    else if (/^\d{13}$/.test(stamp)) at=Number(stamp);
    else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.000)?Z$/.test(stamp)) at=Date.parse(stamp);
    else throw Error('Неверная дата UTC в строке '+(i+1));
    if (!Number.isSafeInteger(at) || at%3600000!==0 || (i>0 && at!==previousTime+3600000))
      throw Error('Пропущенный или нечасовой интервал в строке '+(i+1));
    const [open,high,low,close] = parts.slice(1,5).map(v=>Number(v.trim()));
    if (![open,high,low,close].every(v=>Number.isFinite(v)&&v>0)
        || high<Math.max(open,close)||low>Math.min(open,close))
      throw Error('Некорректные значения OHLC в строке '+(i+1));
    if (i>0 && Math.abs(open/previousClose-1)>0.005) throw Error('Разрыв цены в строке '+(i+1));
    const h=Math.max(0,Math.ceil((high/open-1)*1000000-1e-8));
    const l=Math.min(0,Math.floor((low/open-1)*1000000+1e-8));
    const c=Math.round((close/open-1)*1000000);
    if (l<=-1000000 || h>4000000 || c<=-1000000 || c>4000000)
      throw Error('Свеча выходит за допустимый диапазон в строке '+(i+1));
    bars.push([Math.max(h,c),Math.min(l,c),c]);
    if (i===0) { first=new Date(at).toISOString();firstMs=at; }
    previousTime=at;previousClose=close;
  }
  let offset=0;
  if(selection.startDateUtc) {
    if(!/^\d{4}-\d\d-\d\d$/.test(selection.startDateUtc))
      throw Error('Выберите дату в формате ГГГГ-ММ-ДД');
    const startMs=Date.parse(selection.startDateUtc+'T00:00:00.000Z');
    if(!Number.isFinite(startMs)||new Date(startMs).toISOString().slice(0,10)!==selection.startDateUtc)
      throw Error('Указана несуществующая дата');
    offset=(startMs-firstMs)/3600000;
    if(!Number.isSafeInteger(offset)||offset<0||offset>=bars.length)
      throw Error('Выбранная дата не входит в исходную историю');
  }
  const end=selection.hours?offset+selection.hours:bars.length;
  const selected=bars.slice(offset,end);
  if(selected.length<24 ||selected.length>2400 || (selection.hours && selected.length!==selection.hours))
    throw Error('Выбранный период отсутствует полностью либо длиннее 100 дней');
  first=new Date(firstMs+offset*3600000).toISOString();
  return {source,sourceStart:first,resolution:'1h',provenance:'USER_SUPPLIED_UNVERIFIED',bars:selected};
}
