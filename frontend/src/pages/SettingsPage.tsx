import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Toaster } from 'sonner';
import { api } from '../lib/api';
import { useLanguage, localeOf } from '../lib/i18n';
import { BottomNav } from '../components/BottomNav';
import { Footer } from '../components/Footer';
import './settings-arctic/tailwind-utilities.css';
import type { Tab } from './settings-arctic/types';
import { ArcticTopNav } from './settings-arctic/ArcticTopNav';
import { ProfileSidebar } from './settings-arctic/ProfileSidebar';
import { ProfileHeaderCard } from './settings-arctic/ProfileHeaderCard';
import { EditProfileModal } from './settings-arctic/EditProfileModal';
import { AccountOverview } from './settings-arctic/AccountOverview';
import { RecentActivity } from './settings-arctic/RecentActivity';
import { QuickActions } from './settings-arctic/QuickActions';
import { SecuritySection } from './settings-arctic/SecuritySection';
import { ReservesPanel } from './settings-arctic/ReservesPanel';
import { SecurityLogPanel } from './settings-arctic/SecurityLogPanel';
import { VerificationSection } from './settings-arctic/VerificationSection';
import { ApiSection } from './settings-arctic/ApiSection';
import { ReferralSection } from './settings-arctic/ReferralSection';

// "Arctic Blue" — a light, warm-white theme ported from a user-supplied
// Next.js/Tailwind/shadcn reference archive (oklch values copied verbatim
// from its globals.css). Scoped to this page only via inline custom
// properties on the root element; the Tailwind config (tailwind.config.js)
// points its color tokens (border/card/foreground/brand/...) at these same
// variables, so both the Tailwind utilities used throughout
// pages/settings-arctic/*.tsx and any leftover var(--x) references
// resolve consistently. This page renders its own ArcticTopNav (a
// structural port of the archive's header, see that file's doc comment)
// instead of the shared dark Nav every other page uses — logo/exchange
// name stay the site's own Logo component either way.
const ARCTIC_THEME_VARS = {
  '--bg': 'oklch(0.977 0.0018 247)',
  '--panel': 'oklch(1 0 0)',
  '--panel-alt': 'oklch(0.968 0.002 247)',
  '--panel-alt-hover': 'oklch(0.945 0.004 247)',
  '--border': 'oklch(0.918 0.0035 258)',
  '--text-primary': 'oklch(0.223 0.0086 264)',
  '--text-secondary': 'oklch(0.532 0.017 258)',
  '--text-tertiary': 'oklch(0.62 0.014 258)',
  '--buy': 'oklch(0.5 0.13 155)',
  '--buy-dim': 'oklch(0.955 0.03 158)',
  '--sell': 'oklch(0.577 0.245 27.325)',
  '--sell-dim': 'oklch(0.96 0.03 27)',
  '--accent': 'oklch(0.62 0.16 245)',
  '--accent-hover': 'oklch(0.56 0.17 245)',
  '--accent-dim': 'oklch(0.965 0.02 236)',
  '--neutral-dim': 'oklch(0.968 0.002 247)',
  // The archive's own success/warning tokens — distinct from --buy/--sell
  // above, which drive the site-wide trading UI and stay untouched.
  '--success': 'oklch(0.68 0.14 155)',
  '--success-soft': 'oklch(0.955 0.03 158)',
  '--warning': 'oklch(0.79 0.13 78)',
  '--warning-soft': 'oklch(0.965 0.03 88)',
  '--on-accent': 'oklch(0.99 0 0)',
  '--shadow-sm': '0 1px 2px -1px oklch(0.5 0.02 258 / 0.06), 0 2px 8px -2px oklch(0.5 0.02 258 / 0.06)',
  '--shadow-md': '0 1px 2px -1px oklch(0.5 0.02 258 / 0.05), 0 8px 24px -6px oklch(0.4 0.03 258 / 0.1)',
} as React.CSSProperties;

function kycStatusText(t: ReturnType<typeof useLanguage>['t'], status: string): string {
  if (status === 'PENDING') return t('settings.kyc.PENDING');
  if (status === 'APPROVED') return t('settings.kyc.APPROVED');
  if (status === 'REJECTED') return t('settings.kyc.REJECTED');
  return t('settings.kyc.NOT_STARTED');
}

const TABS: Tab[] = ['profile', 'security', 'verification', 'api', 'referral'];

function isTab(value: string | null): value is Tab {
  return value !== null && (TABS as string[]).includes(value);
}

