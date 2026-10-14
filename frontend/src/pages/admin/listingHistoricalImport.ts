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

export function importHistoricalCsv(text: string, source: HistoricalSource): HistoricalClip {
  if (!['BTC/USDT','ETH/USDT','SOL/USDT'].includes(source)) throw Error('Неверный источник');
  if (new TextEncoder().encode(text).byteLength > 512*1024) throw Error('CSV слишком большой (максимум 512 КБ)');
  const rows = text.replace(/^\uFEFF/,'').trim().split(/\r?\n/);
  if (/^timestamp\s*,\s*open\s*,\s*high\s*,\s*low\s*,\s*close/i.test(rows[0] ?? '')) rows.shift();
  if (rows.length < 24 || rows.length > 2400) throw Error('Нужны 24–2400 последовательных часовых свечей');
  let first = '', previousTime = -1, previousClose = 0;
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
    if (i===0) first=new Date(at).toISOString();
    previousTime=at;previousClose=close;
  }
  return {source,sourceStart:first,resolution:'1h',provenance:'USER_SUPPLIED_UNVERIFIED',bars};
}
