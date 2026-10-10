import { StockRequestError, globalStockErrorText } from '../../pages/stocks/stockRequestError';

test('known admission errors remain useful without showing server text', () => {
  expect(globalStockErrorText(new StockRequestError('QUOTE_STALE').code)).toContain('устарела');
  expect(globalStockErrorText('FX_UNAVAILABLE')).toContain('курса');
  expect(globalStockErrorText('INSUFFICIENT_FUNDS')).toContain('Недостаточно');
});
test.each(['<html>bad gateway</html>', 'TypeError: private.ts:42', 'DATABASE_URL=secret', '__proto__', 'constructor', 'UNKNOWN_ENGINE_CODE'])('untrusted error %s cannot render', code => {
  expect(globalStockErrorText(new StockRequestError(code).code)).not.toContain(code);
  expect(globalStockErrorText(code)).toBe('Не удалось выполнить запрос. Повторите попытку.');
});
test('non-string response codes fail closed', () => {
  expect(globalStockErrorText({ message: 'secret' })).toBe('Не удалось выполнить запрос. Повторите попытку.');
  expect(new StockRequestError(null).code).toBe('LOCAL_SERVICE_ERROR');
});
