import { Eye, KeyRound, LogIn, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { T } from './types';

// Shared by the security log table and the Recent Activity panel — one
// label/icon mapping instead of two copies drifting apart.
export function securityEventLabel(t: T): Record<string, string> {
  return {
    USER_LOGGED_IN: t('settings.securityLog.USER_LOGGED_IN'),
    USER_REGISTERED: t('settings.securityLog.USER_REGISTERED'),
    PASSWORD_CHANGED: t('settings.securityLog.PASSWORD_CHANGED'),
    TWO_FACTOR_ENABLED: t('settings.securityLog.TWO_FACTOR_ENABLED'),
    TWO_FACTOR_DISABLED: t('settings.securityLog.TWO_FACTOR_DISABLED'),
    TWO_FACTOR_BACKUP_CODE_USED: t('settings.securityLog.TWO_FACTOR_BACKUP_CODE_USED'),
  };
}

export function securityEventIcon(action: string): LucideIcon {
  if (action === 'USER_LOGGED_IN' || action === 'USER_REGISTERED') return LogIn;
  if (action === 'PASSWORD_CHANGED') return KeyRound;
  if (action.startsWith('TWO_FACTOR')) return ShieldCheck;
  return Eye;
}
