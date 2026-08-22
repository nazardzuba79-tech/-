import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useLanguage, localeOf } from '../lib/i18n';
import { Nav } from '../components/Nav';
import { DepositModal } from '../components/DepositModal';
import { SearchInput } from '../components/SearchInput';
import { CryptoIcon } from '../components/CryptoIcon';

interface Balance {
  asset: string;
  available: string;
  locked: string;
}

const STABLE_ASSETS = new Set(['USDT', 'USDC', 'USD']);

/**
 * Portfolio overview across everything the account actually holds — total
 * USD value (priced off the same Kraken mirror the trade page uses) plus a
 * per-asset breakdown. Deliberately doesn't split this into separate
 * "Funding" / "Unified Trading" / futures sub-accounts the way Bybit's
 * overview does: this exchange has exactly one balance per asset per user,
 * so inventing account-type buckets here would just be fictional UI.
 */
export function WalletPage() {
  const { t, lang } = useLanguage();
  const [balances, setBalances] = useState<Balance[]>([]);
  const [priceByAsset, setPriceByAsset] = useState<Record<string, number>>({});
  const [showDeposit, setShowDeposit] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    function load() {
      api.getBalances().then(setBalances).catch(() => {});
      api
        .getExternalTickers()
        .then((res) => {
          const prices: Record<string, number> = {};
          for (const tk of res.tickers) {
            const [base, quote] = tk.pair.split('/');
            if (quote === 'USDT') prices[base] = parseFloat(tk.lastPrice);
          }
          setPriceByAsset(prices);
        })
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, 8000);
    return () => clearInterval(interval);
  }, []);

  function priceOf(asset: string): number | null {
    if (STABLE_ASSETS.has(asset)) return 1;
    return priceByAsset[asset] ?? null;
  }

  const rows = balances.map((b) => {
    const total = parseFloat(b.available) + parseFloat(b.locked);
    const price = priceOf(b.asset);
    const value = price !== null ? total * price : null;
    return { ...b, total, price, value };
  });

  const totalUsd = rows.reduce((sum, r) => sum + (r.value ?? 0), 0);
  const btcPrice = priceOf('BTC');
  const btcEquivalent = btcPrice ? totalUsd / btcPrice : null;
  const filteredRows = rows.filter((r) => r.asset.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={styles.page}>
      <Nav active="/wallet" />
      <main style={styles.main}>
        <div style={styles.headerRow}>
          <div>
            <div style={styles.eyebrow}>{t('wallet.title')}</div>
            <div style={styles.totalValue}>
              {totalUsd.toLocaleString(localeOf(lang), { maximumFractionDigits: 2 })}{' '}
              <span style={styles.totalCurrency}>USD</span>
            </div>
            {btcEquivalent !== null && (
              <div style={styles.btcLine}>{t('wallet.approxBtc', { amount: btcEquivalent.toFixed(8) })}</div>
            )}
          </div>
          <button onClick={() => setShowDeposit(true)} style={styles.depositBtn}>
            {t('wallet.deposit')}
          </button>
        </div>

        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('wallet.searchAsset')}
          style={styles.search}
        />

        <div style={styles.table}>
          <div style={styles.columns}>
            <span>{t('wallet.asset')}</span>
            <span style={{ textAlign: 'right' }}>{t('wallet.available')}</span>
            <span style={{ textAlign: 'right' }}>{t('wallet.locked')}</span>
            <span style={{ textAlign: 'right' }}>{t('wallet.price')}</span>
            <span style={{ textAlign: 'right' }}>{t('wallet.value')}</span>
          </div>
          <div style={styles.rows}>
            {filteredRows.map((r) => (
              <div key={r.asset} style={styles.row}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }} className="mono">
                  <CryptoIcon symbol={r.asset} size={22} />
                  {r.asset}
                </span>
                <span className="mono" style={{ textAlign: 'right' }}>
                  {parseFloat(r.available).toFixed(6)}
                </span>
                <span className="mono" style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                  {parseFloat(r.locked).toFixed(6)}
                </span>
                <span className="mono" style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                  {r.price !== null ? r.price.toLocaleString(localeOf(lang), { maximumFractionDigits: 2 }) : '—'}
                </span>
                <span className="mono" style={{ textAlign: 'right' }} title={r.value === null ? t('wallet.priceUnavailable') : undefined}>
                  {r.value !== null
                    ? r.value.toLocaleString(localeOf(lang), { maximumFractionDigits: 2 })
                    : '—'}
                </span>
              </div>
            ))}
            {rows.length === 0 && <p style={styles.hint}>{t('wallet.noAssets')}</p>}
            {rows.length > 0 && filteredRows.length === 0 && <p style={styles.hint}>{t('markets.nothingFound')}</p>}
          </div>
        </div>
      </main>

      {showDeposit && <DepositModal onClose={() => setShowDeposit(false)} />}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' },
  main: { padding: '32px', maxWidth: 900, margin: '0 auto', width: '100%' },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 32,
    gap: 16,
  },
  eyebrow: { fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 },
  totalValue: { fontSize: 34, fontWeight: 800, fontFamily: 'var(--font-mono)' },
  totalCurrency: { fontSize: 16, color: 'var(--text-secondary)', fontWeight: 600 },
  btcLine: { fontSize: 13, color: 'var(--text-tertiary)', marginTop: 6, fontFamily: 'var(--font-mono)' },
  search: { width: 260, marginBottom: 14 },
  depositBtn: {
    background: 'var(--accent)',
    color: '#0b0e11',
    border: 'none',
    borderRadius: 24,
    padding: '11px 22px',
    fontWeight: 800,
    fontSize: 13,
    boxShadow: '0 4px 16px rgba(247,166,0,0.3)',
    flexShrink: 0,
  },
  table: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  columns: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr',
    padding: '12px 18px',
    fontSize: 11,
    color: 'var(--text-tertiary)',
    borderBottom: '1px solid var(--border)',
  },
  rows: { display: 'flex', flexDirection: 'column' },
  row: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr',
    padding: '14px 18px',
    fontSize: 13,
    alignItems: 'center',
    borderTop: '1px solid var(--border)',
  },
  hint: { padding: 24, color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center' },
};
