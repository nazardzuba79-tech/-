import { useEffect, useState } from 'react';
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [readWarning, setReadWarning] = useState('');
  const reload = async (refresh = false) => { const next = await getAdminCatalogue(refresh); setData(next); setReadWarning(''); };
  useEffect(() => { let cancelled = false; getAdminCatalogue().then(value => { if (!cancelled) setData(value); })
    .catch(e => { if (!cancelled) setError(e.message); }); return () => { cancelled = true; }; }, []);
  const assets = (data?.assets ?? []).filter(a => {
    const configured = data!.entries.some(e => e.assetId === a.assetId && e.status === 'configured');
    return `${a.asset} ${a.name}`.toLowerCase().includes(search.toLowerCase()) &&
      (filter === 'all' || filter === 'configured' && configured || filter === 'unconfigured' && !configured || filter === 'other' && !a.top);
  });
  const selected = assets.find(a => a.assetId === assetId) ?? assets[0];
  const entries = (data?.entries ?? []).filter(e => e.assetId === selected?.assetId);
  const configured = data?.entries.filter(e => e.status === 'configured').length ?? 0;
  async function save(clear = false) {
    if (!draft || !data || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await saveCatalogueEntry(clear ? { ...draft, address: '', memo: '', memoLabel: '', enabled: false } : draft, data.revision);
      setDraft(null); setNotice(clear ? 'Адрес очищен.' : 'Адрес сохранён.');
      // The write was accepted. A failed follow-up read must not invite a
      // second mutation or discard the last confirmed catalogue. Its revision
      // is now stale, so further edits wait for a successful refresh.
      try { await reload(); }
      catch { setReadWarning('Список не обновлён. Изменение сохранено; ниже показаны предыдущие данные. Нажмите «Обновить» перед следующим изменением.'); }
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить адрес.'); }
    finally { setBusy(false); }
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
      <input style={styles.input} aria-label="Поиск актива" placeholder="Поиск актива" value={search} onChange={e => setSearch(e.target.value)} />
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
        <button style={styles.neutralBtn} disabled={busy || !!readWarning} onClick={() => { setDraft({ ...entry }); setError(''); setNotice(''); }}>Изменить</button>
      </article>)}
      {!entries.length && <p className="admin-empty">Для этого актива ещё не добавлена проверенная сеть.</p>}
    </section>}
    {!selected && <p className="admin-empty">{data ? 'Активы не найдены.' : error ? 'Каталог недоступен.' : 'Загрузка…'}</p>}
    {draft && <AdminModal title={`${draft.asset} · ${draft.networkName}`} busy={busy} onClose={() => { setDraft(null); setError(''); }}>
      <div className="admin-modal-body"><dl className="admin-facts"><dt>Актив</dt><dd>{draft.asset}</dd><dt>Сеть</dt><dd>{draft.networkName}</dd><dt>Стандарт</dt><dd>{draft.standard}</dd></dl>
        <label style={styles.label}>Адрес пополнения<input style={styles.input} maxLength={256} autoComplete="off" spellCheck={false} value={draft.address} onChange={e => setDraft({ ...draft, address: e.target.value })} /></label>
        {draft.memoAllowed && <><label style={styles.label}>Memo / Tag<input style={styles.input} maxLength={128} value={draft.memo} onChange={e => setDraft({ ...draft, memo: e.target.value })} /></label>
          <label style={styles.label}>Название Memo / Tag<input style={styles.input} maxLength={40} value={draft.memoLabel} onChange={e => setDraft({ ...draft, memoLabel: e.target.value })} /></label></>}
        <label className="catalogue-enabled"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />Показывать клиентам</label>
        <p style={styles.hint}>Проверьте адрес и сеть перед сохранением. Меняется только выбранное направление.</p>
        {error && <p role="alert" style={styles.errorBox}>{error}</p>}
      </div><footer><button style={styles.rejectBtn} disabled={busy} onClick={() => save(true)}>Очистить адрес</button>
        <button style={styles.neutralBtn} disabled={busy} onClick={() => { setDraft(null); setError(''); }}>Отмена</button>
        <button style={styles.primaryBtn} disabled={busy || draft.enabled && !draft.address.trim()} onClick={() => save()}>{busy ? 'Сохранение…' : 'Сохранить'}</button></footer>
    </AdminModal>}
  </div>;
}
