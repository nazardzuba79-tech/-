import { readFileSync } from 'fs';
import { resolve } from 'path';
import { failureText, SUPPORT_FAILURE_TEXT } from '../../pages/admin/supportFailureText';

/**
 * Support in the frontend: the admin page is a lazy admin route with its
 * own nav entry, the widget cannot send one click twice and says so when a
 * send fails, and every stored failure category reads as plain words.
 */

const src = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');

describe('Admin → Поддержка', () => {
  test('is a lazy route under /admin with a nav entry', () => {
    const app = src('App.tsx');
    expect(app).toContain("const AdminSupportPage = lazy(() => import('./pages/admin/AdminSupportPage')");
    expect(app).toContain('<Route path="support" element={<AdminSupportPage />} />');
    expect(src('pages/admin/AdminLayout.tsx')).toContain("{ to: '/admin/support', label: 'Поддержка', icon: MessageSquareIcon, group: 'Управление' }");
  });

  test('never shows credentials: only the recipient, configured flags, counts and categories', () => {
    const page = src('pages/admin/AdminSupportPage.tsx');
    expect(page).not.toMatch(/SMTP_PASS|SMTP_USER|password|пароль/i);
    expect(page).toContain('Отправить тестовое письмо');
  });

  test('every server failure category has plain words', () => {
    for (const category of ['NOT_CONFIGURED', 'AUTH', 'CONNECTION', 'RECIPIENT_REJECTED', 'MESSAGE_REJECTED', 'TEMPORARY', 'UNKNOWN']) {
      expect(SUPPORT_FAILURE_TEXT[category]).toBeTruthy();
    }
    expect(failureText('AUTH', 535)).toBe('SMTP отклонил логин или пароль (код 535)');
    expect(failureText(null)).toBe('');
  });
});

describe('support widget', () => {
  const widget = src('components/SupportWidget.tsx');
  test('one click is one message: submits are guarded by refs, not only by a disabled button', () => {
    expect(widget).toContain('if (startingRef.current) return;');
    expect(widget).toContain("if (!conversation || !body || sendingRef.current) return;");
  });
  test('a failed send is shown and the draft kept', () => {
    expect(widget).toContain("setSendError(customerErrorText(err, t, t('support.startError')));");
    expect(widget).toContain('{sendError && <div role="alert"');
  });
  test('inputs cannot exceed what the server accepts', () => {
    expect(widget).toContain('maxLength={100}');
    expect(widget).toContain('maxLength={254}');
    expect(widget.match(/maxLength=\{2000\}/g)).toHaveLength(2);
  });
  test('on phones the launcher and panel clear the bottom tab bar', () => {
    const css = src('components/SupportWidget.css');
    expect(css).toContain('body:has(.bottom-nav) .support-launcher');
    expect(css).toContain('max-height: calc(100dvh - 140px);');
  });
});
