import { useEffect, useState } from 'react';
import { Copy, Gift } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { useLanguage, localeOf } from '../../lib/i18n';
import { copyToClipboard } from '../../lib/clipboard';
import { buildReferralLink } from '../../lib/referralLinks';
import { useReferralRegion } from '../../lib/useReferralRegion';
import { Panel, PanelHeader } from './Panel';

// Ported from the archive's components/voltex/referral-section.tsx — the
// archive hardcodes "24 referrals / $1,280 earned"; this uses the real
// referral stats/link/rewards from the account.
export function ReferralSection() {
  const { t, lang } = useLanguage();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getReferralMe>> | null>(null);
  const [region, chooseRegion] = useReferralRegion();

  useEffect(() => {
    api.getReferralMe().then(setData).catch(() => {});
  }, []);

  if (!data) {
    return (
      <Panel>
        <div className="h-40 animate-pulse rounded-2xl bg-secondary" />
      </Panel>
    );
  }

  const link = buildReferralLink(data.referralCode, region);
  const totalEarned = data.rewardsByAsset
    .map((r) => `${parseFloat(r.amount).toLocaleString(localeOf(lang), { maximumFractionDigits: 8 })} ${r.asset}`)
    .join(' + ');

  function copy() {
    if (!link) return;
    void copyToClipboard(link).then(
      () => toast.success(t('deposit.copied')),
      () => toast.error(t('deposit.ui.copyError')),
    );
  }

  return (
    <>
      <Panel>
        <PanelHeader title={t('settings.referral')} subtitle={t('settings.referralDesc', { percent: data.rewardPercent })} />
        <div className="p-5 sm:p-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-secondary/40 px-4 py-4">
              <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">{t('settings.referralCount')}</p>
              <p className="mt-1.5 text-[24px] font-semibold tabular-nums tracking-[-0.02em] text-foreground">{data.referredCount}</p>
            </div>
            <div className="rounded-xl border border-border bg-secondary/40 px-4 py-4">
              <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">{t('settings.referralEarned')}</p>
              <p className={`mt-1.5 font-semibold tabular-nums tracking-[-0.02em] text-foreground ${totalEarned ? 'truncate text-[20px]' : 'text-[13px] font-normal text-muted-foreground'}`}>
                {totalEarned || t('settings.referralNoRewardsYet')}
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 rounded-xl border border-border bg-brand-soft/50 p-4 sm:flex-row sm:items-center">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-card text-brand ring-1 ring-border">
              <Gift className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">{t('settings.referralLink')}</p>
              <div role="group" aria-label={t('settings.referralRegion')} className="my-2 inline-flex max-w-full gap-1 rounded-lg bg-secondary p-1">
                {(['world', 'ru'] as const).map(value => <button type="button" key={value} data-referral-region={value}
                  aria-pressed={region === value} onClick={() => chooseRegion(value)}
                  className={`rounded-md px-3 py-2 text-[12px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${region === value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                  {t(value === 'world' ? 'settings.referralWorld' : 'settings.referralRussia')}
                </button>)}
              </div>
              <p data-referral-link className="mt-0.5 break-all text-[13.5px] font-medium tabular-nums text-foreground">{link ?? t('settings.referralLinkUnavailable')}</p>
            </div>
            <button
              onClick={copy}
              type="button"
              disabled={!link}
              data-copy-referral
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-2.5 text-[13px] font-medium text-primary-foreground transition-all duration-150 hover:opacity-90 active:scale-[0.98]"
            >
              <Copy className="size-4" />
              {t('deposit.copy')}
            </button>
          </div>
        </div>
      </Panel>

      {data.recentRewards.length > 0 && (
        <Panel className="mt-4">
          <PanelHeader title={t('settings.referralRecentRewards')} />
          <div className="overflow-x-auto px-5 py-2 sm:px-6">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  <th className="px-2 py-2 text-left font-medium text-muted-foreground">{t('settings.referralRewardDate')}</th>
                  <th className="px-2 py-2 text-left font-medium text-muted-foreground">{t('settings.referralRewardAmount')}</th>
                </tr>
              </thead>
              <tbody>
                {data.recentRewards.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-2 py-3 text-muted-foreground">{new Date(r.createdAt).toLocaleString(localeOf(lang))}</td>
                    <td className="px-2 py-3 font-mono">{parseFloat(r.amount).toLocaleString(localeOf(lang), { maximumFractionDigits: 8 })} {r.asset}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}
