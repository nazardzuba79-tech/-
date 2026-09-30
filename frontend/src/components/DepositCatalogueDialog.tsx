import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Copy, Info, QrCode, Search, X } from 'lucide-react';
import QRCode from 'qrcode';
import { localeOf, useLanguage } from '../lib/i18n';
import { useDepositSelection, useDepositWallets } from '../lib/useDepositOptions';
import { CryptoIcon } from './CryptoIcon';
import { depositAssetMetadata } from '../lib/depositAssetMetadata';
import { depositMinimumView, type HeldQuote } from '../lib/depositMinimum';
import { marketDataStore } from '../lib/marketDataStore';
import { orderDepositDestinations } from '../lib/depositOrder';
import './DepositCatalogueDialog.css';

/** The asset's price as the page already holds it — read, never fetched or
 *  subscribed to. Whether it is usable is `depositMinimumView`'s decision. */
function heldQuote(asset: string): HeldQuote | null {
  const { tickers, tickersMeta } = marketDataStore.getState();
  const ticker = tickers.get(`${asset}/USDT`);
  return ticker && tickersMeta ? { price: ticker.lastPrice, fetchedAt: tickersMeta.fetchedAt, stale: tickersMeta.stale } : null;
}

type Step = 'address' | 'qr';

/** One address-only UI for both entrypoints. No trading/balance API is used. */
export function DepositCatalogueDialog({ onClose, initialAsset }: { onClose: () => void; initialAsset?: string }) {
  const { t, lang } = useLanguage();
  const [retry, setRetry] = useState(0);
  const { loaded, wallets, error } = useDepositWallets(true, retry);
  // USDT on TRC-20 first: the window opens on it unless the page asked for an asset.
  const ordered = useMemo(() => orderDepositDestinations(wallets), [wallets]);
  const selection = useDepositSelection(ordered, initialAsset);
  const { assets, asset, setAsset, networks, wallet, setChain } = selection;
  const [step, setStep] = useState<Step>('address');
  // The asset list is a menu over the window: a popover under the «Актив»
  // field on a wide screen, a bottom sheet on a phone (CSS decides).
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const assetTrigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const ids = { asset: useId(), assetValue: useId(), menu: useId(), menuTitle: useId(), network: useId() };
  const [copyState, setCopyState] = useState<{ field: string; ok: boolean } | null>(null);
  const copyGeneration = useRef(0);
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const destinationKey = `${asset}|${wallet?.chain ?? ''}|${wallet?.address ?? ''}|${wallet?.memo ?? ''}`;
  const currentDestination = useRef(destinationKey);
  currentDestination.current = destinationKey;
  const metadata = depositAssetMetadata[asset];
  const minimum = depositMinimumView(asset, heldQuote(asset));
  // An estimate leaves the screen when its price ages out, even while nothing
  // else re-renders: one timeout per shown estimate, no request, no polling.
  const [, setEstimateClock] = useState(0);
  useEffect(() => {
    if (minimum.estimateExpiresAt === null) return;
    const timer = setTimeout(() => setEstimateClock(tick => tick + 1), Math.max(0, minimum.estimateExpiresAt - Date.now()) + 25);
    return () => clearTimeout(timer);
  }, [minimum.estimateExpiresAt]);
  const amount = (value: number) => value.toLocaleString(localeOf(lang), { maximumSignificantDigits: 4, useGrouping: true });
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
  // Opening the menu moves focus into it: the search field with a mouse or
  // keyboard, the chosen asset on a touch screen (no keyboard pop-up).
  useEffect(() => {
    if (!menuOpen) return;
    const fine = typeof matchMedia !== 'function' || matchMedia('(pointer: fine)').matches;
    const target = fine ? menu.current?.querySelector<HTMLElement>('input')
      : menu.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? menu.current?.querySelector<HTMLElement>('input');
    target?.focus({ preventScroll: true });
    // A press anywhere else in the window closes it. The backdrop (phone)
    // and the dimmed page around the window (desktop) close it on their own
    // click instead, so that press closes the menu only, never the window.
    const outside = (event: PointerEvent) => {
      const node = event.target as Element;
      if (menu.current?.contains(node) || assetTrigger.current?.contains(node) || node === overlay.current || node.classList?.contains('dc-menu-backdrop')) return;
      setMenuOpen(false); setSearch('');
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [menuOpen]);

  const resetCopy = () => { copyGeneration.current++; setCopyState(null); };
  const changeStep = (next: Step) => { resetCopy(); setStep(next); };
  const closeMenu = (refocus = true) => { setMenuOpen(false); setSearch(''); if (refocus) assetTrigger.current?.focus({ preventScroll: true }); };
  const chooseAsset = (symbol: string) => { resetCopy(); setAsset(symbol); setChain(''); setStep('address'); closeMenu(); };
  const chooseNetwork = (chain: string) => { resetCopy(); setChain(chain); };
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

  return createPortal(<div ref={overlay} className="dc-overlay" onClick={event => { if (event.target !== event.currentTarget) return; if (menuOpen) closeMenu(false); else closeRef.current(); }}>
    <div ref={panel} className="dc-dialog" role="dialog" aria-modal="true" aria-label={t('deposit.title')} tabIndex={-1}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); if (menuOpen) closeMenu(); else if (step !== 'address') changeStep('address'); else closeRef.current(); }
        if (event.key === 'Tab') {
          const controls = [...panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input,a[href],[tabindex="0"]')].filter(el => el.getClientRects().length);
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <header className="dc-header">
        <h2>{t('deposit.title')}</h2>
        <button className="dc-icon-button dc-close" onClick={() => closeRef.current()} aria-label={t('deposit.close')}><X size={20}/></button>
      </header>
      <div className="dc-content">
        {!loaded ? <div className="dc-state" role="status"><span className="dc-loading"/>{t('wallet.loading')}</div>
        : error ? <div className="dc-state" role="alert"><Info size={28}/><p>{t('deposit.loadAddressError')}</p><button className="dc-primary" onClick={() => { resetCopy(); setRetry(x => x + 1); }}>{t('deposit.ui.retry')}</button></div>
        : !wallet ? <div className="dc-state">{t('deposit.noneConfigured')}</div>
        : <>
          <section className="dc-identity">{icon(asset, 52)}<h3>{t('deposit.ui.yourAddress', { asset })}</h3></section>
          {/* Asset: a field that reads as one — label, the chosen asset in
              full, and a chevron — not a small link under the heading. */}
          <div className="dc-field">
            <span className="dc-field-label" id={ids.asset}>{t('deposit.ui.asset')}</span>
            <div className="dc-asset-field">
              <button ref={assetTrigger} type="button" className={`dc-asset-trigger ${menuOpen ? 'is-open' : ''}`}
                aria-haspopup="listbox" aria-expanded={menuOpen} aria-controls={menuOpen ? ids.menu : undefined}
                aria-labelledby={`${ids.asset} ${ids.assetValue}`} onClick={() => menuOpen ? closeMenu() : (resetCopy(), setMenuOpen(true))}>
                {icon(asset, 30)}
                <span className="dc-asset-value" id={ids.assetValue}><strong>{asset}</strong><span>{metadata?.name ?? asset}</span></span>
                <span className="dc-trigger-chevron" aria-hidden="true"><ChevronDown size={20} strokeWidth={2.6}/></span>
              </button>
              {menuOpen && <>
                <div className="dc-menu-backdrop" aria-hidden="true" onClick={() => closeMenu()}/>
                <div ref={menu} className="dc-menu" id={ids.menu}>
                  <div className="dc-menu-head"><h3 id={ids.menuTitle}>{t('deposit.ui.chooseAsset')}</h3>
                    <button type="button" className="dc-icon-button dc-menu-close" onClick={() => closeMenu()} aria-label={t('deposit.close')}><X size={20}/></button></div>
                  <label className="dc-search"><Search size={18}/><input placeholder={t('deposit.ui.search')} aria-label={t('deposit.ui.search')} value={search}
                    onChange={e => setSearch(e.target.value)}
                    onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); menu.current?.querySelector<HTMLElement>('[role="option"]')?.focus(); } }}/></label>
                  <div className="dc-asset-list" role="listbox" aria-label={t('deposit.ui.chooseAsset')} onKeyDown={event => {
                    if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
                    event.preventDefault();
                    const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]')];
                    const index = options.indexOf(document.activeElement as HTMLButtonElement);
                    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
                    options[next]?.focus();
                  }}>
                    {shownAssets.map(symbol => <button type="button" role="option" aria-selected={symbol === asset} key={symbol} className={`dc-asset-row ${symbol === asset ? 'is-selected' : ''}`} onClick={() => chooseAsset(symbol)}>
                      {icon(symbol, 32)}<span className="dc-asset-label"><strong>{symbol}</strong><small>{depositAssetMetadata[symbol]?.name ?? symbol}</small></span>
                      {symbol === asset && <Check size={19} aria-hidden="true"/>}
                    </button>)}
                  </div>
                  {!shownAssets.length && <p className="dc-empty">{t('deposit.ui.noResults')}</p>}
                </div>
              </>}
            </div>
          </div>
          {/* Network: its own question, asked after the asset. Every network
              that carries the asset is on screen at once. */}
          <div className="dc-field">
            <span className="dc-field-label" id={ids.network}>{t('deposit.network')}</span>
            {networks.length > 1 ? <>
              <div className="dc-networks" role="radiogroup" aria-labelledby={ids.network} onKeyDown={event => {
                if (!['ArrowRight','ArrowDown','ArrowLeft','ArrowUp'].includes(event.key)) return;
                event.preventDefault();
                const group = event.currentTarget;
                const index = networks.findIndex(item => item.chain === wallet.chain);
                const next = networks[(index + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + networks.length) % networks.length];
                chooseNetwork(next.chain);
                requestAnimationFrame(() => group.querySelector<HTMLElement>(`[data-chain="${next.chain}"]`)?.focus());
              }}>
                {networks.map(item => <button key={item.chain} type="button" role="radio" data-chain={item.chain} aria-checked={item.chain === wallet.chain} tabIndex={item.chain === wallet.chain ? 0 : -1}
                  className={`dc-network-option ${item.chain === wallet.chain ? 'is-selected' : ''}`} onClick={() => chooseNetwork(item.chain)}>
                  <span><strong>{item.networkName}</strong>{item.standard && item.standard !== 'Native' && <small>{item.standard}</small>}</span>
                  {item.chain === wallet.chain && <Check size={17} aria-hidden="true"/>}
                </button>)}
              </div>
              <p className="dc-field-hint">{t('deposit.ui.networkHint', { asset })}</p>
            </> : <div className="dc-network"><span><strong>{network}</strong></span><Check size={17} aria-hidden="true"/></div>}
          </div>
          {/* The rule before the address: seen before anything is copied. */}
          {/* Two lines (owner, 2026-09-29): the minimum in the chosen coin's
              terms, then one plain sentence. */}
          <section className="dc-minimum" data-testid="deposit-minimum">
            <p className="dc-minimum-line"><strong>{minimum.pegged
              ? t('deposit.ui.minimumPeggedLine', { amount: amount(minimum.usd), asset })
              : t('deposit.ui.minimumOtherLine', { amount: amount(minimum.usd), asset })}</strong>
              {minimum.estimate !== null && <span className="dc-minimum-estimate" data-testid="deposit-minimum-equivalent">{' '}{t('deposit.ui.minimumApprox', { amount: amount(minimum.estimate), asset })}</span>}</p>
            <p className="dc-minimum-note">{t('deposit.ui.minimumNote')}</p>
          </section>
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
