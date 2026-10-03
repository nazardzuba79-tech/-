import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  LISTING_PROFILE_LABELS, LISTING_REVISION_CONFLICT,
  listingProfileLabel, listingRequestError, listingTimeZoneLabel,
} from '../../pages/admin/adminListingsCopy';
import { LISTING_TIME_ZONES } from '../../pages/admin/adminListingsTime';

const page = readFileSync(resolve(__dirname, '../../pages/admin/AdminListingsPage.tsx'), 'utf8');

describe('Listings: Russian presentation without changing stored values', () => {
  test.each([...LISTING_TIME_ZONES])('the supported zone %s has a Russian display name', zone => {
    const label = listingTimeZoneLabel(zone);
    expect(label).toMatch(/[А-Яа-яЁё]/);
    expect(label).not.toBe('Другой часовой пояс');
    expect(label).not.toContain('/');
  });

  test.each(Object.keys(LISTING_PROFILE_LABELS))('profile %s has a Russian label', profile => {
    expect(listingProfileLabel(profile)).toMatch(/[А-Яа-яЁё]/);
    expect(listingProfileLabel(profile)).not.toBe('Неизвестный профиль симуляции');
  });

  test('unsupported display values fail to neutral Russian labels', () => {
    expect(listingProfileLabel('UNKNOWN_PROFILE')).toBe('Неизвестный профиль симуляции');
    expect(listingTimeZoneLabel('Unknown/Zone')).toBe('Другой часовой пояс');
  });

  test('the UI labels do not translate zone values or enable profile editing', () => {
    expect(page).toContain('value={zone}>{listingTimeZoneLabel(zone)}</option>');
    expect(page).toContain('displayTimeZone: form.timeZone');
    const payload = page.slice(page.indexOf('const payload: ListingForm = {'), page.indexOf('setBusy(true); setFormError(null);'));
    expect(payload).toContain('seedMode: form.seedMode');
    expect(payload).toContain('tradable: form.tradable');
    expect(payload).not.toContain('simulationProfile');
    expect(page).toContain('disabled={editing.locked}');
  });

  test('English form labels are replaced without removing simulation disclosures', () => {
    expect(page).not.toContain('Owner allocation,');
    expect(page).not.toContain('Seed истории');
    expect(page).not.toContain('Seed:');
    expect(page).not.toContain('Торговля на Spot');
    expect(page).toContain('Количество токенов для владельца,');
    expect(page).toContain('<legend>Код генерации истории цены</legend>');
    expect(page).toContain('Спотовая торговля после листинга');
    expect(page).toContain('Сделки (симуляция)');
    expect(page).toContain('Это симуляция, а не реальные рыночные данные.');
    expect(page).toContain('отображаемый стакан — не ликвидность.');
  });
});

describe('Listings: localized errors retain meaningful refusal states', () => {
  test('a revision conflict remains explicit', () => {
    expect(listingRequestError({ status: 409, code: 'revision_conflict', message: 'revision mismatch' }))
      .toBe(LISTING_REVISION_CONFLICT);
  });

  test.each(['symbol', 'name', 'logo', 'initialPrice', 'ownerAllocation', 'listingAt', 'displayTimeZone', 'seed'])('invalid %s has a field-specific Russian message', field => {
    const message = listingRequestError({ status: 422, code: 'INVALID_CONFIG', message: `${field}: Invalid input` });
    expect(message).toMatch(/[А-Яа-яЁё]/);
    expect(message).not.toContain('Invalid input');
    expect(message).not.toBe('Проверьте заполнение полей листинга. Сервер отклонил параметры.');
  });

  test('history protection is not described as a transient error', () => {
    expect(listingRequestError({ status: 422, code: 'HISTORY_LOCKED', message: 'history locked' }))
      .toContain('защиты опубликованной истории');
  });

  test.each([401, 403])('HTTP %s still reports the access problem', status => {
    const message = listingRequestError({ status, code: null, message: 'not authorized' });
    expect(message).toMatch(/Сессия|прав/);
    expect(message).not.toContain('not authorized');
  });

  test.each([0, 503])('HTTP %s does not claim a possibly committed operation was never saved', status => {
    const message = listingRequestError({ status, code: null, message: 'upstream failed' });
    expect(message).toMatch(/подтвержд|подтверждения/);
    expect(message).not.toMatch(/[Нн]ичего не сохранено|upstream failed/);
  });

  test('unknown server content is never displayed and the original code remains unchanged', () => {
    const error = { status: 400, code: 'UNKNOWN', message: '<html>secret-token=do-not-render</html>' };
    const before = { ...error };
    const message = listingRequestError(error);
    expect(message).toMatch(/[А-Яа-яЁё]/);
    expect(message).not.toMatch(/html|secret-token|do-not-render/);
    expect(error).toEqual(before);
  });

  test('an unknown validation field does not echo raw diagnostic text', () => {
    expect(listingRequestError({ status: 422, code: 'INVALID_CONFIG', message: 'unknown: sensitive details' }))
      .toBe('Проверьте заполнение полей листинга. Сервер отклонил параметры.');
  });
});
