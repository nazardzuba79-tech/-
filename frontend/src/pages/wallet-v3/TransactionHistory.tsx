import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLineIcon,
  ArrowLeftRightIcon,
  ArrowUpFromLineIcon,
  ExternalLinkIcon,
  FileClockIcon,
  WifiOffIcon,
} from 'lucide-react';
import { api } from '../../lib/api';
import { Key, localeOf, useLanguage } from '../../lib/i18n';
import { CryptoIcon } from '../../components/CryptoIcon';
import { EmptyState } from './ui';
import { MASK, decimalsFor, formatAmount } from './format';

/**
 * Real account activity only — the exchange's own deposits, withdrawals and
 * spot fills. Nothing here is generated to fill the table: an account with
 * no history shows an empty state.
 */

type Kind = 'deposit' | 'withdraw' | 'trade';
type Status = 'done' | 'pending' | 'rejected';

interface Row {
  id: string;
  kind: Kind;
  asset: string;
  /** Signed units: positive in, negative out. */
  amount: number;
  status: Status;
  at: number;
  chain?: string;
  txHash?: string | null;
}

// Real block explorers for the two chains this deployment actually verifies
// deposits on. Never guessed for any other chain value.
const EXPLORER_TX_URL: Record<string, (tx: string) => string> = {
  bitcoin: (tx) => `https://blockstream.info/tx/${tx}`,
  tron: (tx) => `https://tronscan.org/#/transaction/${tx}`,
};

const KIND_ICON: Record<Kind, typeof ArrowDownToLineIcon> = {
  deposit: ArrowDownToLineIcon,
  withdraw: ArrowUpFromLineIcon,
  trade: ArrowLeftRightIcon,
};

const KIND_LABEL: Record<Kind, Key> = {
  deposit: 'wallet.txDeposit',
  withdraw: 'wallet.txWithdraw',
  trade: 'wallet.txTrade',
};

const STATUS_STYLE: Record<Status, { className: string; dot: string; label: Key }> = {
  done: { className: 'bg-[#eaf5f0] text-[#136f53]', dot: 'bg-[#168a65]', label: 'wallet.txDone' },
  pending: { className: 'bg-[#fbf3e3] text-[#96701e]', dot: 'bg-[#d9a441]', label: 'wallet.txPending' },
  rejected: { className: 'bg-[#fbecec] text-[#a93a43]', dot: 'bg-[#d94a56]', label: 'wallet.txRejected' },
};

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