export function SettingsPage() {
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  // Read once, for the initial tab only: this makes /settings?tab=security a
  // real destination (the registration success screen links straight to it)
  // without turning tab switching into navigation, which would put a history
  // entry behind every click in the sidebar.
  const [tab, setTab] = useState<Tab>(() => {
    const requested = searchParams.get('tab');
    return isTab(requested) ? requested : 'profile';
  });

  return (
    // color/fontWeight re-anchored here for the same reason adminStyles.ts
    // documents: index.css's `body { color: var(--text-primary) }`
    // resolves against the dark theme's value at body's own scope, so a
    // descendant redefining the custom property doesn't retroactively
    // change what body already inherited.
    <div style={{ ...ARCTIC_THEME_VARS, color: 'var(--text-primary)', fontWeight: 400 }} className="settings-arctic-root min-h-screen bg-background">
      <Toaster position="top-right" richColors />
      <ArcticTopNav />
      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-[28px] font-semibold tracking-[-0.03em] text-foreground sm:text-[34px]">{t('settings.title')}</h1>
          <p className="mt-1.5 text-[14px] text-muted-foreground sm:text-[15px]">{t('settings.pageSubtitle')}</p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-8">
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <ProfileSidebar active={tab} onSelect={setTab} />
          </aside>

          <div className="min-w-0">
            {tab === 'profile' && <ProfileTabContent onNavigate={setTab} />}
            {tab === 'security' && (
              <div className="flex flex-col">
                <SecuritySectionWithLog />
              </div>
            )}
            {tab === 'verification' && <VerificationSection />}
            {tab === 'api' && <ApiSection />}
            {tab === 'referral' && <ReferralSection />}
          </div>
        </div>

        <Footer />
      </main>
      <BottomNav />
    </div>
  );
}

function ProfileTabContent({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const { t, lang } = useLanguage();
  const [me, setMe] = useState<Awaited<ReturnType<typeof api.getMe>> | null>(null);
  const [recentActivity, setRecentActivity] = useState<Awaited<ReturnType<typeof api.getSecurityLog>>>([]);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    api.getMe().then(setMe).catch(() => {});
    api
      .getSecurityLog()
      .then((entries) => setRecentActivity(entries.slice(0, 3)))
      .catch(() => {});
  }, []);

  if (!me) {
    return (
      <div className="flex flex-col gap-6">
        <div className="h-40 animate-pulse rounded-2xl bg-secondary" />
        <div className="h-64 animate-pulse rounded-2xl bg-secondary" />
      </div>
    );
  }

  const displayName = me.displayName || me.email.split('@')[0];
  const verified = me.kycStatus === 'APPROVED';
  const statusText = kycStatusText(t, me.kycStatus);
  const roleLabel = me.isAdmin ? t('settings.roleAdmin') : t('settings.roleUser');
  const memberSince = new Date(me.createdAt).toLocaleDateString(localeOf(lang));

  return (
    <div className="flex flex-col gap-6">
      <ProfileHeaderCard
        name={displayName}
        email={me.email}
        roleLabel={roleLabel}
        verified={verified}
        statusText={statusText}
        memberSince={memberSince}
        avatarUrl={me.avatarUrl}
        onAvatarChange={(avatarUrl) => setMe((prev) => (prev ? { ...prev, avatarUrl } : prev))}
        onEdit={() => setEditOpen(true)}
      />

      <EditProfileModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        me={me}
        onSaved={(patch) => setMe((prev) => (prev ? { ...prev, ...patch } : prev))}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <AccountOverview email={me.email} accountId={me.id} roleLabel={roleLabel} verifiedLabel={statusText} verified={verified} memberSince={memberSince} />
        <RecentActivity entries={recentActivity} />
      </div>

      <div>
        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{t('settings.quickActionsTitle')}</h2>
        <QuickActions onNavigate={onNavigate} />
      </div>
    </div>
  );
}

function SecuritySectionWithLog() {
  const { lang } = useLanguage();
  const [me, setMe] = useState<Awaited<ReturnType<typeof api.getMe>> | null>(null);
  const [lastPasswordChange, setLastPasswordChange] = useState<string | null>(null);

  function reload() {
    api.getMe().then(setMe).catch(() => {});
    api
      .getSecurityLog()
      .then((entries) => {
        const last = entries.find((e) => e.action === 'PASSWORD_CHANGED');
        setLastPasswordChange(last ? new Date(last.createdAt).toLocaleDateString(localeOf(lang)) : null);
      })
      .catch(() => {});
  }
  useEffect(reload, []);

  if (!me) return <div className="h-40 animate-pulse rounded-2xl bg-secondary" />;

  return (
    <>
      <SecuritySection twoFactorEnabled={me.twoFactorEnabled} lastPasswordChange={lastPasswordChange} onChanged={reload} />
      <ReservesPanel />
      <SecurityLogPanel />
    </>
  );
}
