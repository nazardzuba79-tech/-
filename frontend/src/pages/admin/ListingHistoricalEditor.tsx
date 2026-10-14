import { useRef, useState, type ChangeEvent } from 'react';
import { importHistoricalCsv, type HistoricalProgram, type HistoricalSource } from './listingHistoricalImport';

/**
 * Draft-only historical continuation after the final programmed pullback.
 * A user-supplied CSV is not evidence of rights: server refuses publication.
 */
export function ListingHistoricalEditor({ program, onChange }: {
  program: HistoricalProgram;
  onChange: (next: HistoricalProgram) => void;
}) {
  const [source,setSource] = useState<HistoricalSource>('BTC/USDT');
  const [error,setError] = useState<string|null>(null);
  const [busy,setBusy] = useState(false);
  const loadId=useRef(0);
  async function upload(event:ChangeEvent<HTMLInputElement>) {
    const file=event.target.files?.[0];
    event.target.value='';
    if(!file)return;
    if(file.size>512*1024){setError('CSV больше 512 КБ');return;}
    if(program.clips.length>=3){setError('Максимум три последовательных исторических отрезка');return;}
    const run=++loadId.current;
    setBusy(true);setError(null);
    try {
      const clip=importHistoricalCsv(await file.text(),source);
      const next:HistoricalProgram={version:1,clips:[...program.clips,clip]};
      const count=next.clips.reduce((n,c)=>n+c.bars.length,0);
      if(count>4800)throw Error('Максимум 4800 часов без ускорения');
      // The 160 KiB Durable Object body also contains other draft fields.
      // Leave room for a logo and other metadata; backend enforces an
      // independent full-config 132-KiB maximum.
      if(new TextEncoder().encode(JSON.stringify(next)).byteLength>85*1024)
        throw Error('Отрезки превышают допустимый размер. Загрузите более короткий период.');
      if(run!==loadId.current)return;
      onChange(next);
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
      <label>Загрузить часовые свечи (CSV)<input type="file" accept=".csv,text/csv,text/plain" data-field="historicalCsv" disabled={busy} onChange={e=>{void upload(e);}} />
        <small>UTC: timestamp,open,high,low,close[,volume,trades]. Строго 1 час без пропусков, 24–2400 строк. Дата начала берётся из файла.</small></label>
    </div>
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
