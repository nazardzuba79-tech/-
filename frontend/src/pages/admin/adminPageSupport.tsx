import type { AdminReadCompatibility } from '../../lib/adminPagedApi';

type PageSupport = { total: number; compatibility?: AdminReadCompatibility };

/** Legacy caps describe a loaded sample, never the total history on the server. */
export function adminPageCount(page: PageSupport, label = 'Найдено'): string {
  return `${page.compatibility?.complete === false ? 'Загружено по условиям' : label}: ${page.total.toLocaleString('ru-RU')}`;
}

export function adminPageEmpty(page: PageSupport, empty = 'Записей по выбранным условиям нет.'): string {
  return page.compatibility?.complete === false
    ? 'В загруженной части записей по этим условиям нет. Полная история недоступна.'
    : empty;
}

export function AdminCompatibilityNotice({ compatibility }: { compatibility?: AdminReadCompatibility }) {
  return compatibility?.notice ? <p role="status" className="admin-muted" data-admin-compatibility={compatibility.mode}>{compatibility.notice}</p> : null;
}
