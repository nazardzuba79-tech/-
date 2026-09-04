import { useMemo, useState } from 'react';
import { ArrowDownIcon, ArrowUpIcon, CircleSlash2Icon, SearchIcon, WalletIcon, WifiOffIcon } from 'lucide-react';
import { CryptoIcon } from '../../components/CryptoIcon';
import { useLanguage } from '../../lib/i18n';
import { EmptyState } from './ui';
import { MASK, decimalsFor, formatAmount, formatPercent, formatUsd, toneOf } from './format';
import { LedgerRow } from './useWalletData';

type SortKey = 'symbol' | 'total' | 'price' | 'change' | 'value';
type SortDir = 'asc' | 'desc';

/**
 * The asset ledger, in the approved V3 density: hairline rows, tabular
 * figures, the value column separated by its own rule. Search, sorting and
 * hide-zero are the same real controls the previous Wallet had.
 */
export function AssetLedger({
  rows,
  hidden,
  unavailable,
  loading,
  onDeposit,
}: {
  rows: LedgerRow[];
  hidden: boolean;
  unavailable: boolean;
  loading: boolean;
  onDeposit: () => void;
}) {
  const { t, lang } = useLanguage();
  const [query, setQuery] = useState('');
  const [hideZero, setHideZero] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('value');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expanded, setExpanded] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (hideZero && r.total === 0) return false;
      if (!q) return true;
      return r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    const num = (v: number | null) => (v === null ? -Infinity : v);
    return [...filtered].sort((a, b) => {
      if (sortKey === 'symbol') return a.symbol.localeCompare(b.symbol) * dir;
      if (sortKey === 'total') return (a.total - b.total) * dir;
      if (sortKey === 'price') return (num(a.priceUsd) - num(b.priceUsd)) * dir;
      if (sortKey === 'change') return (num(a.changePercent24h) - num(b.changePercent24h)) * dir;
      return (num(a.valueUsd) - num(b.valueUsd)) * dir;
    });
  }, [rows, query, hideZero, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'symbol' ? 'asc' : 'desc');
    }
  };

  const columns: { key: SortKey | null; label: string; align: 'left' | 'right'; sep?: boolean }[] = [
    { key: 'symbol', label: t('wallet.colAsset'), align: 'left' },
    { key: 'total', label: t('wallet.colBalance'), align: 'right' },
    { key: null, label: t('wallet.colAvailable'), align: 'right' },
    { key: null, label: t('wallet.colInOrders'), align: 'right' },
    { key: 'price', label: t('wallet.colPrice'), align: 'right' },
    { key: 'change', label: t('wallet.col24h'), align: 'right' },
    { key: 'value', label: t('wallet.colValue'), align: 'right', sep: true },
  ];

  const empty = !loading && rows.length === 0;
  const noMatch = !empty && visible.length === 0;

  return (
    <section aria-label={t('wallet.assets')} className="min-w-0">
      <div className="mb-3 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-ink">
          {t('wallet.assets')}
          {!unavailable && !empty && <span className="num ml-2 text-[12px] font-medium text-ink-4">{visible.length}</span>}
        </h2>

        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <SearchIcon
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-4"
              strokeWidth={1.7}
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('wallet.searchAsset')}
              aria-label={t('wallet.searchAsset')}
              className="h-8 w-full rounded-w border border-hair bg-panel pl-8 pr-3 text-[12.5px] text-ink outline-none transition-colors duration-150 ease-exp placeholder:text-ink-4 hover:border-hair-strong focus:border-gold sm:w-[188px]"
            />
          </div>

          <button
            type="button"
            onClick={() => setHideZero((v) => !v)}
            aria-pressed={hideZero}
            className={`flex h-8 shrink-0 items-center gap-2 rounded-w border border-hair bg-panel px-2.5 text-[12.5px] font-medium transition-colors duration-150 ease-exp hover:border-hair-strong ${
              hideZero ? 'text-ink' : 'text-ink-3 hover:text-ink-2'
            }`}
          >
            <span
              className={`relative h-3.5 w-[22px] rounded-full transition-colors duration-150 ease-exp ${
                hideZero ? 'bg-gold' : 'bg-hair-strong'
              }`}
              aria-hidden="true"
            >
              <span
                className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white shadow-sm transition-transform duration-150 ease-exp ${
                  hideZero ? 'translate-x-[9px]' : 'translate-x-0.5'
                }`}
              />
            </span>
            <span className="whitespace-nowrap">{t('wallet.hideZero')}</span>
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-wlg border border-hair bg-panel shadow-panel">
        {unavailable ? (
          <EmptyState icon={WifiOffIcon} title={t('wallet.dataUnavailable')} description={t('wallet.dataUnavailableBody')} />
        ) : loading ? (
          <div className="px-4 py-10 text-center text-[12.5px] text-ink-4">{t('wallet.loading')}</div>
        ) : empty ? (
          <EmptyState
            icon={WalletIcon}
            title={t('wallet.noAssets')}
            description={t('wallet.noAssetsBody')}
            action={
              <button
                type="button"
                onClick={onDeposit}
                className="h-8 rounded-w bg-gold px-3.5 text-[12.5px] font-semibold text-[#26190a] transition-colors duration-150 ease-exp hover:bg-gold-light"
              >
                {t('wallet.deposit')}
              </button>
            }
          />
        ) : noMatch ? (
          <EmptyState icon={CircleSlash2Icon} title={t('wallet.assetNotFound')} description={t('wallet.assetNotFoundBody')} compact />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[720px] table-fixed">
                <colgroup>
                  <col className="w-[20%]" />
                  <col className="w-[15%]" />
                  <col className="w-[13%]" />
                  <col className="w-[12%]" />
                  <col className="w-[13%]" />
                  <col className="w-[10%]" />
                  <col className="w-[17%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-hair bg-surface-1">
                    {columns.map((col) => {
                      const active = col.key && col.key === sortKey;
                      return (
                        <th
                          key={col.label}
                          scope="col"
                          aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                          className={`px-3 py-2.5 text-[10.5px] font-medium uppercase tracking-[0.07em] first:pl-4 sm:first:pl-5 ${
                            col.align === 'right' ? 'text-right' : 'text-left'
                          } ${col.sep ? 'border-l border-hair-soft' : ''} ${active ? 'text-ink-2' : 'text-ink-4'}`}
                        >
                          {col.key ? (
                            <button
                              type="button"
                              onClick={() => toggleSort(col.key!)}
                              className={`inline-flex items-center gap-1 transition-colors duration-150 ease-exp hover:text-ink-2 ${
                                col.align === 'right' ? 'flex-row-reverse' : ''
                              }`}
                            >
                              {col.label}
                              {active &&
                                (sortDir === 'asc' ? (
                                  <ArrowUpIcon className="h-3 w-3 text-gold-deep" strokeWidth={2} />
                                ) : (
                                  <ArrowDownIcon className="h-3 w-3 text-gold-deep" strokeWidth={2} />
                                ))}
                            </button>
                          ) : (
                            col.label
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => {
                    const dp = decimalsFor(r.symbol);
                    return (
                      <tr
                        key={r.symbol}
                        className="group border-b border-hair-soft transition-colors duration-150 ease-exp last:border-b-0 hover:bg-panel-2"
                      >
                        <td className="py-2.5 pl-4 pr-3 sm:pl-5">
                          <div className="flex items-center gap-2.5">
                            <CryptoIcon symbol={r.symbol} size={26} />
                            <div className="min-w-0">
                              <p className="text-[13px] font-semibold leading-4 tracking-[-0.005em] text-ink">{r.symbol}</p>
                              <p className="truncate text-[11.5px] leading-4 text-ink-4">{r.name}</p>
                            </div>
                          </div>
                        </td>
                        <td className="num px-3 py-2.5 text-right text-[12.5px] font-medium text-ink-2">
                          {hidden ? MASK : formatAmount(r.total, lang, dp)}
                        </td>
                        <td className="num px-3 py-2.5 text-right text-[12.5px] text-ink-3">
                          {hidden ? MASK : formatAmount(r.available, lang, dp)}
                        </td>
                        <td className={`num px-3 py-2.5 text-right text-[12.5px] ${r.locked > 0 ? 'text-ink-2' : 'text-ink-4'}`}>
                          {hidden ? MASK : formatAmount(r.locked, lang, dp)}
                        </td>
                        <td className="num px-3 py-2.5 text-right text-[12.5px] text-ink-2">{formatUsd(r.priceUsd, lang, r.priceUsd !== null && r.priceUsd < 1 ? 4 : 2)}</td>
                        <td className={`num px-3 py-2.5 text-right text-[12.5px] font-medium ${toneOf(r.changePercent24h)}`}>
                          {formatPercent(r.changePercent24h, lang)}
                        </td>
                        <td className="border-l border-hair-soft bg-[#fcfcfd] px-3 py-2.5 text-right group-hover:bg-transparent sm:pr-5">
                          <span
                            className={`num text-[13px] font-semibold tracking-[-0.01em] ${
                              r.valueUsd && r.valueUsd > 0 ? 'text-ink' : 'text-ink-4'
                            }`}
                          >
                            {hidden ? MASK : formatUsd(r.valueUsd, lang)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="md:hidden">
              {visible.map((r) => {
                const dp = decimalsFor(r.symbol);
                const open = expanded === r.symbol;
                return (
                  <li key={r.symbol} className="border-b border-hair-soft last:border-b-0">
                    <button
                      type="button"
                      onClick={() => setExpanded((cur) => (cur === r.symbol ? null : r.symbol))}
                      aria-expanded={open}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 ease-exp active:bg-panel-2"
                    >
                      <CryptoIcon symbol={r.symbol} size={28} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold leading-4 text-ink">{r.symbol}</p>
                        <p className="truncate text-[11.5px] leading-4 text-ink-4">{r.name}</p>
                      </div>
                      <div className="min-w-0 text-right">
                        <p className={`num truncate text-[13px] font-semibold leading-4 ${r.valueUsd && r.valueUsd > 0 ? 'text-ink' : 'text-ink-4'}`}>
                          {hidden ? MASK : formatUsd(r.valueUsd, lang)}
                        </p>
                        <p className="num truncate text-[11.5px] leading-4 text-ink-3">
                          {hidden ? MASK : `${formatAmount(r.total, lang, dp)} ${r.symbol}`}
                        </p>
                      </div>
                    </button>
                    {open && (
                      <dl className="grid grid-cols-3 gap-3 border-t border-hair-soft bg-surface-1 px-4 py-3">
                        <div>
                          <dt className="text-[10.5px] uppercase tracking-[0.06em] text-ink-4">{t('wallet.colAvailable')}</dt>
                          <dd className="num mt-1 truncate text-[12px] text-ink-2">{hidden ? MASK : formatAmount(r.available, lang, dp)}</dd>
                        </div>
                        <div>
                          <dt className="text-[10.5px] uppercase tracking-[0.06em] text-ink-4">{t('wallet.colInOrders')}</dt>
                          <dd className={`num mt-1 truncate text-[12px] ${r.locked > 0 ? 'text-ink-2' : 'text-ink-4'}`}>
                            {hidden ? MASK : formatAmount(r.locked, lang, dp)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[10.5px] uppercase tracking-[0.06em] text-ink-4">{t('wallet.colPrice')}</dt>
                          <dd className="num mt-1 truncate text-[12px] text-ink-2">{formatUsd(r.priceUsd, lang)}</dd>
                        </div>
                      </dl>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
