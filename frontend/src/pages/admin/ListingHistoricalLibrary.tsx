import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { archiveSelection, coversHistoricalSelection, deleteHistoricalArchive,
  HISTORICAL_PRESETS, listHistoricalArchives, loadHistoricalArchive, prepareHistoricalArchive,
  saveHistoricalArchive, type HistoricalArchive } from './listingHistoricalLibrary';
import type { HistoricalClip, HistoricalSource } from './listingHistoricalImport';

type Duration = 'all'|'24'|'168'|'720'|'2160';

/** A local, offline reusable library; preset names are NOT bundled market data. */
export function ListingHistoricalLibrary({source,startDateUtc,hours,clipCount,onAdd}:{
  source:HistoricalSource;startDateUtc:string;hours:Duration;clipCount:number;
  onAdd:(clip:HistoricalClip)=>void;
}) {
  const [archives,setArchives]=useState<HistoricalArchive[]>([]);
  const [selectedId,setSelectedId]=useState('');
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const active=useRef(true);

  useEffect(()=>{
    active.current=true;
    void listHistoricalArchives().then(items=>{
      if(active.current)setArchives(items);
    }).catch(e=>{
      if(active.current)setError(e instanceof Error?e.message:'Локальное хранилище недоступно');
    });
    return ()=>{active.current=false;};
  },[]);

  async function refresh() {
    const items=await listHistoricalArchives();
    if(active.current){setArchives(items);setSelectedId(v=>items.some(a=>a.id===v)?v:'');}
  }

  async function uploadArchive(event:ChangeEvent<HTMLInputElement>) {
    const file=event.target.files?.[0];
    event.target.value='';
    if(!file)return;
    setBusy(true);setError('');setNotice('');
    try {
      if(file.size>3*1024*1024)throw Error('CSV больше 3 МБ');
      // Full file is checked before storage. Neither upload nor selected preset
      // changes the published listing or reaches the server.
      const archive=await prepareHistoricalArchive(await file.text(),source,file.name);
      await saveHistoricalArchive(archive);
      await refresh();
      if(active.current){
        setSelectedId(archive.id);
        setNotice('Архив сохранён на этом устройстве. Теперь его отрезки можно выбирать без повторного CSV.');
      }
    }catch(e){if(active.current)setError(e instanceof Error?e.message:'Не удалось сохранить архив');}
    finally {if(active.current)setBusy(false);}
  }

  async function addFromArchive(id:string,date:string,selectedHours?:24|168|720|2160) {
    if(clipCount>=3){setError('Максимум три исторических отрезка в одном сценарии');return;}
    if(!id){setError('Сначала добавьте архив исторических свечей');return;}
    setBusy(true);setError('');setNotice('');
    try {
      const stored=await loadHistoricalArchive(id);
      const clip=archiveSelection(stored,{
        ...(date?{startDateUtc:date}:{}),
        ...(selectedHours?{hours:selectedHours}:{})
      });
      if(!active.current)return;
      onAdd(clip);
      setNotice('Отрезок добавлен к черновику симуляции. Исходный CSV повторно не требуется.');
    }catch(e){if(active.current)setError(e instanceof Error?e.message:'Не удалось добавить отрезок');}
    finally {if(active.current)setBusy(false);}
  }

  async function removeArchive(archive:HistoricalArchive) {
    if(!window.confirm('Удалить архив только из этого браузера? Уже сохранённые отрезки в черновиках не изменятся.'))return;
    setBusy(true);setError('');setNotice('');
    try{await deleteHistoricalArchive(archive.id);await refresh();}
    catch(e){if(active.current)setError(e instanceof Error?e.message:'Не удалось удалить локальный архив');}
    finally {if(active.current)setBusy(false);}
  }
  const own=archives.filter(a=>a.source===source);
  const matchingSelected=own.find(a=>a.id===selectedId)??own[0];
  const selectedLength=hours==='all'?undefined:Number(hours) as 24|168|720|2160;
  const canUseSelected=matchingSelected &&
    (!startDateUtc||!selectedLength||coversHistoricalSelection(matchingSelected,source,startDateUtc,selectedLength));
  const activePresets=HISTORICAL_PRESETS.map(p=>({
    ...p,match:archives.find(a=>coversHistoricalSelection(a,p.source,p.startDateUtc,p.hours))
  }));
  return <section className="listing-history-library" aria-label="Локальная библиотека исторических движений" data-historical-library>
    <h4>Библиотека исторических сценариев</h4>
    <p className="listing-hint">Готовые периоды появятся после однократного импорта исходных часовых свечей. Данные остаются в этом браузере и не загружаются на сервер VOLTEX. Источник и права на использование не подтверждены.</p>
    <div className="listing-history-presets" data-historical-presets>
      {activePresets.map(p=><div className="listing-history-preset" key={p.id} data-historical-preset={p.id}>
        <span><strong>{p.label}</strong><small>{p.match?'Данные есть на устройстве · 90 дней':'Данные не загружены · требуется CSV'}</small></span>
        <button type="button" disabled={busy||clipCount>=3||!p.match} onClick={()=>{if(p.match)void addFromArchive(p.match.id,p.startDateUtc,p.hours);}} data-use-historical-preset={p.id}>Добавить</button>
      </div>)}
    </div>
    <div className="listing-grid">
      <label>Сохранить исходный CSV в библиотеку (один раз)
        <input type="file" accept=".csv,text/csv,text/plain" data-field="historicalLibraryFile" disabled={busy} onChange={e=>{void uploadArchive(e);}} />
        <small>До 12 000 последовательных часов / 3 МБ. Исходные абсолютные цены хранятся только локально; в черновик передаётся относительное движение. Всего до 8 архивов / 12 МБ.</small>
      </label>
      <label>Использовать ранее сохранённый архив
        <select value={matchingSelected?.id??''} data-field="historicalArchiveChoice" disabled={busy||own.length===0}
          onChange={e=>setSelectedId(e.target.value)}>
          {own.length===0?<option value="">Нет архивов {source}</option>:own.map(a=><option key={a.id} value={a.id}>{a.name||a.source} · {a.firstHour.slice(0,10)} · {a.hours} ч</option>)}
        </select>
        <small>Дата и продолжительность берутся из полей выше. При пустой дате используется первый час архива.</small>
      </label>
    </div>
    <div className="listing-buttons">
      <button type="button" data-use-historical-archive disabled={busy||clipCount>=3||!canUseSelected}
        onClick={()=>{if(matchingSelected)void addFromArchive(matchingSelected.id,startDateUtc,selectedLength);}}>Добавить выбранный период</button>
    </div>
    {own.length>0&&<div className="listing-history-archive-list" aria-label="Мои локальные архивы">
      {own.map(a=><div key={a.id} className="listing-historical-clip">
        <span>{a.source} · {a.firstHour.slice(0,10)} — {a.endExclusive.slice(0,10)} · {a.hours} ч · SHA-256 {a.sha256.slice(0,12)}…</span>
        <button type="button" data-remove-historical-archive={a.id} disabled={busy} onClick={()=>{void removeArchive(a);}}>Удалить с устройства</button>
      </div>)}
    </div>}
    {busy&&<p role="status">Проверка локальной библиотеки…</p>}
    {notice&&<p role="status" className="listing-hint">{notice}</p>}
    {error&&<p role="alert" className="listing-error">{error}</p>}
    <p className="listing-hint">SHA-256 проверяет целостность локального CSV, но не подлинность биржевых данных и не право на коммерческое использование. Публикация исторического режима по-прежнему заблокирована.</p>
  </section>;
}
