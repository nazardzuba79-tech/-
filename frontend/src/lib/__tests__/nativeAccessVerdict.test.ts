import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrivateTradingError } from '../privateTradingError';
import { bindingAfterAccessFailure, isOrdinaryAccountDenial } from '../nativeAccessVerdict';

const denial = () => new PrivateTradingError('Режим недоступен', 403, 'private_access_denied');

describe('the access probe failure is read as a verdict only when the server refused the account', () => {
  test('an explicit private_access_denied names an ordinary account', () => {
    expect(isOrdinaryAccountDenial(denial())).toBe(true);
    expect(bindingAfterAccessFailure(denial(), 'unknown')).toBe('ordinary');
    expect(bindingAfterAccessFailure(denial(), 'ordinary')).toBe('ordinary');
  });

  test('an owner is never released to the real engine by a later refusal', () => {
    expect(bindingAfterAccessFailure(denial(), 'owner')).toBe('owner');
    expect(bindingAfterAccessFailure(new Error('network'), 'owner')).toBe('owner');
  });

  test('an outage keeps the current binding (fail-closed while unknown)', () => {
    for (const error of [new Error('Failed to fetch'), new PrivateTradingError('Сервер не подтвердил результат', 502), new PrivateTradingError('Сессия завершена', 401), new PrivateTradingError('Forbidden', 403), new PrivateTradingError('Forbidden', 403, 'other_code'), null, undefined]) {
      expect(isOrdinaryAccountDenial(error)).toBe(false);
      expect(bindingAfterAccessFailure(error, 'unknown')).toBe('unknown');
      expect(bindingAfterAccessFailure(error, 'ordinary')).toBe('ordinary');
    }
  });

  test('the controller resolves its binding through this verdict on a failed probe', () => {
    const hook = readFileSync(resolve(__dirname, '../../pages/private-trading/useNativeDemo.tsx'), 'utf8');
    expect(hook).toContain("import { bindingAfterAccessFailure } from '../../lib/nativeAccessVerdict'");
    expect(hook).toContain('setBinding(current=>bindingAfterAccessFailure(e,current))');
  });
});
