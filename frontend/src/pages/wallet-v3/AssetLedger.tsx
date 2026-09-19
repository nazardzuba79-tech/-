import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, ChevronDownIcon, CircleSlash2Icon, EllipsisIcon, SearchIcon, WalletIcon, WifiOffIcon } from 'lucide-react';
import { CryptoIcon } from '../../components/CryptoIcon';
import { useLanguage } from '../../lib/i18n';
import { useToast } from '../../lib/toast';
import { EmptyState } from './ui';
import { EM_DASH, MASK, decimalsFor, formatAmount, formatPercent, formatUsd, toneOf } from './format';
import { LedgerRow } from './useWalletData';
import { customerErrorText } from '../../lib/customerError';

type SortKey = 'symbol' | 'total' | 'wallet' | 'available' | 'inUse' | 'price' | 'change' | 'value';
type SortDir = 'asc' | 'desc';

/**
 * The asset ledger: hairline rows, tabular figures, the value column
 * separated by its own rule. Search, sorting and hide-zero are the same
 * real controls the previous Wallet had.
 *
 * `Total`, `Available` and `In use` are three columns rather than one
 * column with a footnote, because on a margin account they are three
 * different facts about the same holding and a reader checks them against
 * each other. Every one of them arrives on the row; nothing is derived
 * here. A row whose asset has no price shows its value as UNKNOWN and says
 * why — it is never rendered as $0, which would read as a worthless
 * holding rather than an unanswered one.
 */
