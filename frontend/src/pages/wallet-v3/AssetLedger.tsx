import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, CircleSlash2Icon, EllipsisIcon, SearchIcon, WalletIcon, WifiOffIcon } from 'lucide-react';
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
  onTransfer,
  onWithdraw,
}: {
  rows: LedgerRow[];
  hidden: boolean;
  unavailable: boolean;
  loading: boolean;
  onDeposit: () => void;
  onTransfer: () => void;
  onWithdraw: () => void;
}) {
  const { t, lang } = useLanguage();
  const [query, setQuery] = useState('');
  const [hideZero, setHideZero] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('value');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ symbol: string; left: number; top: number } | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement | null>(null);

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

  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const dismiss = () => setMenu(null);
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && !menuTrigger.current?.contains(event.target)) dismiss();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); dismiss(); menuTrigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keydown);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', keydown);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [menu]);

  useEffect(() => {
    setMenu(null);
  }, [query, hideZero, sortKey, sortDir, unavailable, loading]);

  function rowActions(row: LedgerRow) {
    return <div className="wallet-ledger-row-actions flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-[13px] font-medium">
      {/* Rows include a market-wide catalogue, not a supported-pair list.
          Open the real terminal without inventing an ASSET/USDT market. */}
      <Link to="/trade" className="wallet-ledger-trade rounded-wsm py-1 text-gold-deep transition-colors hover:text-ink">{t('wallet.tradeAction')}</Link>
      <button type="button" onClick={onTransfer} className="wallet-ledger-transfer rounded-wsm py-1 text-ink-3 transition-colors hover:text-ink">{t('wallet.transfer')}</button>
      <button type="button" aria-label={`${t('wallet.actions')} · ${row.symbol}`} aria-haspopup="menu" aria-expanded={menu?.symbol === row.symbol}
        className="wallet-ledger-more flex h-7 w-7 shrink-0 items-center justify-center rounded-w text-ink-3 transition-colors hover:bg-surface-1 hover:text-ink"
        onClick={event => {
          if (menu?.symbol === row.symbol) { setMenu(null); return; }
          menuTrigger.current = event.currentTarget;
          const rect = event.currentTarget.getBoundingClientRect();
          setMenu({ symbol: row.symbol, left: Math.max(12, Math.min(rect.right - 168, window.innerWidth - 180)),
            top: rect.bottom + 108 > window.innerHeight ? Math.max(12, rect.top - 104) : rect.bottom + 6 });
        }}><EllipsisIcon className="h-4 w-4" strokeWidth={1.8} /></button>
    </div>;
  }

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
    { key: 'change', label: t('wallet.col24h'), align: 'right' },
    { key: 'value', label: t('wallet.colValue'), align: 'right', sep: true },
    { key: null, label: t('wallet.actions'), align: 'right' },
  ];

  const empty = !loading && rows.length === 0;
  const noMatch = !empty && visible.length === 0;

  return (
    <section ref={sectionRef} aria-label={t('wallet.assets')} className="wallet-asset-ledger min-w-0">
      <div className="mb-3 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-[16px] font-semibold tracking-normal text-ink">
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
              className="h-9 w-full rounded-w border border-hair bg-panel pl-8 pr-3 text-[13px] text-ink outline-none transition-colors duration-150 ease-exp placeholder:text-ink-4 hover:border-hair-strong focus:border-gold sm:w-[200px]"
            />
          </div>

          <button
            type="button"
            onClick={() => setHideZero((v) => !v)}
            aria-pressed={hideZero}
            className={`flex h-9 shrink-0 items-center gap-2 rounded-w border border-hair bg-panel px-2.5 text-[13px] font-medium transition-colors duration-150 ease-exp hover:border-hair-strong ${
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
            <div className="wallet-ledger-desktop hidden overflow-x-auto md:block">
              <table className="w-full min-w-[760px] table-fixed">
                <colgroup>
                  <col className="w-[17%]" />
                  <col className="w-[17%]" />
                  <col className="w-[17%]" />
                  <col className="w-[9%]" />
                  <col className="w-[16%]" />
                  <col className="w-[24%]" />
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
                          className={`px-3 py-3 text-[12px] font-medium normal-case tracking-normal first:pl-4 sm:first:pl-5 ${
                            col.align === 'right' ? 'text-right' : 'text-left'
                          } ${col.sep ? 'border-l border-hair-soft' : ''} ${active ? 'text-ink-2' : 'text-ink-3'}`}
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
                        <td className="py-3 pl-4 pr-3 sm:pl-5">
                          <div className="flex items-center gap-2.5">
                            <CryptoIcon symbol={r.symbol} size={30} />
                            <div className="min-w-0">
                              <p className="text-[14px] font-semibold leading-5 tracking-normal text-ink">{r.symbol}</p>
                              <p className="truncate text-[12px] leading-4 text-ink-4">{r.name}</p>
                            </div>
                          </div>
                        </td>
                        <td className="num px-3 py-3 text-right text-[14px] font-medium text-ink-2">
                          <span className="wallet-ledger-quantity">{hidden ? MASK : `${formatAmount(r.total, lang, dp)} ${r.symbol}`}</span>
                        </td>
                        <td className="num px-3 py-3 text-right text-[14px] font-medium text-ink-3">
                          <span className="wallet-ledger-available">{hidden ? MASK : `${formatAmount(r.available, lang, dp)} ${r.symbol}`}</span>
                          {r.locked > 0 && <small className="wallet-ledger-locked mt-1 block text-[11.5px] font-normal text-ink-4">{t('wallet.colInOrders')}: {hidden ? MASK : `${formatAmount(r.locked, lang, dp)} ${r.symbol}`}</small>}
                        </td>
                        <td className={`num px-3 py-3 text-right text-[14px] font-medium ${toneOf(r.changePercent24h)}`}>
                          {formatPercent(r.changePercent24h, lang)}
                        </td>
                        <td className="wallet-ledger-value border-l border-hair-soft bg-[#fcfcfd] px-3 py-3 text-right group-hover:bg-transparent">
                          <span
                            className={`num text-[14px] font-semibold tracking-[-0.01em] ${
                              r.valueUsd && r.valueUsd > 0 ? 'text-ink' : 'text-ink-4'
                            }`}
                          >
                            {hidden ? MASK : formatUsd(r.valueUsd, lang)}
                          </span>
                        </td>
                        <td className="px-3 py-3 sm:pr-5">{rowActions(r)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="wallet-ledger-mobile md:hidden">
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
                      <CryptoIcon symbol={r.symbol} size={30} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-semibold leading-5 text-ink">{r.symbol}</p>
                        <p className="truncate text-[12px] leading-4 text-ink-4">{r.name}</p>
                      </div>
                      <div className="min-w-0 text-right">
                        <p className="wallet-ledger-mobile-quantity num text-[14px] font-semibold leading-5 text-ink">
                          {hidden ? MASK : `${formatAmount(r.total, lang, dp)} ${r.symbol}`}
                        </p>
                        <p className="wallet-ledger-mobile-value num text-[12px] leading-4 text-ink-3">
                          {hidden ? MASK : `${r.valueUsd !== null ? '≈ ' : ''}${formatUsd(r.valueUsd, lang)}`}
                        </p>
                      </div>
                      <ChevronDownIcon aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 text-ink-4 transition-transform ${open ? 'rotate-180' : ''}`} />
                    </button>
                    {open && (
                      <div className="wallet-ledger-mobile-detail border-t border-hair-soft bg-surface-1 px-4 py-3">
                      <dl className="grid grid-cols-2 gap-3">
                        <div>
                          <dt className="text-[12px] normal-case tracking-normal text-ink-3">{t('wallet.colAvailable')}</dt>
                          <dd className="num mt-1 text-[14px] font-medium text-ink-2">{hidden ? MASK : `${formatAmount(r.available, lang, dp)} ${r.symbol}`}</dd>
                          {r.locked > 0 && <dd className="wallet-ledger-locked num mt-1 text-[11.5px] text-ink-4">{t('wallet.colInOrders')}: {hidden ? MASK : `${formatAmount(r.locked, lang, dp)} ${r.symbol}`}</dd>}
                        </div>
                        <div>
                          <dt className="text-[12px] normal-case tracking-normal text-ink-3">{t('wallet.col24h')}</dt>
                          <dd className={`num mt-1 text-[14px] font-medium ${toneOf(r.changePercent24h)}`}>{formatPercent(r.changePercent24h, lang)}</dd>
                        </div>
                      </dl>
                      <div className="mt-3 border-t border-hair-soft pt-2">{rowActions(r)}</div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
      {menu && sectionRef.current && createPortal(
        <div ref={menuRef} role="menu" aria-label={`${t('wallet.actions')} · ${menu.symbol}`}
          className="wallet-ledger-action-menu fixed z-50 w-[168px] rounded-w border border-hair bg-panel p-1 shadow-panel"
          style={{ left: menu.left, top: menu.top }}
          onKeyDown={event => {
            if (event.key === 'Tab') { menuTrigger.current?.focus(); setMenu(null); return; }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
              : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[next]?.focus();
          }}>
          {[[t('wallet.deposit'), onDeposit], [t('wallet.withdraw'), onWithdraw]].map(([label, action]) => (
            <button key={label as string} type="button" role="menuitem" className="block w-full rounded-wsm px-3 py-2 text-left text-[13px] text-ink-2 hover:bg-surface-1"
              onClick={() => { setMenu(null); menuTrigger.current?.focus(); (action as () => void)(); }}>{label as string}</button>
          ))}
        </div>, sectionRef.current.closest('.vx-wallet') ?? sectionRef.current,
      )}
    </section>
  );
}
