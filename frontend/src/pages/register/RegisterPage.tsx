import { useLanguage } from '../../lib/i18n';
import { AuthShell } from '../auth-shell/AuthShell';
import { RegisterPanel } from './RegisterPanel';

/**
 * /register — the approved split authentication screen with the
 * registration form in its light workspace.
 *
 * Everything visual lives in AuthShell, which /login renders too, so the
 * two screens cannot drift apart. This file's only job is to say which
 * form goes in the slot and where the header's switch link points.
 */
export function RegisterPage() {
  const { t } = useLanguage();

  return (
    <AuthShell
      switchPrompt={t('register.haveAccount')}
      switchLabel={t('auth.login')}
      switchTo={`/login${window.location.search}`}
    >
      <RegisterPanel />
    </AuthShell>
  );
}
