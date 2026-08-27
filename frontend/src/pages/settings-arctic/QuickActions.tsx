import { ArrowUpRight, BadgeCheck, KeyRound, ShieldCheck, Users, type LucideIcon } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';
import type { Tab } from './types';

// Ported from the archive's components/voltex/quick-actions.tsx.
export function QuickActions({ onNavigate }: { onNavigate: (id: Tab) => void }) {
  const { t } = useLanguage();
  const ACTIONS: { id: Tab; icon: LucideIcon; title: string; description: string }[] = [
    { id: 'security', icon: ShieldCheck, title: t('settings.tab.security'), description: t('settings.quickAction.security.desc') },
    { id: 'verification', icon: BadgeCheck, title: t('settings.tab.verification'), description: t('settings.quickAction.verification.desc') },
    { id: 'api', icon: KeyRound, title: t('settings.tab.api'), description: t('settings.quickAction.api.desc') },
    { id: 'referral', icon: Users, title: t('settings.tab.referral'), description: t('settings.quickAction.referral.desc') },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {ACTIONS.map((action) => (
        <button
          key={action.id}
          onClick={() => onNavigate(action.id)}
          className="group relative flex flex-col items-start gap-3 overflow-hidden rounded-2xl border border-border bg-card p-5 text-left shadow-premium transition-all duration-200 hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-premium-lg"
        >
          <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-foreground transition-colors duration-200 group-hover:bg-brand-soft group-hover:text-brand">
            <action.icon className="size-5" />
          </span>
          <div>
            <p className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">{action.title}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{action.description}</p>
          </div>
          <ArrowUpRight className="absolute right-4 top-4 size-4 text-muted-foreground/50 transition-all duration-200 group-hover:right-3.5 group-hover:top-3.5 group-hover:text-brand" />
        </button>
      ))}
    </div>
  );
}
