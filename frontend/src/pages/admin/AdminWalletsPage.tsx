
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { styles } from './adminStyles';
import { depositRails, addressAdvice, networkName } from './depositRails';
import { AdminModal, CopyValue } from './AdminPrimitives';

type Wallet = Awaited<ReturnType<typeof api.getAdminWallets>>[number];
type Rail = ReturnType<typeof depositRails<Wallet>>[number];

export function AdminWalletsPage() {
  const [wallets, setWallets] = useState<Wallet[] | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Rail | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmation, setConfirmation] = useState<'save' | 'reset' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const reload = async () => { const rows = await api.getAdminWallets(); setWallets(rows); };
  useEffect(() => { reload().catch(() => setError('Не удалось загрузить адреса. Повторите загрузку.')); }, []);
  const rails = depositRails(wallets ?? []);
  const filtered = rails.filter(r => `${r.label} ${r.wallet.address ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  const affected = selected ? rails.filter(r => r.chain === selected.chain) : [];
  const advice = addressAdvice(selected?.chain ?? '', draft);

  async function commitAddress() {
    if (!selected || !confirmation || busy) return;
    setBusy(true); setError(null);
    try {
      if (confirmation === 'save') await api.setAdminWalletAddress(selected.chain, draft.trim());
      else await api.resetAdminWallet(selected.chain);
      setNotice(`Адрес сети ${selected.network} ${confirmation === 'save' ? 'сохранён' : 'сброшен к умолчанию'}.`);
      setSelected(null); setConfirmation(null);
      try { await reload(); } catch { setWallets(null); setError('Изменение сохранено, но список не обновлён. Повторите загрузку.'); }
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Не удалось изменить адрес.'); }
    finally { setBusy(false); }
  }

  return <div>
    <h1 style={styles.title}>Адреса пополнения</h1>
    <p style={styles.subtitle}>Публичные адреса приёма · один адрес на сеть · изменения применяются сразу</p>
    {error && !selected && <p role="alert" style={styles.errorBox}>{error}</p>}
    {notice && <p role="status" style={styles.successBox}>{notice}</p>}
    <div className="admin-toolbar">
      <input style={styles.input} aria-label="Поиск адресов" placeholder="Актив, сеть или адрес" value={search} onChange={e => setSearch(e.target.value)} />
      <span style={styles.hint}>{wallets ? `${rails.length} направлений · ${new Set(rails.map(r => r.chain)).size} сетей` : 'Загрузка конфигурации…'}</span>
      <button style={styles.neutralBtn} onClick={() => { setError(null); reload().catch(() => setError('Не удалось загрузить адреса.')); }}>Обновить</button>
    </div>
    <div className="admin-data-wrap"><table className="admin-data-table admin-address-table">
      <thead><tr>{['Актив', 'Сеть', 'Стандарт', 'Адрес пополнения', 'Статус', 'Источник', 'Изменён', 'Действие'].map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{filtered.map(r => <tr key={r.key}>
        <td><strong className="admin-asset">{r.asset}</strong></td><td>{r.network}</td><td><span className="admin-standard">{r.standard}</span></td>
        <td><CopyValue value={r.wallet.address} label={`адрес ${r.label}`} />{r.shared && <small className="admin-shared" title="Все настроенные активы этой сети используют этот адрес">Общий адрес сети</small>}</td>
        <td><span className={`admin-chip ${r.wallet.address ? 'positive' : 'warning'}`}>{r.wallet.address ? 'Адрес задан' : 'Нет адреса'}</span></td>
        <td>{r.wallet.isOverridden ? 'Администратор' : 'По умолчанию'}</td>
        <td title={r.wallet.updatedByAdminId ?? undefined}>{r.wallet.updatedAt ? new Date(r.wallet.updatedAt).toLocaleDateString('ru-RU') : '—'}</td>
        <td><button style={styles.neutralBtn} aria-label={`Изменить ${r.label}`} onClick={() => { setSelected(r); setDraft(r.wallet.address ?? ''); setError(null); setConfirmation(null); }}>Изменить</button></td>
      </tr>)}</tbody>
    </table>{(!wallets || filtered.length === 0) && <p className="admin-empty">{wallets ? 'Направления не найдены.' : error ? 'Данные недоступны.' : 'Загрузка…'}</p>}</div>
    {(wallets ?? []).some(w => !w.envConfigured) && <p style={styles.hint}>Не настроены на backend: {wallets!.filter(w => !w.envConfigured).map(w => networkName(w.chain)).join(', ')}. Поддерживаемые активы для них не заявлены.</p>}
    {selected && <AdminModal title={confirmation ? 'Подтвердить изменение адреса' : selected.label} busy={busy} onClose={() => { setSelected(null); setConfirmation(null); setError(null); }}>
      <div className="admin-modal-body">
        <dl className="admin-facts"><dt>Актив</dt><dd>{selected.asset}</dd><dt>Сеть</dt><dd>{selected.network}</dd><dt>Стандарт</dt><dd>{selected.standard}</dd><dt>Область изменения</dt><dd>Network treasury address</dd></dl>
        <div className="admin-callout">Это treasury address сети {selected.network}. Изменение затрагивает все настроенные направления этой сети:
          <ul>{affected.map(r => <li key={r.key}>{r.label}</li>)}</ul>
        </div>
        <label style={styles.label}>Текущий адрес<code className="admin-full-value">{selected.wallet.address ?? 'Не задан'}</code></label>
        {confirmation ? <>
          <label style={styles.label}>{confirmation === 'reset' ? 'Адрес по умолчанию после сброса' : 'Новый адрес'}<code className="admin-full-value">{confirmation === 'reset' ? selected.wallet.defaultAddress ?? 'Не задан — приём депозитов в этой сети станет недоступен' : draft.trim()}</code></label>
          <p className="admin-callout">После сохранения пользователи сразу получат этот адрес для пополнений в данной сети.</p>
        </> : <>
          <label style={styles.label}>Новый публичный адрес<input autoComplete="off" spellCheck={false} style={styles.input} value={draft} onChange={e => setDraft(e.target.value)} /></label>
          {draft && advice.error && <p role="alert" style={styles.errorBox}>{advice.error}</p>}
          <p style={styles.hint}>{advice.warning} Только public receive address — не приватный ключ и не seed-фраза.</p>
          <dl className="admin-facts"><dt>Источник</dt><dd>{selected.wallet.isOverridden ? 'Admin override' : 'Environment default'}</dd><dt>Изменён</dt><dd>{selected.wallet.updatedAt ? new Date(selected.wallet.updatedAt).toLocaleString('ru-RU') : '—'}</dd><dt>Admin ID</dt><dd className="admin-full-value">{selected.wallet.updatedByAdminId ?? '—'}</dd></dl>
        </>}
        {error && <p role="alert" style={styles.errorBox}>{error}</p>}
      </div>
      <footer>{confirmation ? <>
        <button style={styles.neutralBtn} disabled={busy} onClick={() => setConfirmation(null)}>Назад</button>
        <button style={confirmation === 'reset' ? styles.rejectBtn : styles.primaryBtn} disabled={busy} onClick={commitAddress}>{busy ? 'Сохранение…' : 'Подтвердить'}</button>
      </> : <>
        {selected.wallet.isOverridden && <button style={styles.rejectBtn} onClick={() => setConfirmation('reset')}>Сбросить к умолчанию</button>}
        <button style={styles.primaryBtn} disabled={Boolean(advice.error) || draft.trim() === selected.wallet.address} onClick={() => setConfirmation('save')}>Сохранить адрес</button>
      </>}</footer>
    </AdminModal>}
  </div>;
}
