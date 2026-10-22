import { useCallback, useEffect, useRef, useState } from 'react';
import { getToken, onSessionChange } from '../../lib/api';

type Snapshot<T> = { key: string; session: string | null; data: T | null; error: string | null; loading: boolean; updatedAt: number | null };
const message = (error: unknown) => {
  const code = (error as { code?: string })?.code;
  const status = (error as { status?: number })?.status;
  if (status === 401) return 'Сессия завершена. Войдите снова.';
  if (status === 403) return 'Нет доступа к этим данным.';
  if (code === 'USER_NOT_FOUND') return 'Пользователь не найден.';
  if (code === 'ENDPOINT_NOT_AVAILABLE') return 'Этот раздел недоступен в текущей версии сервера.';
  if (status === 404) return 'Запись не найдена.';
  if (code === 'SERVER_ERROR') return 'Сервер не смог загрузить данные. Повторите запрос.';
  return 'Не удалось загрузить данные. Проверьте соединение и повторите запрос.';
};

/** Only read requests: no retry of writes, no persistent private-data cache.
 * Key/session changes hide old records in the render before effects run.
 * The timer settles the UI even when a transport ignores cancellation. */
export function useAdminRead<T>(key: string, reader: (signal: AbortSignal) => Promise<T>, options: { timeoutMs?: number } = {}) {
  const [session, setSession] = useState(getToken);
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot<T>>({ key, session, data: null, error: null, loading: true, updatedAt: null });
  const readerRef = useRef(reader);
  readerRef.current = reader;
  const timeoutMs = options.timeoutMs ?? 15_000;
  useEffect(() => onSessionChange(() => setSession(getToken())), []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const owns = () => active && getToken() === session;
    if (!session) {
      setSnapshot({ key, session, data: null, error: 'Сессия завершена. Войдите снова.', loading: false, updatedAt: null });
      return;
    }
    setSnapshot(previous => ({ key, session,
      data: previous.key === key && previous.session === session ? previous.data : null,
      updatedAt: previous.key === key && previous.session === session ? previous.updatedAt : null,
      error: null, loading: true }));
    const timer = setTimeout(() => {
      if (!owns()) return;
      active = false;
      controller.abort();
      setSnapshot(previous => ({ ...previous, loading: false, error: 'Истекло время ожидания. Повторите запрос.' }));
    }, timeoutMs);
    Promise.resolve().then(() => readerRef.current(controller.signal)).then(data => {
      if (!owns()) return;
      setSnapshot({ key, session, data, error: null, loading: false, updatedAt: Date.now() });
    }).catch(error => {
      if (!owns()) return;
      const denied = [401, 403].includes(error?.status);
      setSnapshot(previous => ({ ...previous, data: denied ? null : previous.data, updatedAt: denied ? null : previous.updatedAt, error: message(error), loading: false }));
    }).finally(() => clearTimeout(timer));
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [key, session, revision, timeoutMs]);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  const current = snapshot.key === key && snapshot.session === session && getToken() === session;
  return { data: current ? snapshot.data : null, error: current ? snapshot.error : null,
    updatedAt: current ? snapshot.updatedAt : null, loading: !current || snapshot.loading,
    refreshing: current && snapshot.data !== null && snapshot.loading, reload };
}
