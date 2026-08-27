import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useLanguage, localeOf } from '../../lib/i18n';
import { Panel, PanelHeader } from './Panel';
import { securityEventLabel } from './eventLabels';

function summarizeUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  let browser = 'Unknown';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\//.test(ua)) browser = 'Opera';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua)) browser = 'Safari';

  let os = 'Unknown OS';
  if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad/.test(ua)) os = 'iOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  return `${browser} · ${os}`;
}

export function SecurityLogPanel() {
  const { t, lang } = useLanguage();
  const [entries, setEntries] = useState<Awaited<ReturnType<typeof api.getSecurityLog>> | null>(null);
  const [error, setError] = useState(false);
  const EVENT_LABEL = securityEventLabel(t);

  useEffect(() => {
    api.getSecurityLog().then(setEntries).catch(() => setError(true));
  }, []);

  return (
    <Panel className="mt-4">
      <PanelHeader title={t('settings.securityLog')} />
      <div className="px-5 py-4 sm:px-6">
        {error && <div className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{t('settings.securityLogLoadError')}</div>}
        {!error && !entries && <div className="h-24 animate-pulse rounded-xl bg-secondary" />}
        {entries && entries.length === 0 && <p className="text-[12.5px] text-muted-foreground">{t('settings.securityLogEmpty')}</p>}
        {entries && entries.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  <th className="px-2 py-2 text-left font-medium text-muted-foreground">{t('settings.securityLog.event')}</th>
                  <th className="px-2 py-2 text-left font-medium text-muted-foreground">{t('settings.securityLog.time')}</th>
                  <th className="px-2 py-2 text-left font-medium text-muted-foreground">{t('settings.securityLog.ip')}</th>
                  <th className="px-2 py-2 text-left font-medium text-muted-foreground">{t('settings.securityLog.device')}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="px-2 py-3">{EVENT_LABEL[e.action] ?? e.action}</td>
                    <td className="px-2 py-3 text-muted-foreground">{new Date(e.createdAt).toLocaleString(localeOf(lang))}</td>
                    <td className="px-2 py-3 font-mono">{e.metadata?.ip || t('settings.securityLog.unknown')}</td>
                    <td className="px-2 py-3">{summarizeUserAgent(e.metadata?.userAgent) ?? t('settings.securityLog.unknown')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Panel>
  );
}
