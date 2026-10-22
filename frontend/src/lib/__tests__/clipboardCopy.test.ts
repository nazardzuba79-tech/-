import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { copyToClipboard } from '../clipboard';

const originalNavigator = (globalThis as { navigator?: unknown }).navigator;
const setNavigator = (value: unknown) => Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
afterEach(() => setNavigator(originalNavigator));

describe('copyToClipboard reports the real outcome', () => {
  test('resolves when the browser accepted the write, with the exact text', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    setNavigator({ clipboard: { writeText } });
    await expect(copyToClipboard('TRX-address-1')).resolves.toBeUndefined();
    expect(writeText).toHaveBeenCalledWith('TRX-address-1');
  });

  test('rejects when the browser refused (permission, focus), never a silent unhandled rejection', async () => {
    setNavigator({ clipboard: { writeText: jest.fn().mockRejectedValue(new DOMException('Document is not focused', 'NotAllowedError')) } });
    await expect(copyToClipboard('x')).rejects.toBeInstanceOf(DOMException);
  });

  test('rejects on an insecure origin, where navigator.clipboard is absent', async () => {
    setNavigator({});
    await expect(copyToClipboard('x')).rejects.toThrow('Clipboard is not available');
    setNavigator(undefined);
    await expect(copyToClipboard('x')).rejects.toThrow('Clipboard is not available');
  });

  test('a synchronous throw from writeText becomes a rejection too', async () => {
    setNavigator({ clipboard: { writeText: () => { throw new TypeError('boom'); } } });
    await expect(copyToClipboard('x')).rejects.toThrow('boom');
  });

  test('the Settings copy buttons wait for the outcome and say which one it was', () => {
    for (const file of ['AccountOverview', 'ApiSection', 'ReferralSection']) {
      const source = readFileSync(resolve(__dirname, `../../pages/settings-arctic/${file}.tsx`), 'utf8');
      expect(source).toContain("import { copyToClipboard } from '../../lib/clipboard';");
      expect(source).not.toMatch(/navigator\.clipboard\?\.writeText\([^)]*\);\s*\n\s*toast\.success/);
      expect(source).toContain("() => toast.error(t('deposit.ui.copyError'))");
    }
  });
});
