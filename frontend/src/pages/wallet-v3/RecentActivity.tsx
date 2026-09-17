import { useEffect, useState } from 'react';
import { ArrowRightIcon, FileClockIcon, WifiOffIcon } from 'lucide-react';
import { CryptoIcon } from '../../components/CryptoIcon';
import { api } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { EmptyState } from './ui';
import { MASK, decimalsFor, formatAmount } from './format';

/**
 * The last few deposits and withdrawals, on the Overview.
 *
 * The same two real sources the full history reads — `/deposits/me` and
 * `/withdrawals/me` — cut to the most recent entries. Trades are left to the
 * full history: this card is the account's money in and money out. Statuses
 * are mapped exactly as the full history maps them, so the same row cannot
 * read "done" here and "pending" there.
 *
 * An account with no flows yet shows an empty state, never sample rows.
 */
type Status = 'done' | 'pending' | 'rejected';

interface Flow {
  id: string;
  kind: 'deposit' | 'withdraw';
  asset: string;
  amount: number;
  status: Status;
  at: number;
}

const LIMIT = 6;

function depositStatus(status: string): Status {
  if (status === 'CREDITED') return 'done';
  if (status === 'BELOW_MINIMUM') return 'rejected';
  return 'pending';
}

function withdrawalStatus(status: string): Status {
  if (status === 'SENT') return 'done';
  if (status === 'REJECTED') return 'rejected';
  return 'pending';
}

const STATUS_TONE: Record<Status, string> = {
  done: 'text-pos',
  pending: 'text-gold-deep',
  rejected: 'text-neg',
};

export function RecentActivity({ hidden, onAll }: { hidden: boolean; onAll: () => void }) {
  const { t, lang } = useLanguage();
  const [flows, setFlows] = useState<Flow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([api.getMyDeposits(), api.getMyWithdrawals()])
      .then(([deposits, withdrawals]) => {
        if (!alive) return;
        const list: Flow[] = [
          ...deposits.map((d) => ({
            id: `d-${d.id}`,
            kind: 'deposit' as const,
            asset: d.asset,
            amount: Number(d.amount),
            status: depositStatus(d.status),
            at: new Date(d.createdAt).getTime(),
          })),
          ...withdrawals.map((w) => ({
            id: `w-${w.id}`,
            kind: 'withdraw' as const,
            asset: w.asset,
            amount: -Number(w.amount),
            status: withdrawalStatus(w.status),
            at: new Date(w.createdAt).getTime(),
          })),
        ];
        list.sort((a, b) => b.at - a.at);
        setFlows(list.slice(0, LIMIT));
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const statusLabel = (s: Status) => (s === 'done' ? t('wallet.txDone') : s === 'pending' ? t('wallet.txPending') : t('wallet.txRejected'));

  return (
    <section aria-label={t('wallet.recentActivity')} className="wallet-recent-activity rounded-wlg border border-hair bg-panel shadow-panel">
      <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
        <h2 className="text-[15px] font-semibold tracking-normal text-ink">{t('wallet.recentActivity')}</h2>
        <button
          type="button"
          onClick={onAll}
          className="wallet-recent-all flex items-center gap-1 rounded-wsm px-1.5 py-1 text-[12.5px] font-semibold text-ink-2 transition-colors duration-150 ease-exp hover:bg-panel-3 hover:text-ink"
        >
          {t('wallet.allActivity')}
          <ArrowRightIcon className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>

      {failed ? (
        <EmptyState icon={WifiOffIcon} title={t('wallet.dataUnavailable')} description={t('wallet.historyUnavailableBody')} compact />
      ) : flows === null ? (
        <div className="px-5 py-8 text-center text-[13px] leading-5 text-ink-3">{t('wallet.loading')}</div>
      ) : flows.length === 0 ? (
        <EmptyState icon={FileClockIcon} title={t('wallet.noActivity')} description={t('wallet.noHistoryBody')} compact />
      ) : (
        <ul className="wallet-recent-list px-5 pb-4 pt-1">
          {flows.map((f) => {
            const dp = decimalsFor(f.asset);
            const negative = f.amount < 0;
            return (
              <li key={f.id} className="wallet-recent-row" data-kind={f.kind} data-status={f.status}>
                <CryptoIcon symbol={f.asset} size={26} />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-ink">
                    {t(f.kind === 'deposit' ? 'wallet.txDeposit' : 'wallet.txWithdraw')}
                  </span>
                  <span className="num block text-[11px] leading-4 text-ink-4">{new Date(f.at).toLocaleString(lang)}</span>
                </span>
                <span className="text-right">
                  <span className={`num block whitespace-nowrap text-[13px] font-semibold ${negative ? 'text-ink' : 'text-pos'}`}>
                    {hidden ? MASK : `${negative ? '−' : '+'} ${formatAmount(Math.abs(f.amount), lang, dp)} ${f.asset}`}
                  </span>
                  <span className={`block text-[11px] font-medium leading-4 ${STATUS_TONE[f.status]}`}>● {statusLabel(f.status)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
