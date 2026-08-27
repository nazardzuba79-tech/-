import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { Panel, PanelHeader } from './Panel';
import { StatusBadge } from './StatusBadge';

function coverageTone(ratio: number | null): 'success' | 'warning' | 'danger' | 'neutral' {
  if (ratio === null) return 'neutral';
  if (ratio >= 1) return 'success';
  if (ratio >= 0.9) return 'warning';
  return 'danger';
}

// Self-serve proof-of-reserves table — no equivalent in the archive
// (its account is a demo with no real balances), restyled to the same
// Panel/table language as everything else on this page.
export function ReservesPanel() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.getReserves>> | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.getReserves().then(setRows).catch(() => setError(true));
  }, []);

  return (
    <Panel className="mt-4">
      <PanelHeader title={t('settings.reserves')} subtitle={t('settings.reservesDisclaimer')} />
      <div className="px-5 py-4 sm:px-6">
        {error && <div className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{t('settings.reservesLoadError')}</div>}
        {!error && !rows && <div className="h-24 animate-pulse rounded-xl bg-secondary" />}
        {rows && rows.length === 0 && <p className="text-[12.5px] text-muted-foreground">{t('settings.reservesEmpty')}</p>}
        {rows && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  <th className="px-2 py-2 text-left font-medium text-muted-foreground">{t('settings.reserves.chain')}</th>
                  <th className="px-2 py-2 text-left font-medium text-muted-foreground">{t('settings.reserves.asset')}</th>
                  <th className="px-2 py-2 text-left font-medium text-muted-foreground">{t('settings.reserves.liabilities')}</th>
                  <th className="px-2 py-2 text-left font-medium text-muted-foreground">{t('settings.reserves.onChain')}</th>
                  <th className="px-2 py-2 text-left font-medium text-muted-foreground">{t('settings.reserves.coverage')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.chain}-${r.asset}`} className="border-t border-border">
                    <td className="px-2 py-3">{r.chain}</td>
                    <td className="px-2 py-3">{r.asset}</td>
                    <td className="px-2 py-3 font-mono">{parseFloat(r.internalLiabilities).toFixed(8)}</td>
                    <td className="px-2 py-3 font-mono">{r.onChainBalance !== null ? parseFloat(r.onChainBalance).toFixed(8) : t('settings.reserves.unavailable')}</td>
                    <td className="px-2 py-3">
                      <StatusBadge tone={coverageTone(r.coverageRatio)}>
                        {r.coverageRatio !== null ? `${(r.coverageRatio * 100).toFixed(1)}%` : t('settings.reserves.unavailable')}
                      </StatusBadge>
                    </td>
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