export function TransactionHistory({ hidden }: { hidden: boolean }) {
  const { t, lang } = useLanguage();
  const [tab, setTab] = useState<'all' | Kind>('all');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    Promise.all([api.getMyDeposits(), api.getMyWithdrawals(), api.getMyTrades()])
      .then(([deposits, withdrawals, trades]) => {
        const items: Row[] = [
          ...deposits.map((d): Row => ({
            id: `dep-${d.id}`,
            kind: 'deposit',
            asset: d.asset,
            amount: Number(d.amount),
            status: depositStatus(d.status),
            at: new Date(d.createdAt).getTime(),
            chain: d.chain,
            txHash: d.txHash,
          })),
          ...withdrawals.map((w): Row => ({
            id: `wd-${w.id}`,
            kind: 'withdraw',
            asset: w.asset,
            amount: -Number(w.amount),
            status: withdrawalStatus(w.status),
            at: new Date(w.createdAt).getTime(),
          })),
          ...trades.map((tr): Row => {
            const [base] = tr.pair.split('/');
            return {
              id: `tr-${tr.id}`,
              kind: 'trade',
              asset: base,
              amount: tr.side === 'BUY' ? Number(tr.quantity) : -Number(tr.quantity),
              status: 'done',
              at: new Date(tr.executedAt).getTime(),
            };
          }),
        ];
        items.sort((a, b) => b.at - a.at);
        setRows(items);
      })
      .catch(() => setFailed(true));
  }, []);

  const visible = useMemo(() => (rows ?? []).filter((r) => tab === 'all' || r.kind === tab), [rows, tab]);

  const tabs: { id: 'all' | Kind; label: string }[] = [
    { id: 'all', label: t('wallet.txAll') },
    { id: 'deposit', label: t('wallet.txDeposits') },
    { id: 'withdraw', label: t('wallet.txWithdrawals') },
    { id: 'trade', label: t('wallet.txTrades') },
  ];

  return (
    <section aria-label={t('wallet.history')} className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-ink">{t('wallet.history')}</h2>
        <div className="flex flex-wrap items-center gap-0.5">
          {tabs.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setTab(x.id)}
              aria-pressed={tab === x.id}
              className={`h-7 rounded-wsm border px-2.5 text-[12px] transition-colors duration-150 ease-exp ${
                tab === x.id
                  ? 'border-hair-strong bg-panel-3 font-semibold text-ink'
                  : 'border-transparent font-medium text-ink-4 hover:bg-panel-2 hover:text-ink-3'
              }`}
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-wlg border border-hair bg-panel shadow-panel">
        {failed ? (
          <EmptyState icon={WifiOffIcon} title={t('wallet.dataUnavailable')} description={t('wallet.historyUnavailableBody')} compact />
        ) : rows === null ? (
          <div className="px-4 py-10 text-center text-[12.5px] text-ink-4">{t('wallet.loading')}</div>
        ) : visible.length === 0 ? (
          <EmptyState icon={FileClockIcon} title={t('wallet.noHistory')} description={t('wallet.noHistoryBody')} compact />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr className="border-b border-hair bg-surface-1 text-[10.5px] font-medium uppercase tracking-[0.07em] text-ink-4">
                  <th scope="col" className="px-4 py-2.5 text-left sm:pl-5">{t('wallet.txType')}</th>
                  <th scope="col" className="px-3 py-2.5 text-left">{t('wallet.colAsset')}</th>
                  <th scope="col" className="px-3 py-2.5 text-right">{t('wallet.txAmount')}</th>
                  <th scope="col" className="px-3 py-2.5 text-left">{t('trade.status')}</th>
                  <th scope="col" className="px-4 py-2.5 text-right sm:pr-5">{t('wallet.txDate')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.slice(0, 50).map((r) => {
                  const Icon = KIND_ICON[r.kind];
                  const s = STATUS_STYLE[r.status];
                  const explorer = r.chain && r.txHash ? EXPLORER_TX_URL[r.chain]?.(r.txHash) : undefined;
                  const dp = decimalsFor(r.asset);
                  return (
                    <tr key={r.id} className="border-b border-hair-soft transition-colors duration-150 ease-exp last:border-b-0 hover:bg-panel-2">
                      <td className="px-4 py-2.5 sm:pl-5">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-wsm border border-hair bg-panel-2">
                            <Icon className="h-3 w-3 text-ink-3" strokeWidth={1.8} />
                          </span>
                          <span className="text-[12.5px] font-medium text-ink">{t(KIND_LABEL[r.kind])}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <CryptoIcon symbol={r.asset} size={18} />
                          <span className="text-[12.5px] text-ink-2">{r.asset}</span>
                        </div>
                      </td>
                      <td className={`num px-3 py-2.5 text-right text-[12.5px] font-medium ${r.amount >= 0 ? 'text-pos' : 'text-neg'}`}>
                        {hidden ? MASK : `${r.amount > 0 ? '+' : '-'}${formatAmount(Math.abs(r.amount), lang, dp)}`}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center gap-1.5 rounded-wsm px-1.5 py-0.5 text-[11.5px] font-medium ${s.className}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
                          {t(s.label)}
                        </span>
                      </td>
                      <td className="num px-4 py-2.5 text-right text-[12px] text-ink-3 sm:pr-5">
                        <span className="inline-flex items-center gap-1.5">
                          {new Date(r.at).toLocaleDateString(localeOf(lang), { day: '2-digit', month: '2-digit', year: 'numeric' })}
                          {explorer && (
                            <a
                              href={explorer}
                              target="_blank"
                              rel="noreferrer noopener"
                              aria-label={t('wallet.viewOnExplorer')}
                              className="text-ink-4 transition-colors duration-150 hover:text-ink-2"
                            >
                              <ExternalLinkIcon className="h-3 w-3" strokeWidth={1.8} />
                            </a>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
