import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, ChevronRight, Copy, Info, QrCode, Search, X } from 'lucide-react';
import QRCode from 'qrcode';
import { useLanguage } from '../lib/i18n';
import { useDepositSelection, useDepositWallets } from '../lib/useDepositOptions';
import { CryptoIcon } from './CryptoIcon';
import { depositAssetMetadata } from '../lib/depositAssetMetadata';
import './DepositCatalogueDialog.css';

type Step = 'address' | 'assets' | 'networks' | 'qr';

/** One address-only UI for both entrypoints. No trading/balance API is used. */
export function DepositCatalogueDialog({ onClose, initialAsset }: { onClose: () => void; initialAsset?: string }) {
  const { t } = useLanguage();
  const [retry, setRetry] = useState(0);
  const { loaded, wallets, error } = useDepositWallets(true, retry);
  const selection = useDepositSelection(wallets, initialAsset);
  const { assets, asset, setAsset, networks, wallet, setChain } = selection;
  const [step, setStep] = useState<Step>('address');
  const [search, setSearch] = useState('');
  const [copyState, setCopyState] = useState<{ field: string; ok: boolean } | null>(null);
  const copyGeneration = useRef(0);
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const destinationKey = `${asset}|${wallet?.chain ?? ''}|${wallet?.address ?? ''}|${wallet?.memo ?? ''}`;
  const currentDestination = useRef(destinationKey);
  currentDestination.current = destinationKey;
  const metadata = depositAssetMetadata[asset];
  const network = wallet ? `${wallet.networkName}${wallet.standard && wallet.standard !== 'Native' ? ` · ${wallet.standard}` : ''}` : '';
  const shownAssets = assets.filter(symbol => `${symbol} ${depositAssetMetadata[symbol]?.name ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const qr = useMemo(() => wallet?.address && step === 'qr' ? QRCode.create(wallet.address, { errorCorrectionLevel: 'M' }).modules : null, [wallet?.address, step]);

  // Parent Wallet price/account renders must not refocus the dialog or picker.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus({ preventScroll: true });
    return () => {
      copyGeneration.current++;
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => { setCopyState(null); }, [destinationKey]);
  useEffect(() => {
    if (step === 'assets') panel.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    else panel.current?.focus({ preventScroll: true });
  }, [step]);

  const resetCopy = () => { copyGeneration.current++; setCopyState(null); };
  const changeStep = (next: Step) => { resetCopy(); setStep(next); };
  const chooseAsset = (symbol: string) => { resetCopy(); setAsset(symbol); setChain(''); setSearch(''); setStep('address'); };
  const copy = async (field: 'address' | 'memo') => {
    const value = field === 'address' ? wallet?.address : wallet?.memo;
    if (!value) return;
    const key = destinationKey;
    const generation = ++copyGeneration.current;
    setCopyState(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      if (generation === copyGeneration.current && key === currentDestination.current) setCopyState({ field, ok: true });
    } catch {
      if (generation === copyGeneration.current && key === currentDestination.current) setCopyState({ field, ok: false });
    }
  };
  const icon = (symbol: string, size: number) => {
    const item = depositAssetMetadata[symbol];
    return item?.icon ? <CryptoIcon key={symbol} symbol={symbol} size={size} imageUrl={item.icon} metadataOnly />
      : <span className="dc-fallback" style={{ width: size, height: size }}>{symbol}</span>;
  };

  return createPortal(<div className="dc-overlay" onClick={event => { if (event.target === event.currentTarget) closeRef.current(); }}>
    <div ref={panel} className="dc-dialog" role="dialog" aria-modal="true" aria-label={t('deposit.title')} tabIndex={-1}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); if (step !== 'address') changeStep('address'); else closeRef.current(); }
        if (event.key === 'Tab') {
          const controls = [...panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input,a[href],[tabindex="0"]')].filter(el => el.getClientRects().length);
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <header className="dc-header">
        {step !== 'address' && <button className="dc-icon-button" onClick={() => changeStep('address')} aria-label={t('deposit.ui.back')}><ArrowLeft size={20}/></button>}
        <h2>{t(step === 'assets' ? 'deposit.ui.chooseAsset' : step === 'networks' ? 'deposit.ui.chooseNetwork' : 'deposit.title')}</h2>
        <button className="dc-icon-button dc-close" onClick={() => closeRef.current()} aria-label={t('deposit.close')}><X size={20}/></button>
      </header>
      <div className="dc-content">
        {!loaded ? <div className="dc-state" role="status"><span className="dc-loading"/>{t('wallet.loading')}</div>
        : error ? <div className="dc-state" role="alert"><Info size={28}/><p>{t('deposit.loadAddressError')}</p><button className="dc-primary" onClick={() => { resetCopy(); setRetry(x => x + 1); }}>{t('deposit.ui.retry')}</button></div>
        : !wallet ? <div className="dc-state">{t('deposit.noneConfigured')}</div>
        : step === 'assets' ? <>
          <label className="dc-search"><Search size={19}/><input placeholder={t('deposit.ui.search')} aria-label={t('deposit.ui.search')} value={search} onChange={e => setSearch(e.target.value)}/></label>
          <div className="dc-asset-list" role="listbox" aria-label={t('deposit.ui.chooseAsset')} onKeyDown={event => {
            if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
            event.preventDefault();
            const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]')];
            const index = options.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
            options[next]?.focus();
          }}>
            {shownAssets.map(symbol => <button type="button" role="option" aria-selected={symbol === asset} key={symbol} className={`dc-asset-row ${symbol === asset ? 'is-selected' : ''}`} onClick={() => chooseAsset(symbol)}>
              {icon(symbol, 40)}<span className="dc-asset-label"><strong>{depositAssetMetadata[symbol]?.name ?? symbol}</strong><small>{symbol}</small></span>
              {symbol === asset && <Check size={19} aria-hidden="true"/>}
            </button>)}
          </div>
          {!shownAssets.length && <p className="dc-empty">{t('deposit.ui.noResults')}</p>}
        </> : step === 'networks' ? <>
          <p className="dc-description">{t('deposit.ui.networkHint', { asset })}</p>
          <div role="listbox" aria-label={t('deposit.network')}>
            {networks.map(item => <button key={item.chain} role="option" aria-selected={item.chain === wallet.chain} className={`dc-network-row ${item.chain === wallet.chain ? 'is-selected' : ''}`} onClick={() => { resetCopy(); setChain(item.chain); setStep('address'); }}>
              <span><strong>{item.networkName}</strong>{item.standard !== 'Native' && <small>{item.standard}</small>}</span>{item.chain === wallet.chain && <Check size={19}/>}
            </button>)}
          </div>
        </> : <>
          <section className="dc-identity">{icon(asset, 56)}<h3>{t('deposit.ui.yourAddress', { asset })}</h3>
            <button className="dc-change" onClick={() => changeStep('assets')} aria-label={t('deposit.ui.changeAsset')}>{metadata?.name ?? asset} <ChevronRight size={14}/></button>
          </section>
          {networks.length > 1 ? <button className="dc-network" onClick={() => changeStep('networks')} aria-label={t('deposit.ui.changeNetwork')}><span><small>{t('deposit.network')}</small><strong>{network}</strong></span><ChevronRight size={18}/></button>
            : <div className="dc-network"><span><small>{t('deposit.network')}</small><strong>{network}</strong></span><Check size={17}/></div>}
          <p className="dc-warning"><Info size={17}/><span>{t('deposit.ui.sendOnly')} <strong>{asset}</strong> {t('deposit.ui.inNetwork')} <strong>{network}</strong>. {t('deposit.ui.lossWarning')}</span></p>
          <div className="dc-address-card">
            {qr && <svg className="dc-qr" role="img" aria-label={t('deposit.ui.qrLabel', { asset, network })} viewBox={`0 0 ${qr.size + 8} ${qr.size + 8}`} shapeRendering="crispEdges">
              <rect width="100%" height="100%" fill="white"/>
              <path fill="#101828" d={Array.from(qr.data).flatMap((bit, i) => bit ? [`M${i % qr.size + 4},${Math.floor(i / qr.size) + 4}h1v1h-1z`] : []).join('')}/>
            </svg>}
            <p className="dc-address" data-testid="deposit-address">{wallet.address}</p>
            <div className="dc-copy-row"><button className="dc-primary" onClick={() => void copy('address')}>
              {copyState?.field === 'address' && copyState.ok ? <Check size={19}/> : <Copy size={19}/>}
              {copyState?.field === 'address' && copyState.ok ? t('deposit.ui.copied') : t('deposit.ui.copyAddress')}
            </button><button className="dc-qr-button" aria-label={t(step === 'qr' ? 'deposit.ui.hideQr' : 'deposit.ui.showQr')} onClick={() => changeStep(step === 'qr' ? 'address' : 'qr')}><QrCode size={22}/></button></div>
            {copyState?.field === 'address' && !copyState.ok && <p className="dc-copy-error" role="alert">{t('deposit.ui.copyError')}</p>}
            {copyState?.field === 'address' && copyState.ok && <span className="dc-sr-only" role="status">{t('deposit.ui.copied')}</span>}
          </div>
          {wallet.memo?.trim() && <div className="dc-memo"><strong>{wallet.memoLabel || t('deposit.ui.memo')}</strong><p className="dc-address">{wallet.memo}</p><button className="dc-secondary" onClick={() => void copy('memo')}><Copy size={16}/>{t('deposit.ui.copyMemo')}</button>{copyState?.field === 'memo' && <p role={copyState.ok ? 'status' : 'alert'}>{t(copyState.ok ? 'deposit.ui.memoCopied' : 'deposit.ui.copyError')}</p>}</div>}
        </>}
      </div>
    </div>
  </div>, document.body);
}
