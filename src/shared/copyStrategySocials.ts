/** Copy Trading permissions are strategy IDs, never premium status or profile data. */
export const SOCIAL_STRATEGIES = ['VX-001', 'VX-KSENIA'] as const;
export const canPublishStrategySocials = (id: string) => (SOCIAL_STRATEGIES as readonly string[]).includes(id);
export type StrategySocials = { xUrl: string | null; telegramUrl: string | null };
export type SocialField = keyof StrategySocials;
const reserved = new Set(['home', 'explore', 'search', 'intent', 'share', 'settings', 'login', 'logout', 'signup', 'messages', 'compose', 'notifications', 'i', 'hashtag', 'joinchat', 'addlist', 'proxy', 'socks', 'confirmphone', 'setlanguage', 'boost', 'invoice', 'iv', 's', 'c', 'm']);

/** Strict profile URLs only; no resolution, redirects or server-side HTTP. */
export function normalizeStrategySocial(field: SocialField, input: unknown): string | null {
  if (input === null || input === '') return null;
  if (typeof input !== 'string' || input.length > 255 || /[\u0000-\u001f\u007f\\%]/.test(input)) throw new Error('Некорректная социальная ссылка');
  const value = input.trim();
  if (!value) return null;
  let handle: string;
  if (value.startsWith('@')) handle = value.slice(1);
  else {
    const match = /^(?:https:\/\/)?(x\.com|twitter\.com|t\.me)\/([A-Za-z0-9_]+)\/?$/i.exec(value);
    if (!match || (field === 'xUrl' ? !/^(x|twitter)\.com$/i.test(match[1]) : match[1].toLowerCase() !== 't.me')) throw new Error('Укажите ссылку на профиль X или Telegram');
    handle = match[2];
  }
  if (!(field === 'xUrl' ? /^[A-Za-z0-9_]{1,15}$/ : /^[A-Za-z][A-Za-z0-9_]{4,31}$/).test(handle) || reserved.has(handle.toLowerCase())) throw new Error('Некорректное имя пользователя');
  return `https://${field === 'xUrl' ? 'x.com' : 't.me'}/${handle.toLowerCase()}`;
}

export function publicStrategySocials(traderId: string, source?: Partial<StrategySocials> | null): StrategySocials {
  const result: StrategySocials = { xUrl: null, telegramUrl: null };
  if (!canPublishStrategySocials(traderId)) return result;
  for (const field of ['xUrl', 'telegramUrl'] as const) {
    try { result[field] = normalizeStrategySocial(field, source?.[field] ?? null); } catch { /* fail closed on legacy/corrupt data */ }
  }
  return result;
}
