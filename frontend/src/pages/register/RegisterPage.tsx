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
  return (
    <AuthShell>
      <RegisterPanel />
    </AuthShell>
  );
}
