import { useLanguage, localeOf } from '../../lib/i18n';
import { Panel, PanelHeader } from './Panel';
import { securityEventIcon, securityEventLabel } from './eventLabels';

// Ported from the archive's components/voltex/recent-activity.tsx — the
// archive hardcodes 3 fake events; these are the user's real last 3
// security-log entries.
export function RecentActivity({ entries }: { entries: { id: string; action: string; createdAt: string }[] }) {
  const { t, lang } = useLanguage();
  const EVENT_LABEL = securityEventLabel(t);

  return (
    <Panel>
      <PanelHeader title={t('settings.lastActivity')} />
      {entries.length === 0 ? (
        <p className="px-5 py-6 text-[13px] text-muted-foreground sm:px-6">{t('settings.securityLogEmpty')}</p>
      ) : (
        <ol className="px-5 py-2 sm:px-6">
          {entries.map((item, i) => {
            const Icon = securityEventIcon(item.action);
            return (
              <li key={item.id} className="relative flex gap-4 py-4">
                <div className="flex flex-col items-center">
                  <span className="flex size-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
                    <Icon className="size-4" />
                  </span>
                  {i < entries.length - 1 && <span className="mt-1 w-px flex-1 bg-border" />}
                </div>
                <div className="flex flex-1 items-start justify-between gap-3 pt-1.5">
                  <p className="text-[14px] font-medium text-foreground">{EVENT_LABEL[item.action] ?? item.action}</p>
                  <p className="shrink-0 text-right text-[12px] font-medium tabular-nums text-muted-foreground">
                    {new Date(item.createdAt).toLocaleString(localeOf(lang))}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
