import type { useLanguage } from '../../lib/i18n';

export type Tab = 'profile' | 'security' | 'verification' | 'api' | 'referral';
export type T = ReturnType<typeof useLanguage>['t'];
