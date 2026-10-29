import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getToken, onSessionChange, request } from '../../lib/api';
import { canPublishStrategySocials, publicStrategySocials, type StrategySocials } from '../../../../src/shared/copyStrategySocials';
import './StrategySocials.css';

type Identity = Partial<StrategySocials> & { traderId: string };
const SocialContext = createContext<{ identities: Identity[]; saved: (id: string, links: StrategySocials) => void }>({ identities: [], saved: () => {} });
export function StrategySocialProvider({ identities, children }: { identities: Identity[]; children: ReactNode }) {
  const [overrides, setOverrides] = useState<Record<string, StrategySocials>>({});
  useEffect(() => onSessionChange(() => setOverrides({})), []);
  return <SocialContext.Provider value={{ identities: [...identities.filter(i => !overrides[i.traderId]), ...Object.entries(overrides).map(([traderId, links]) => ({ traderId, ...links }))], saved: (id, links) => setOverrides(old => ({ ...old, [id]: links })) }}>{children}</SocialContext.Provider>;
}

function SocialMark({ telegram }: { telegram: boolean }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{telegram
    ? <path d="M21.4 3.6 18.2 20c-.2 1.1-.9 1.4-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9-8.1c.4-.4-.1-.6-.6-.3L5.8 13.7 1 12.2c-1-.3-1-1 .2-1.5L20 3.5c.9-.3 1.6.2 1.4 1.1Z" />
    : <path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l8.2-9.4L2.8 2h6.5l4.5 6.8L18.9 2ZM17.8 20h1.7L8.4 4H6.6l11.2 16Z" />}</svg>;
}

export function StrategySocialLinks({ traderId }: { traderId: string }) {
  const { identities } = useContext(SocialContext);
  const links = publicStrategySocials(traderId, identities.find(i => i.traderId === traderId));
  return <span className="strategy-socials" data-social-trader={traderId}>
    {(['xUrl', 'telegramUrl'] as const).map(field => {
      const title = field === 'xUrl' ? 'X (Twitter)' : 'Telegram';
      const icon = <SocialMark telegram={field === 'telegramUrl'} />;
      return links[field]
        ? <a key={field} href={links[field]!} target="_blank" rel="noopener noreferrer" aria-label={title} title={title} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>{icon}</a>
        : <button key={field} type="button" disabled aria-disabled="true" aria-label={`${title}: ссылка недоступна`} title={`${title}: ссылка недоступна`}>{icon}</button>;
    })}
  </span>;
}

export function StrategySocialEditor({ traderId }: { traderId: string }) {
  const { saved } = useContext(SocialContext);
  const [session, setSession] = useState(getToken);
  const [original, setOriginal] = useState<StrategySocials | null>(null);
  const [xUrl, setX] = useState('');
  const [telegramUrl, setTelegram] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => onSessionChange(() => { setOriginal(null); setX(''); setTelegram(''); setSession(getToken()); }), []);
  useEffect(() => {
    setOriginal(null); setMessage(''); setBusy(false);
    if (!canPublishStrategySocials(traderId) || !session) return;
    const controller = new AbortController();
    request<StrategySocials>(`/copy-trading/socials/${encodeURIComponent(traderId)}`, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted || getToken() !== session) return;
      setOriginal(value); setX(value.xUrl ?? ''); setTelegram(value.telegramUrl ?? ''); saved(traderId, value);
    }).catch(() => {}); // Permission denial is not an editor and never grants a fallback.
    return () => controller.abort();
  }, [traderId, session]);
  if (!canPublishStrategySocials(traderId) || !original || !session) return null;
  return <details className="strategy-social-editor"><summary>Социальные ссылки</summary>
    <form onSubmit={async event => {
      event.preventDefault(); if (busy) return;
      const patch: Partial<StrategySocials> = {};
      if (xUrl !== (original.xUrl ?? '')) patch.xUrl = xUrl;
      if (telegramUrl !== (original.telegramUrl ?? '')) patch.telegramUrl = telegramUrl;
      if (!Object.keys(patch).length) { setMessage('Нет изменений'); return; }
      setBusy(true); setMessage('');
      try {
        const value = await request<StrategySocials>(`/copy-trading/socials/${encodeURIComponent(traderId)}`, { method: 'PATCH', body: JSON.stringify(patch) });
        if (getToken() !== session) return;
        setOriginal(value); setX(value.xUrl ?? ''); setTelegram(value.telegramUrl ?? ''); saved(traderId, value); setMessage('Ссылки сохранены');
      } catch { if (getToken() === session) setMessage('Не удалось сохранить. Проверьте ссылки и доступ к стратегии.'); }
      finally { setBusy(false); }
    }}>
      <p>Необязательно. Оставьте поле пустым, чтобы убрать ссылку.</p>
      <label>X (Twitter)<input value={xUrl} onChange={event => setX(event.target.value)} maxLength={255} disabled={busy} autoComplete="off" placeholder="@имя или https://x.com/имя" /></label>
      <label>Telegram<input value={telegramUrl} onChange={event => setTelegram(event.target.value)} maxLength={255} disabled={busy} autoComplete="off" placeholder="@имя или https://t.me/имя" /></label>
      <button type="submit" disabled={busy}>{busy ? 'Сохранение…' : 'Сохранить ссылки'}</button>
      <p role="status">{message}</p>
    </form>
  </details>;
}
