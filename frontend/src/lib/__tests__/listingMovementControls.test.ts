import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  MOVEMENT_SCENARIOS, formatMovementPrice, movementGainFromPrice, movementPriceFromGain,
  newListingMovement, rebaseListingMovement, selectMovementScenario, validateListingMovement, parseMovementHours, movementStageMoment,
} from '../../pages/admin/listingMovementModel';
import { defaultScenarioControls, exactGainFromPrice, exactPriceFromGain, LISTING_SCENARIOS } from '../../../../src/shared/listingScenarioControls';
import { listingRequestError } from '../../pages/admin/adminListingsCopy';

describe('Server-backed listing movement form', () => {
  test('all ten choices match the shared server IDs and have meaningful Russian descriptions', () => {
    expect(MOVEMENT_SCENARIOS.map(item => item.id)).toEqual([...LISTING_SCENARIOS]);
    for (const item of MOVEMENT_SCENARIOS) {
      expect(item.name).toMatch(/[А-Яа-я]/);
      expect(item.description.length).toBeGreaterThan(40);
      expect(selectMovementScenario(newListingMovement('.8'), item.id).scenario).toBe(item.id);
    }
  });

  test.each(LISTING_SCENARIOS)('new %s presets match the shared backend default exactly', scenario => {
    expect(newListingMovement('0.80', scenario)).toEqual(defaultScenarioControls('0.80', scenario));
  });

  test('initial 0,80, day one 1725%, total ceiling 9247% means 14.60 and 74.776, not compound growth', () => {
    expect(movementPriceFromGain('0,80', '1725')).toBe('14.6');
    expect(movementPriceFromGain('0,80', '9247')).toBe('74.776');
    expect(movementGainFromPrice('0,80', '74,776')).toBe('9247');
    expect(formatMovementPrice('74.776')).toBe('74,776');
    expect(newListingMovement('0.80').maxPrice).toBe('74.776');
    expect(newListingMovement('0.80')).not.toHaveProperty('maxGainPercent');
  });

  test.each([['0.80', '1725'], ['0.80', '9247'], ['0.0000000123', '23.987654321'], ['12345.6789', '0.123456789']])('frontend and backend exact math agree for %s / %s', (initial, gain) => {
    const price = movementPriceFromGain(initial, gain);
    expect(price).toBe(exactPriceFromGain(initial, gain));
    expect(movementGainFromPrice(initial, price)).toBe(exactGainFromPrice(initial, price));
  });

  test('typing a comma decimal through a temporary zero preserves relative targets', () => {
    let controls = newListingMovement();
    controls = rebaseListingMovement(controls, '', '0');
    controls = rebaseListingMovement(controls, '0', '0.');
    controls = rebaseListingMovement(controls, '0.', '0.8');
    expect(controls).toEqual(newListingMovement('0.8'));
  });

  test('changing the initial price rebases goals without mutating the existing program', () => {
    const original = newListingMovement('1');
    const before = JSON.stringify(original);
    expect(rebaseListingMovement(original, '1', '0.8')).toEqual(newListingMovement('0.8'));
    expect(JSON.stringify(original)).toBe(before);
    const cleared = rebaseListingMovement(newListingMovement('0.8'), '0.8', '');
    expect(rebaseListingMovement(cleared, '', '2')).toEqual(newListingMovement('2'));
  });

  test('one focus-session anchor prevents cumulative precision loss across initial-price keystrokes', () => {
    const baseline = newListingMovement('1');
    const next = '0.8765432198';
    let controls = baseline;
    for (let length = 1; length <= next.length; length++) controls = rebaseListingMovement(baseline, '1', next.slice(0, length));
    expect(controls.stages[0].targetPrice).toBe(movementPriceFromGain(next, '1725'));
    expect(controls.stages[0].targetPrice).toBe('15.9969137613');
    expect(controls.maxPrice).toBe(movementPriceFromGain(next, '9247'));
    expect(validateListingMovement(next, controls)).toBeNull();
  });

  test.each(['-', 'Infinity', 'NaN', '1e309', '', '721'])('invalid duration %s cannot reach the date formatter or be saved', input => {
    const hours = parseMovementHours(input);
    expect(Number.isNaN(hours)).toBe(true);
    expect(movementStageMoment('2026-10-07T12:00:00Z', hours)).toBe('Проверьте длительность этапа');
    const controls = newListingMovement('0.8');
    expect(validateListingMovement('0.8', { ...controls, stages: [{ ...controls.stages[0], durationHours: hours }] })).toContain('Продолжительность');
  });

  test('stage date formatting rejects malformed/out-of-range inputs and accepts finite hours/days', () => {
    expect(parseMovementHours('1,5', 'days')).toBe(36);
    expect(movementStageMoment('2026-10-07T12:00:00Z', 24)).toContain('08.10.2026');
    expect(movementStageMoment('not-a-date', 24)).toBe('Проверьте длительность этапа');
    expect(movementStageMoment('2026-10-07T12:00:00Z', Number.MAX_VALUE)).toBe('Проверьте длительность этапа');
  });

  test('contradictory day-one stages and pullback bounds receive actionable Russian errors', () => {
    const controls = newListingMovement('0.8');
    expect(validateListingMovement('0.8', controls)).toBeNull();
    expect(validateListingMovement('0.8', { ...controls, maxPrice: '10' })).toBe('Цель за первые сутки выше максимальной цены');
    expect(validateListingMovement('0.8', { ...controls, stages: [{ ...controls.stages[0], targetPrice: '15' }, controls.stages[1]] })).toContain('не совпадает');
    expect(validateListingMovement('0.8', { ...controls, stages: [{ ...controls.stages[0], durationHours: 25 }, controls.stages[1]] })).toContain('ровно через 24 часа');
    expect(validateListingMovement('0.8', { ...controls, pullbacks: { ...controls.pullbacks, minDepthPercent: '8', maxDepthPercent: '2' } })).toBe('Минимальная глубина отката не может быть больше максимальной');
    expect(validateListingMovement('0.8', { ...controls, stages: [controls.stages[0]] })).toBeNull();
  });

  test('safe server validation reasons are translated without leaking arbitrary diagnostic text', () => {
    expect(listingRequestError({ status: 422, code: 'INVALID_SCENARIO', message: 'Цель за первые сутки выше максимальной цены' })).toBe('Цель за первые сутки выше максимальной цены');
    expect(listingRequestError({ status: 422, code: 'INVALID_SCENARIO', message: 'Stack: secret=value' })).not.toContain('secret');
    expect(listingRequestError({ status: 422, code: 'PREVIEW_INTERVAL_TOO_FINE', message: 'anything' })).toContain('360');
  });

  test('preview renders actual OHLC candles and preserves the saved revision/publish safety gates', () => {
    const page = readFileSync(resolve(__dirname, '../../pages/admin/AdminListingsPage.tsx'), 'utf8');
    const chart = readFileSync(resolve(__dirname, '../../pages/admin/ListingCandlePreview.tsx'), 'utf8');
    const editor = readFileSync(resolve(__dirname, '../../pages/admin/ListingMovementEditor.tsx'), 'utf8');
    expect(chart).toContain('y(c.high)'); expect(chart).toContain('y(c.low)');
    expect(chart).toContain('y(c.open)'); expect(chart).toContain('y(c.close)');
    expect(chart).not.toMatch(/Math\.random|simulate|generate/);
    expect(page).toContain('Настройки изменены — обновите предпросмотр');
    expect(page).toContain('result.draftRevision !== editing.revision');
    expect(page).toContain('disabled={Boolean(form.simulationProgram)}');
    expect(page).toContain('simulationProgram: config.simulationProgram, wickModel: config.wickModel');
    expect(editor).toContain('Точная настройка свечей');
    expect(editor).toContain('Боковик без дальнейшего направленного роста');
    expect(editor).not.toMatch(/fetch\(|setInterval|Math\.random/);
  });
});
