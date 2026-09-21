import { useEffect, useState } from 'react';
import { ArrowRightIcon, FileClockIcon, WifiOffIcon } from 'lucide-react';
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
type Status = 'done' | 'pending' | 'rejected' | 'belowMinimum';

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
  if (status === 'BELOW_MINIMUM') return 'belowMinimum';
  return 'pending';
}

function withdrawalStatus(status: string): Status {
  if (status === 'SENT') return 'done';
  if (status === 'REJECTED') return 'rejected';
  return 'pending';
}

const STATUS_TONE: Record<Status, string> = {
  belowMinimum: 'text-gold-deep',
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

  const statusLabel = (s: Status) => (s === 'belowMinimum' ? t('wallet.history.status.BELOW_MINIMUM') : s === 'done' ? t('wallet.txDone') : s === 'pending' ? t('wallet.txPending') : t('wallet.txRejected'));

  return (
    <section aria-label={t('wallet.recentActivity')} className="wallet-recent-activity wallet-card">
      <div className="wallet-card-head">
        <h2 className="wallet-card-title">{t('wallet.recentActivity')}</h2>
        <button type="button" onClick={onAll} className="wallet-recent-all wallet-link">
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
        <ul className="wallet-recent-list">
          {flows.map((f) => {
            const dp = decimalsFor(f.asset);
            const negative = f.amount < 0;
            return (
              <li key={f.id} className="wallet-recent-row" data-kind={f.kind} data-status={f.status}>
                <strong className="text-[13px] font-semibold text-ink">{t(f.kind === 'deposit' ? 'wallet.depositShort' : 'wallet.withdraw')}</strong>
                <b className={`num whitespace-nowrap text-right text-[13px] font-semibold ${negative ? 'text-ink' : 'text-pos'}`}>
                  {hidden ? MASK : `${negative ? '−' : '+'} ${formatAmount(Math.abs(f.amount), lang, dp)} ${f.asset}`}
                </b>
                <small className="num text-[11px] text-ink-4">{new Date(f.at).toLocaleString(lang)}</small>
                <small className={`text-right text-[11px] font-medium ${STATUS_TONE[f.status]}`}>● {statusLabel(f.status)}</small>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
