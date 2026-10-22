import { adminDate } from './adminPresentation';
import { styles } from './adminStyles';

export function AdminReadStatus({ loading, error, updatedAt, reload, hasData = false }: {
  loading: boolean; error: string | null; updatedAt: number | null; reload: () => void; hasData?: boolean;
}) {
  return <div className="admin-read-status">
    <span role="status">{loading ? (hasData ? 'Обновление…' : 'Загрузка…') : updatedAt ? `Обновлено: ${adminDate(updatedAt)}` : 'Данные ещё не получены'}</span>
    <button type="button" style={styles.neutralBtn} onClick={reload} disabled={loading}>{error ? 'Повторить' : 'Обновить'}</button>
    {error && <span role="alert">{error}{hasData ? ' Данные могли устареть.' : ''}</span>}
  </div>;
}