export function AssetLedger({
  rows,
  hidden,
  unavailable,
  loading,
  collateral = false,
  onDeposit,
  onTransfer,
  onWithdraw,
  onCollateralChange,
}: {
  rows: LedgerRow[];
  hidden: boolean;
  unavailable: boolean;
  loading: boolean;
  /**
   * True on the Cross account, where every PRICED holding backs the margin.
   * The column then shows that fact per row; on a plain ledger there is no
   * collateral and the column reads as unknown.
   */
  collateral?: boolean;
  onDeposit: () => void;
  onTransfer: () => void;
  onWithdraw: () => void;
  onCollateralChange?: (asset: string, enabled: boolean) => Promise<unknown>;
}) {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [hideZero, setHideZero] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('value');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ symbol: string; left: number; top: number } | null>(null);
  const [collateralPending, setCollateralPending] = useState<Set<string>>(() => new Set());
  const sectionRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      // "Скрыть небольшие суммы (< $1)": a zero holding, or one the server
      // valued under a dollar. An UNPRICED holding is never hidden — its
      // value is unknown, not small.
      if (hideZero && (r.total === 0 || (r.valueUsd !== null && r.valueUsd < 1))) return false;
      if (!q) return true;
      return r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    const num = (v: number | null) => (v === null ? -Infinity : v);
    return [...filtered].sort((a, b) => {
      if (sortKey === 'symbol') return a.symbol.localeCompare(b.symbol) * dir;
      if (sortKey === 'total') return (a.total - b.total) * dir;
      if (sortKey === 'wallet') return (a.walletBalance - b.walletBalance) * dir;
      if (sortKey === 'available') return (a.available - b.available) * dir;
      if (sortKey === 'inUse') return (a.locked - b.locked) * dir;
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
    // One line, never wrapping: a wrapped action stack was inflating every
    // row to ~110px and clipping the column. `Торговать` is the one action
    // worth a click of its own; the rest live in the menu.
    return <div className="wallet-ledger-row-actions flex flex-nowrap items-center justify-end gap-1 text-[12.5px] font-medium">
      {/* Rows include a market-wide catalogue, not a supported-pair list.
          Open the real terminal without inventing an ASSET/USDT market. */}
      <Link to="/trade" className="wallet-ledger-trade wallet-link">{t('wallet.tradeAction')}</Link>
      <button type="button" onClick={onTransfer} className="wallet-ledger-transfer wallet-link">{t('wallet.transfer')}</button>
      <button type="button" aria-label={`${t('wallet.actions')} · ${row.symbol}`} aria-haspopup="menu" aria-expanded={menu?.symbol === row.symbol}
        className="wallet-ledger-more flex h-7 w-7 shrink-0 items-center justify-center rounded-w text-ink-3 transition-colors hover:bg-surface-1 hover:text-ink"
        onClick={event => {
          if (menu?.symbol === row.symbol) { setMenu(null); return; }
          menuTrigger.current = event.currentTarget;
          const rect = event.currentTarget.getBoundingClientRect();
          setMenu({ symbol: row.symbol, left: Math.max(12, Math.min(rect.right - 168, window.innerWidth - 180)),
            top: rect.bottom + 140 > window.innerHeight ? Math.max(12, rect.top - 136) : rect.bottom + 6 });
        }}><EllipsisIcon className="h-4 w-4" strokeWidth={1.8} /></button>
    </div>;
  }

  // Hidden-balance masking also covers the available figure, which lives
  // in the mobile detail; it is kept in the desktop row for the mask audit.
  const toggleCollateral = async (row: LedgerRow) => {
    if (!collateral || !row.collateralToggleable || !onCollateralChange || collateralPending.has(row.symbol)) return;
    setCollateralPending((current) => new Set(current).add(row.symbol));
    try {
      // No optimistic margin state: the switch follows the authoritative
      // Wallet object returned by the server mutation.
      await onCollateralChange(row.symbol, !row.collateralEnabled);
    } catch (error) {
      toast.error(customerErrorText(error, t, t('wallet.dataUnavailable')));
    } finally {
      setCollateralPending((current) => {
        const next = new Set(current);
        next.delete(row.symbol);
        return next;
      });
    }
  };

  const collateralSwitch = (row: LedgerRow) => {
    if (!collateral) return <span className="text-[13px] text-ink-4">{EM_DASH}</span>;
    const pending = collateralPending.has(row.symbol);
    const locked = !row.collateralToggleable || !onCollateralChange;
    return (
      <button
        type="button"
        className="wallet-toggle"
        role="switch"
        aria-checked={row.collateralEnabled}
        aria-disabled={locked || pending}
        disabled={locked || pending}
        aria-busy={pending}
        title={locked ? t('wallet.collateralLocked') : undefined}
        onClick={() => void toggleCollateral(row)}
      >
        <i />
      </button>
    );
  };

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'symbol' ? 'asc' : 'desc');
    }
  };

  /**
   * The approved design's six columns. `Активы` carries the quantity with
   * its USD value under it; the wallet row and the committed quantity are
   * their own columns because on a margin account they are three different
   * facts about one holding; `В качестве обеспечения` states whether the
   * holding backs the margin; the actions close the row.
   */
  const columns: { key: SortKey | null; label: string; align: 'left' | 'right' }[] = [
    { key: 'symbol', label: t('wallet.colCurrency'), align: 'left' },
    { key: 'total', label: t('wallet.assetsTotal'), align: 'left' },
    { key: 'wallet', label: t('wallet.colWalletBalance'), align: 'left' },
    { key: 'inUse', label: t('wallet.colInOrders'), align: 'left' },
    { key: null, label: t('wallet.colAsCollateral'), align: 'left' },
    { key: null, label: t('wallet.colAction'), align: 'right' },
  ];

  const empty = !loading && rows.length === 0;
  const noMatch = !empty && visible.length === 0;

  return (
    <section ref={sectionRef} aria-label={t('wallet.assets')} className="wallet-asset-ledger min-w-0">
      <div className="wallet-ledger-toolbar">
        <div className="wallet-ledger-search">
          <SearchIcon className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={1.7} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('wallet.searchAsset')}
            aria-label={t('wallet.searchAsset')}
          />
        </div>

        <button type="button" onClick={() => setHideZero((v) => !v)} aria-pressed={hideZero} className="wallet-check">
          <span className="wallet-check-box" data-on={hideZero ? 'true' : 'false'} aria-hidden="true">
            {hideZero && <CheckIcon className="h-3 w-3" strokeWidth={3} />}
          </span>
          <span className="whitespace-nowrap">{t('wallet.hideSmallUsd')}</span>
        </button>
      </div>

      <div className="wallet-card wallet-ledger-card overflow-hidden">
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
              <table className="w-full min-w-[880px] table-fixed">
                {/* An eight-figure quantity with its USD line is the widest
                    cell; the columns are sized so none can spill into its
                    neighbour. */}
                <colgroup>
                  <col className="w-[15%]" />
                  <col className="w-[19%]" />
                  <col className="w-[17%]" />
                  <col className="w-[13%]" />
                  <col className="w-[15%]" />
                  <col className="w-[21%]" />
                </colgroup>
                <thead>
                  <tr className="wallet-ledger-head">
                    {columns.map((col) => {
                      const active = col.key && col.key === sortKey;
                      return (
                        <th
                          key={col.label}
                          scope="col"
                          aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                          className={`px-3 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] first:pl-5 last:pr-5 ${
                            col.align === 'right' ? 'text-right' : 'text-left'
                          } ${active ? 'text-ink-2' : 'text-ink-3'}`}
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
                        className="wallet-ledger-tr group border-b border-hair-soft transition-colors duration-150 ease-exp last:border-b-0 hover:bg-panel-2"
                      >
                        <td className="py-3.5 pl-5 pr-3">
                          <div className="flex items-center gap-2.5">
                            <CryptoIcon symbol={r.symbol} size={32} />
                            <div className="min-w-0">
                              <p className="text-[13.5px] font-semibold leading-5 tracking-normal text-ink">{r.symbol}</p>
                              <p className="truncate text-[11.5px] leading-4 text-ink-4">
                                {r.name}
                                {r.changePercent24h !== null && (
                                  <span className={`num ml-1.5 ${toneOf(r.changePercent24h)}`}>
                                    {formatPercent(r.changePercent24h, lang)}
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3.5 text-[13px]">
                          <span className="wallet-ledger-quantity num block font-semibold text-ink">{hidden ? MASK : `${formatAmount(r.total, lang, dp)} ${r.symbol}`}</span>
                          {/* The server's valuation, under the quantity. An
                              UNPRICED holding says so — the dash alone would
                              read the same as an empty balance. */}
                          <span className="num mt-0.5 block text-[11px] leading-4 text-ink-4">
                            {r.priced && !hidden ? '≈ ' : ''}
                            <small className="wallet-ledger-value text-[11px]">
                              {hidden ? MASK : formatUsd(r.valueUsd, lang)}
                              {!r.priced && <span className="wallet-ledger-unpriced ml-1">{t('wallet.noQuote')}</span>}
                            </small>
                          </span>
                        </td>
                        <td className="num px-3 py-3.5 text-[13px] font-medium text-ink">
                          {/* The wallet row on its own: on a margin account
                              the trading ledger's balance is folded into
                              `total`, so showing both is what makes the two
                              legible. */}
                          <span className="wallet-ledger-wallet">{hidden ? MASK : formatAmount(r.walletBalance, lang, dp)}</span>
                        </td>
                        <td className="num px-3 py-3.5 text-[13px] font-medium text-ink">
                          {/* A zero here is a real answer — nothing of this
                              asset is committed — so it is shown as 0 and
                              not dashed out. */}
                          <span className="wallet-ledger-locked">{hidden ? MASK : formatAmount(r.locked, lang, dp)}</span>
                          <span className="wallet-ledger-available hidden">{hidden ? MASK : formatAmount(r.available, lang, dp)}</span>
                        </td>
                        <td className="px-3 py-3.5">{collateralSwitch(r)}</td>
                        <td className="py-3.5 pl-3 pr-5">{rowActions(r)}</td>
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
                          {hidden ? MASK : r.priced ? `${r.valueUsd !== null ? '≈ ' : ''}${formatUsd(r.valueUsd, lang)}` : t('wallet.noQuote')}
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
                        </div>
                        <div>
                          <dt className="text-[12px] normal-case tracking-normal text-ink-3">{t('wallet.colInUse')}</dt>
                          <dd className="wallet-ledger-locked num mt-1 text-[14px] font-medium text-ink-2">{hidden ? MASK : `${formatAmount(r.locked, lang, dp)} ${r.symbol}`}</dd>
                        </div>
                        <div>
                          <dt className="text-[12px] normal-case tracking-normal text-ink-3">{t('wallet.col24h')}</dt>
                          <dd className={`num mt-1 text-[14px] font-medium ${toneOf(r.changePercent24h)}`}>{formatPercent(r.changePercent24h, lang)}</dd>
                        </div>
                        {collateral && (
                          <div>
                            <dt className="text-[12px] normal-case tracking-normal text-ink-3">{t('wallet.colAsCollateral')}</dt>
                            <dd className="mt-1">{collateralSwitch(r)}</dd>
                          </div>
                        )}
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
          {[[t('wallet.deposit'), onDeposit], [t('wallet.withdraw'), onWithdraw], [t('wallet.transfer'), onTransfer]].map(([label, action]) => (
            <button key={label as string} type="button" role="menuitem" className="block w-full rounded-wsm px-3 py-2 text-left text-[13px] text-ink-2 hover:bg-surface-1"
              onClick={() => { setMenu(null); menuTrigger.current?.focus(); (action as () => void)(); }}>{label as string}</button>
          ))}
        </div>, sectionRef.current.closest('.vx-wallet') ?? sectionRef.current,
      )}
    </section>
  );
}
