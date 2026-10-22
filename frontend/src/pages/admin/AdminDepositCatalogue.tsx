import { useEffect, useRef, useState } from 'react';
import { getAdminCatalogue, saveCatalogueEntry, type AdminCatalogue, type CatalogueEntry } from '../../lib/depositCatalogue';
import { AdminModal, CopyValue } from './AdminPrimitives';
import { styles } from './adminStyles';
import './depositCatalogue.css';

const statusText = { configured: 'Настроен', unconfigured: 'Не настроен', disabled: 'Отключён' };
export function AdminDepositCatalogue() {
  const [data, setData] = useState<AdminCatalogue | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [assetId, setAssetId] = useState('');
  const [draft, setDraft] = useState<CatalogueEntry | null>(null);
  const [review, setReview] = useState<{ entry: CatalogueEntry; previous: CatalogueEntry; revision: string; clear: boolean } | null>(null);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [readWarning, setReadWarning] = useState('');
  const reload = async (refresh = false) => { const next = await getAdminCatalogue(refresh); setData(next); setReadWarning(''); };
  useEffect(() => { let cancelled = false; getAdminCatalogue().then(value => { if (!cancelled) setData(value); })
    .catch(e => { if (!cancelled) setError(e.message); }); return () => { cancelled = true; }; }, []);
  const assets = (data?.assets ?? []).filter(a => {
    const configured = data!.entries.some(e => e.assetId === a.assetId && e.status === 'configured');
    const networks = data!.entries.filter(e => e.assetId === a.assetId).map(e => `${e.networkName} ${e.networkId} ${e.standard}`).join(' ');
    return `${a.asset} ${a.name} ${networks}`.toLowerCase().includes(search.trim().toLowerCase()) &&
      (filter === 'all' || filter === 'configured' && configured || filter === 'unconfigured' && !configured || filter === 'other' && !a.top);
  });
  const selected = assets.find(a => a.assetId === assetId) ?? assets[0];
  const entries = (data?.entries ?? []).filter(e => e.assetId === selected?.assetId);
  const configured = data?.entries.filter(e => e.status === 'configured').length ?? 0;
  function prepareSave(clear = false) {
    if (!draft || !data || saving.current) return;
    const previous = data.entries.find(e => e.assetId === draft.assetId && e.networkId === draft.networkId);
    if (!previous) return;
    setReview({ entry: clear ? { ...draft, address: '', memo: '', memoLabel: '', enabled: false } : { ...draft }, previous: { ...previous }, revision: data.revision, clear });
    setError('');
  }
  function closeEditor() { if (!saving.current) { setDraft(null); setReview(null); setError(''); } }
  async function save() {
    if (!review || saving.current) return;
    saving.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      await saveCatalogueEntry(review.entry, review.revision);
      setDraft(null); setReview(null); setNotice(review.clear ? 'Адрес очищен.' : 'Адрес сохранён.');
      // The write was accepted. A failed follow-up read must not invite a
      // second mutation or discard the last confirmed catalogue. Its revision
      // is now stale, so further edits wait for a successful refresh.
      try { await reload(); }
      catch { setReadWarning('Список не обновлён. Изменение сохранено; ниже показаны предыдущие данные. Нажмите «Обновить» перед следующим изменением.'); }
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить адрес.'); }
    finally { saving.current = false; setBusy(false); }
  }
  return <div className="deposit-catalogue">
    <h1 style={styles.title}>Адреса пополнения</h1>
    <p style={styles.subtitle}>Выберите актив и настройте адрес для нужной сети.</p>
    <div className="catalogue-summary"><strong>{configured} <span>настроенных направлений</span></strong><span>Активы по капитализации · CoinGecko</span>
      <button style={styles.neutralBtn} disabled={busy} onClick={async () => { setError(''); setBusy(true); try { await reload(true); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>Обновить</button></div>
    {error && <p role="alert" style={styles.errorBox}>{error}</p>}
    {readWarning && <p role="alert" style={styles.errorBox}>{readWarning}</p>}
    {notice && <p role="status" style={styles.successBox}>{notice}</p>}
    {data && !data.rankingAvailable && <p style={styles.hint}>Рейтинг временно недоступен. Сохранённые адреса доступны.</p>}
    <div className="catalogue-filters">
      <input style={styles.input} aria-label="Поиск актива или сети" placeholder="Актив или сеть" value={search} onChange={e => setSearch(e.target.value)} />
      <select style={styles.input} aria-label="Статус адресов" value={filter} onChange={e => setFilter(e.target.value)}>
        <option value="all">Все активы</option><option value="configured">Настроенные</option><option value="unconfigured">Не настроенные</option><option value="other">Другие сохранённые</option>
      </select>
    </div>
    <div className="catalogue-assets" aria-label="Активы">{assets.map(a => <button key={a.assetId} aria-pressed={a.assetId === selected?.assetId} onClick={() => setAssetId(a.assetId)}>
      <strong>{a.asset}</strong><span>{a.top ? `#${a.rank}` : 'Сохранён'}{data!.entries.some(e => e.assetId === a.assetId && e.status === 'configured') ? ' · ✓' : ''}</span>
    </button>)}</div>
    {selected && <section className="catalogue-detail"><header><div><h2>{selected.asset}</h2><p>{selected.name}</p></div><span>{entries.length} сетей</span></header>
      {entries.map(entry => <article className="catalogue-network" key={entry.networkId}>
        <div><h3>{entry.networkName} <small>{entry.standard}</small></h3><span className={`admin-chip ${entry.status === 'configured' ? 'positive' : 'warning'}`}>{statusText[entry.status ?? 'unconfigured']}</span></div>
        <div className="catalogue-address"><CopyValue full value={entry.address} label={entry.networkName} />{entry.memo && <p>{entry.memoLabel}: <CopyValue full value={entry.memo} /></p>}</div>
        <button style={styles.neutralBtn} disabled={busy || !!readWarning} onClick={() => { setDraft({ ...entry }); setReview(null); setError(''); setNotice(''); }}>Изменить</button>
      </article>)}
      {!entries.length && <p className="admin-empty">Для этого актива ещё не добавлена проверенная сеть.</p>}
    </section>}
    {!selected && <p className="admin-empty">{data ? 'Активы не найдены.' : error ? 'Каталог недоступен.' : 'Загрузка…'}</p>}
    {draft && <AdminModal title={review ? 'Проверить изменение адреса' : `${draft.asset} · ${draft.networkName}`} busy={busy} onClose={closeEditor}>
      {review ? <><div className="admin-modal-body">
        <dl className="admin-facts"><dt>Актив</dt><dd>{review.entry.asset}</dd><dt>Сеть / стандарт</dt><dd>{review.entry.networkName} · {review.entry.standard}</dd>
          <dt>Текущий адрес</dt><dd><CopyValue full value={review.previous.address} /></dd>
          <dt>Новый адрес</dt><dd>{review.entry.address ? <CopyValue full value={review.entry.address} /> : 'Будет очищен'}</dd>
          {(review.previous.memo || review.entry.memo) && <><dt>Текущий Memo / Tag</dt><dd><CopyValue full value={review.previous.memo} /></dd><dt>Новый Memo / Tag</dt><dd><CopyValue full value={review.entry.memo} /></dd></>}
          <dt>Видимость для клиентов</dt><dd>{review.previous.enabled ? 'Включена' : 'Выключена'} → {review.entry.enabled ? 'Включена' : 'Выключена'}</dd>
          <dt>Ревизия каталога</dt><dd style={{ overflowWrap: 'anywhere' }}>{review.revision}</dd></dl>
        <p style={styles.hint}>Изменение касается этого актива и сети для всех клиентов. {review.clear ? 'Адрес перестанет отображаться для пополнения.' : 'Клиенты будут видеть новый адрес, если показ включён.'} История переводов и балансы не изменятся.</p>
        {error && <p role="alert" style={styles.errorBox}>{error}</p>}
      </div><footer><button style={styles.neutralBtn} disabled={busy} onClick={closeEditor}>Отмена</button><button style={styles.neutralBtn} disabled={busy} onClick={() => { setReview(null); setError(''); }}>К редактированию</button><button style={review.clear ? styles.rejectBtn : styles.primaryBtn} disabled={busy} onClick={() => void save()}>{busy ? 'Сохранение…' : 'Подтвердить изменение'}</button></footer></> : <>
      <div className="admin-modal-body"><dl className="admin-facts"><dt>Актив</dt><dd>{draft.asset}</dd><dt>Сеть</dt><dd>{draft.networkName}</dd><dt>Стандарт</dt><dd>{draft.standard}</dd></dl>
        <label style={styles.label}>Адрес пополнения<input style={styles.input} maxLength={256} autoComplete="off" spellCheck={false} value={draft.address} onChange={e => setDraft({ ...draft, address: e.target.value })} /></label>
        {draft.memoAllowed && <><label style={styles.label}>Memo / Tag<input style={styles.input} maxLength={128} value={draft.memo} onChange={e => setDraft({ ...draft, memo: e.target.value })} /></label>
          <label style={styles.label}>Название Memo / Tag<input style={styles.input} maxLength={40} value={draft.memoLabel} onChange={e => setDraft({ ...draft, memoLabel: e.target.value })} /></label></>}
        <label className="catalogue-enabled"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />Показывать клиентам</label>
        <p style={styles.hint}>Введите только публичный адрес. Приватные ключи и seed-фразы не принимаются. Перед сохранением проверьте адрес и сеть.</p>
        {error && <p role="alert" style={styles.errorBox}>{error}</p>}
      </div><footer><button style={styles.rejectBtn} disabled={busy} onClick={() => prepareSave(true)}>Очистить адрес</button>
        <button style={styles.neutralBtn} disabled={busy} onClick={closeEditor}>Отмена</button>
        <button style={styles.primaryBtn} disabled={busy || draft.enabled && !draft.address.trim()} onClick={() => prepareSave()}>Сохранить</button></footer></>}
    </AdminModal>}
  </div>;
}
