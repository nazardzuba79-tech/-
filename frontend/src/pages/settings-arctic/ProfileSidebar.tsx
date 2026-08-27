import { BadgeCheck, HelpCircle, KeyRound, ShieldCheck, UserRound, Users, type LucideIcon } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';
import type { Tab } from './types';

// Ported from the archive's components/voltex/profile-sidebar.tsx — same
// desktop rail + mobile horizontal selector structure and classNames.
// notifications/preferences sections dropped: nothing in this app backs
// them (no notification or preference system), so keeping them would just
// be dead toggles.
const SECTIONS: { id: Tab; icon: LucideIcon }[] = [
  { id: 'profile', icon: UserRound },
  { id: 'security', icon: ShieldCheck },
  { id: 'verification', icon: BadgeCheck },
  { id: 'api', icon: KeyRound },
  { id: 'referral', icon: Users },
];

export function ProfileSidebar({ active, onSelect }: { active: Tab; onSelect: (id: Tab) => void }) {
  const { t } = useLanguage();
  const LABEL: Record<Tab, string> = {
    profile: t('settings.tab.profile'),
    security: t('settings.tab.security'),
    verification: t('settings.tab.verification'),
    api: t('settings.tab.api'),
    referral: t('settings.tab.referral'),
  };

  return (
    <>
      <nav className="hidden lg:block" aria-label="Profile sections">
        <ul className="flex flex-col gap-0.5">
          {SECTIONS.map(({ id, icon: Icon }) => {
            const isActive = active === id;
            return (
              <li key={id}>
                <button
                  onClick={() => onSelect(id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-colors duration-150 ${
                    isActive ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                  }`}
                >
                  <span
                    className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-brand transition-all duration-200 ${
                      isActive ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                  <Icon className={`size-[18px] shrink-0 transition-colors ${isActive ? 'text-brand' : 'text-muted-foreground group-hover:text-foreground'}`} />
                  {LABEL[id]}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="lg:hidden">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SECTIONS.map(({ id, icon: Icon }) => {
            const isActive = active === id;
            return (
              <button
                key={id}
                onClick={() => onSelect(id)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-[13px] font-medium transition-colors duration-150 ${
                  isActive ? 'border-transparent bg-foreground text-primary-foreground' : 'border-border bg-card text-muted-foreground'
                }`}
              >
                <Icon className="size-4" />
                {LABEL[id]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-12 flex items-start gap-2.5 border-t border-border pt-4 text-muted-foreground">
        <HelpCircle className="mt-0.5 size-[17px] shrink-0" />
        <div className="text-[11px] leading-relaxed">
          <strong className="mb-0.5 block text-[11px] text-foreground/80">{t('settings.needHelp')}</strong>
          <span>{t('settings.needHelpDesc')}</span>
        </div>
      </div>
    </>
  );
}
