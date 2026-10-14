import { useRef, useState, type ChangeEvent } from 'react';
import { importHistoricalCsv, type HistoricalClip, type HistoricalProgram, type HistoricalSource } from './listingHistoricalImport';
import { ListingHistoricalLibrary } from './ListingHistoricalLibrary';

/**
 * Draft-only historical continuation after the final programmed pullback.
 * A user-supplied CSV is not evidence of rights: server refuses publication.
 */
export function ListingHistoricalEditor({ program, onChange }: {
  program: HistoricalProgram;
  onChange: (next: HistoricalProgram) => void;
}) {
  const [source,setSource] = useState<HistoricalSource>('BTC/USDT');
  const [startDateUtc,setStartDateUtc] = useState('');
  const [hours,setHours] = useState<'all'|'24'|'168'|'720'|'2160'>('2160');
  const [error,setError] = useState<string|null>(null);
  const [busy,setBusy] = useState(false);
  const loadId=useRef(0);
  /** One invariant for direct CSV imports and previously saved library presets. */
  function appendClip(clip: HistoricalClip) {
    if(program.clips.length>=3)throw Error('Максимум три последовательных исторических отрезка');
    const next:HistoricalProgram={version:1,clips:[...program.clips,clip]};
    const count=next.clips.reduce((n,c)=>n+c.bars.length,0);
    if(count>4800)throw Error('Максимум 4800 часов без ускорения');
    if(new TextEncoder().encode(JSON.stringify(next)).byteLength>65*1024)
      throw Error('Отрезки превышают допустимый размер. Загрузите более короткий период.');
    onChange(next);
  }
  async function upload(event:ChangeEvent<HTMLInputElement>) {
    const file=event.target.files?.[0];
    event.target.value='';
    if(!file)return;
    if(file.size>3*1024*1024){setError('CSV больше 3 МБ');return;}
    if(program.clips.length>=3){setError('Максимум три последовательных исторических отрезка');return;}
    const run=++loadId.current;
    setBusy(true);setError(null);
    try {
      const clip=importHistoricalCsv(await file.text(),source,{
        ...(startDateUtc ? {startDateUtc} : {}),
        ...(hours === 'all' ? {} : {hours:Number(hours) as 24|168|720|2160}),
      });
      if(run!==loadId.current)return;
      appendClip(clip);
    }catch(e) {
      if(run===loadId.current)setError(e instanceof Error?e.message:'Не удалось проверить CSV');
    }finally {if(run===loadId.current)setBusy(false);}
  }
  const total=program.clips.reduce((n,clip)=>n+clip.bars.length,0);
  return <div className="listing-historical-editor" data-historical-editor>
    <h3>Историческая модель движения</h3>
    <p className="listing-hint">После завершения заданного роста <strong>и заключительного отката</strong> цена повторяет относительные движения выбранного исторического актива. 1 час источника = 1 реальный час VOLTEX. Ускорения нет, исходные цены и объёмы не переносятся.</p>
    <p className="listing-hint" role="status">Только черновик и закрытый предпросмотр. Источники и права на публикацию НЕ подтверждены. Публикация этого режима запрещена сервером.</p>
    <div className="listing-grid">
      <label>Исторический источник<select value={source} data-field="historicalSource" onChange={e=>setSource(e.target.value as HistoricalSource)}>
        <option value="BTC/USDT">Bitcoin (BTC)</option>
        <option value="ETH/USDT">Ethereum (ETH)</option>
        <option value="SOL/USDT">Solana (SOL)</option>
      </select><small>Название источника указывается вручную; достоверность CSV автоматически не подтверждается.</small></label>
      <label>Начало исторического отрезка, UTC<input type="date" data-field="historicalStartDate" value={startDateUtc} disabled={busy} onChange={e=>setStartDateUtc(e.target.value)} />
        <small>Оставьте пустым, чтобы выбрать с первой свечи CSV.</small></label>
      <label>Продолжительность<select data-field="historicalDuration" value={hours} onChange={e=>setHours(e.target.value as typeof hours)} disabled={busy}>
        <option value="24">1 день (24 часа)</option>
        <option value="168">7 дней</option>
        <option value="720">30 дней</option>
        <option value="2160">90 дней — примерно 3 месяца</option>
        <option value="all">Весь файл до 100 дней</option>
      </select><small>Каждый исходный час остаётся одним реальным часом симуляции.</small></label>
      <label>Файл с историческими часовыми свечами<input type="file" accept=".csv,text/csv,text/plain" data-field="historicalCsv" disabled={busy} onChange={e=>{void upload(e);}} />
        <small>UTC: timestamp,open,high,low,close[,volume,trades]. До 3 МБ / 12 000 часов; сохранится только выбранный фрагмент.</small></label>
    </div>
    <ListingHistoricalLibrary source={source} startDateUtc={startDateUtc} hours={hours}
      clipCount={program.clips.length} onAdd={appendClip} />
    {busy&&<p role="status">Проверка файла…</p>}
    {error&&<p role="alert" className="listing-error">{error}</p>}
    {program.clips.length===0?<p className="listing-hint">Исторические фрагменты ещё не загружены. Без них черновик нельзя сохранить в этом режиме.</p>:
      <div role="list" data-historical-clips>
        {program.clips.map((clip,i)=>{
          const from=Date.parse(clip.sourceStart);
          const to=from+clip.bars.length*3_600_000;
          return <div role="listitem" key={i} className="listing-historical-clip">
            <span><strong>{i+1}. {clip.source}</strong> · {new Date(from).toISOString().slice(0,16).replace('T',' ')} — {new Date(to).toISOString().slice(0,16).replace('T',' ')} UTC · {clip.bars.length} часов</span>
            <button type="button" onClick={()=>{loadId.current++;onChange({version:1,clips:program.clips.filter((_,idx)=>idx!==i)});setError(null);}} data-remove-historical-clip={i}>Удалить</button>
          </div>;
        })}
      </div>}
    <p className="listing-hint">Всего {total} исторических часов; затем — нейтральный модельный диапазон без возврата к начальной цене. Добавление отрезка ETH после BTC продолжает движение с последней цены BTC без скачка.</p>
    <p className="listing-hint">Почасовые High/Low известны, но их порядок внутри часа неизвестен. Десятисекундные тики и модельные объёмы достраиваются детерминированно, не выдаются за настоящие исторические сделки.</p>
  </div>;
}
