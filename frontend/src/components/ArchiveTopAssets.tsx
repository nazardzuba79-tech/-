import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { useFuturesReference } from '../lib/useFuturesReference';
import { topCapitalizationAssets } from '../lib/topCapitalization';

type Ranking = Awaited<ReturnType<typeof api.getExternalRankings>>['rankings'][number];

export function ArchiveTopAssets({ symbols, onSelect }: { symbols: string[]; onSelect: (pair: string) => void }) {
  const { lang } = useLanguage();
  const reference = useFuturesReference();
  const [assets, setAssets] = useState<Ranking[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await api.getExternalRankings();
        if (!cancelled) { setAssets(topCapitalizationAssets(result.rankings)); setFailed(false); }
      } catch { if (!cancelled) setFailed(true); }
    };
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  const label = lang === 'ru' ? 'Топ-8 по капитализации · без стейблкоинов' : 'Top 8 by market cap · excluding stablecoins';
  return <div className="archive-top-assets" aria-label={label} title={label}>
    {assets.length === 0 ? <span className="archive-top-assets-status">{failed ? (lang === 'ru' ? 'Рыночные данные временно недоступны' : 'Market data unavailable') : '—'}</span> :
      assets.map(asset => {
        const pair = `${asset.symbol.toUpperCase()}/USDT`;
        const selectable = symbols.includes(pair);
        const change = reference.get(pair)?.changePercent24h ?? asset.changePercent24h;
        const known = change !== null && Number.isFinite(change);
        const content = <><strong>{selectable ? pair.replace('/', '') : asset.symbol}</strong><span className={known ? change! >= 0 ? 'text-buy' : 'text-sell' : ''}>{known ? `${change! > 0 ? '+' : ''}${change!.toFixed(2)}%` : '—'}</span></>;
        return selectable ? <button type="button" key={asset.symbol} onClick={() => onSelect(pair)} aria-label={`${pair} · ${asset.name}`}>{content}</button> : <span className="archive-top-asset" key={asset.symbol}>{content}</span>;
      })}
  </div>;
}
