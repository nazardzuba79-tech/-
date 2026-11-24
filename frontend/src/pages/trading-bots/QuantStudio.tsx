import { useEffect, useState } from 'react';
import { request } from '../../lib/api';

type Draft = {
  id: string;
  name: string;
  pair: string;
  description: string;
  publishedAt: string | null;
  owner?: { displayName: string | null };
};
type Studio = { canCreate: boolean; thomasVip: boolean; drafts: Draft[]; published: Draft[] };
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isDraft(value: unknown): value is Draft {
  if (!record(value)) return false;
  return ['id', 'name', 'pair', 'description'].every(key => typeof value[key] === 'string')
    && (value.publishedAt === null || typeof value.publishedAt === 'string')
    && (value.owner === undefined || (record(value.owner)
      && (value.owner.displayName === null || typeof value.owner.displayName === 'string')));
}

function isStudio(value: unknown): value is Studio {
  return record(value) && typeof value.canCreate === 'boolean' && typeof value.thomasVip === 'boolean'
    && Array.isArray(value.drafts) && value.drafts.every(isDraft)
    && Array.isArray(value.published) && value.published.every(isDraft);
}

export function useStudio() {
  const [data, setData] = useState<Studio | null>(null);
  const [version, refresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    request<unknown>('/trading-bots/studio', { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setData(isStudio(result) ? result : null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setData(null);
      });
    return () => controller.abort();
  }, [version]);
  return { data, reload: () => refresh((v) => v + 1) };
}
export function StudioSection({ studio }: { studio: ReturnType<typeof useStudio> }) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [msg, setMsg] = useState('');
  const [name, setName] = useState(''),
    [pair, setPair] = useState('XRP/USDT'),
    [description, setDescription] = useState('');
  async function save(id?: string) {
    if (busy) return;
    setBusy(true);
    setMsg('');
    try {
      await request('/trading-bots/studio/drafts' + (id ? '/' + encodeURIComponent(id) + '/publish' : ''), {
        method: 'POST',
        ...(id
          ? {}
          : {
              body: JSON.stringify({ name, pair, description }),
              headers: { 'Content-Type': 'application/json' },
            }),
      });
      studio.reload();
      setMsg(id ? 'Описание опубликовано.' : 'Черновик сохранён.');
      if (!id) {
        setName('');
        setDescription('');
      }
    } catch {
      setMsg('Не удалось сохранить изменения. Проверьте доступ и повторите.');
      studio.reload();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="qm-studio">
      <div>
        <h2>Bot Studio</h2>
        <p>Рабочее пространство авторов стратегий.</p>
      </div>
      {studio.data?.canCreate ? (
        <>
          <button className="qm-action" aria-expanded={open} onClick={() => setOpen(!open)}>
            Создать стратегию
          </button>
          {open && (
            <div className="qm-studio-editor">
              <h3>Новая стратегия</h3>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <label>
                  Название
                  <input
                    required
                    minLength={3}
                    maxLength={60}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label>
                  Пара
                  <select value={pair} onChange={(e) => setPair(e.target.value)}>
                    {['BTC', 'ETH', 'SOL', 'XRP', 'BNB'].map((a) => (
                      <option key={a}>{a}/USDT</option>
                    ))}
                  </select>
                </label>
                <label>
                  Описание
                  <textarea
                    required
                    minLength={16}
                    maxLength={320}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>
                <button className="qm-action" disabled={busy}>
                  Сохранить черновик
                </button>
              </form>
              {studio.data.drafts.map((d) => (
                <div className="qm-draft" key={d.id}>
                  <strong>{d.name}</strong> {d.pair}{' '}
                  <button disabled={busy} onClick={() => void save(d.id)}>
                    Опубликовать описание
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <details>
          <summary>Преимущества VIP</summary>
          <p>
            VIP-автор может готовить черновики и публиковать описания стратегий. Публикация не запускает
            торговлю.
          </p>
        </details>
      )}
      {msg && <p role="status">{msg}</p>}
      {!!studio.data?.published.length && (
        <div className="qm-published">
          <h3>Публикации авторов</h3>
          {studio.data.published.map((d) => (
            <details key={d.id}>
              <summary>
                {d.name} · {d.pair}
              </summary>
              <p>{d.owner?.displayName}</p>
              <p>{d.description}</p>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
