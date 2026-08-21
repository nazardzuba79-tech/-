import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';

export function BalanceStrip() {
  const { t } = useLanguage();
  const [balances, setBalances] = useState<{ asset: string; available: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    function load() {
      api
        .getBalances()
        .then((res) => !cancelled && setBalances(res))
        .catch(() => {});
    }
    load();
    const poll = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, []);

  if (balances.length === 0) {
    return <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{t('balance.zero')}</span>;
  }

  return (
    <div style={{ display: 'flex', gap: 14 }}>
      {balances.map((b) => (
        <span key={b.asset} className="mono" style={{ fontSize: 12 }}>
          <span style={{ color: 'var(--text-secondary)' }}>{b.asset} </span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{parseFloat(b.available).toFixed(4)}</span>
        </span>
      ))}
    </div>
  );
}
