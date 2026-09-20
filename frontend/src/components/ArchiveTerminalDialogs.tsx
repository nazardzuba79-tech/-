import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Logo } from './Logo';
import { useLanguage } from '../lib/i18n';
import { formatPrice } from '../lib/formatNumber';
import type { FuturesPosition } from '../lib/futuresAccountStore';

function Dialog({ title, children, onClose }: { title:string; children:React.ReactNode; onClose:()=>void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog=ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className="archive-tool-dialog" aria-label={title} onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <header><strong>{title}</strong><button type="button" aria-label="Закрыть" onClick={onClose}><X size={19}/></button></header>{children}
  </dialog>;
}

/** Read-only view of the same server-reported row, not a fabricated/persisted trade card. */
export function ArchivePositionCard({ position:p, onClose }: { position:FuturesPosition; onClose:()=>void }) {
  const { t }=useLanguage();
  const finite = (value:string|null) => value !== null && value.trim() !== '' && Number.isFinite(Number(value));
  const amount = finite(p.unrealizedPnl) ? Number(p.unrealizedPnl) : null;
  const roi = finite(p.roe) ? Number(p.roe) : null;
  const money = amount === null ? '—' : `${amount > 0 ? '+' : ''}${amount.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  return <Dialog title={t('futures.pnlCard')} onClose={onClose}>
    <article className="archive-profit-card">
      <Logo/>
      <div className="archive-profit-contract"><strong>{p.symbol.replace('/','')}</strong><span className={p.side==='LONG'?'text-buy':'text-sell'}>{p.side} · {p.leverage}x</span></div>
      <span className="archive-card-caption">{t('futures.colUnrealized')}</span>
      <strong className={`archive-profit-amount ${amount !== null && amount < 0 ? 'text-sell':'text-buy'}`}>{money}<small> {p.symbol.split('/')[1]}</small></strong>
      <span className={`archive-profit-roi ${roi !== null && roi < 0 ? 'text-sell':'text-buy'}`}>{roi === null ? '—' : `${roi > 0 ? '+' : ''}${roi.toFixed(2)}%`}</span>
      <dl><div><dt>{t('futures.colEntry')}</dt><dd>{finite(p.entryPrice)?formatPrice(Number(p.entryPrice)):'—'}</dd></div><div><dt>{t('futures.colMark')}</dt><dd>{finite(p.markPrice)?formatPrice(Number(p.markPrice)):'—'}</dd></div></dl>
    </article>
  </Dialog>;
}
