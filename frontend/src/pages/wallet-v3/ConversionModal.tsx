import { useEffect, useRef, useState } from 'react';
import BigNumber from 'bignumber.js';
import { api, ApiError, WalletConversionQuote, WalletConversionReceipt } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { FieldError, Modal, PrimaryButton, SecondaryButton, Select, SummaryRow, TextInput } from './ui';

const PENDING_KEY = 'voltex:pending-wallet-conversion';
const DECIMAL = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/;
type Asset = { asset: string; kind: 'fiat' | 'crypto'; available: string };
function readPending() { try { return sessionStorage.getItem(PENDING_KEY); } catch { return null; } }
function clearPending() { try { sessionStorage.removeItem(PENDING_KEY); } catch { /* durable server receipt remains authoritative */ } }

/** Internal Funding/Spot balances only. Quote previews never reserve funds.
 * A timeout is an unknown outcome: keep the SAME quote ID, never auto-retry,
 * and recover the durable receipt before starting another operation.
 */
export function ConversionModal({ open, onClose, onSubmitted }: { open: boolean; onClose: () => void; onSubmitted: () => void }) {
  const { t } = useLanguage();
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<WalletConversionQuote | null>(null);
  const [done, setDone] = useState<WalletConversionReceipt | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(readPending);
  const locked = useRef(false); const generation = useRef(0);
  const available = assets?.find(a => a.asset === from)?.available;
  const valid = DECIMAL.test(amount) && new BigNumber(amount).gt(0) && available !== undefined && new BigNumber(amount).lte(available) && from !== to && !!to;
  useEffect(() => {
    if (!open) return;
    let active = true; setError(''); setAssets(null);
    if (!pending) { setDone(null); setQuote(null); }
    api.getConversionAssets().then(list => {
      if (!active) return;
      const source = list.find(a => a.asset === from)?.asset || list.find(a => new BigNumber(a.available).gt(0))?.asset || list[0]?.asset || '';
      setAssets(list); setFrom(source);
      setTo(v => v !== source && list.some(a => a.asset === v) ? v : list.find(a => a.asset === 'EUR' && a.asset !== source)?.asset || list.find(a => a.asset !== source)?.asset || '');
    }).catch(() => { if (active) setError(t('wallet.conversion.unavailable')); });
    return () => { active = false; generation.current++; };
  }, [open, t]);
  function invalidate() { generation.current++; setQuote(null); setDone(null); setError(''); }
  function applied(receipt: WalletConversionReceipt) {
    clearPending(); setPending(null); setDone(receipt); setQuote(null); onSubmitted();
  }
  async function preview() {
    if (!valid || locked.current || pending) return;
    locked.current = true; setBusy(true); setError('');
    const revision = generation.current;
    try { const result = await api.quoteConversion({ fromAsset: from, toAsset: to, amount }); if (revision === generation.current) setQuote(result); }
    catch { if (revision === generation.current) setError(t('wallet.conversion.unavailable')); }
    finally { locked.current = false; setBusy(false); }
  }
  async function confirm(id = quote?.quoteId) {
    if (!id || locked.current) return;
    locked.current = true; setBusy(true); setError('');
    // Persist BEFORE sending. A page reload may not forget an ambiguous debit.
    try { sessionStorage.setItem(PENDING_KEY, id); }
    catch { setError(t('wallet.conversion.unavailable')); locked.current = false; setBusy(false); return; }
    setPending(id);
    try { applied(await api.confirmConversion(id)); }
    catch (err) {
      if (err instanceof ApiError && ['QUOTE_EXPIRED', 'QUOTE_CHANGED', 'INSUFFICIENT_BALANCE', 'QUOTE_NOT_FOUND', 'UNSUPPORTED_ASSET', 'INVALID_CONVERSION'].includes(String(err.body.code))) {
        clearPending(); setPending(null); setQuote(null);
        setError(t(err.body.code === 'INSUFFICIENT_BALANCE' ? 'wallet.conversion.insufficient' : 'wallet.conversion.refreshQuote'));
      } else setError(t('wallet.conversion.unknown'));
    } finally { locked.current = false; setBusy(false); }
  }
  async function recover() {
    if (!pending || locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { const receipt = await api.getConversionReceipt(pending); if (receipt) applied(receipt); else setError(t('wallet.conversion.unknown')); }
    catch { setError(t('wallet.conversion.unknown')); }
    finally { locked.current = false; setBusy(false); }
  }
  const options = (except?: string) => (assets ?? []).filter(a => a.asset !== except).map(a => ({ value: a.asset, label: `${a.asset} · ${t(a.kind === 'fiat' ? 'wallet.conversion.fiat' : 'wallet.conversion.crypto')}` }));
  return <Modal open={open} onClose={onClose} title={t('wallet.conversion.title')} subtitle={t('wallet.conversion.subtitle')} footer={
    done ? <SecondaryButton onClick={onClose} full>{t('deposit.close')}</SecondaryButton> : pending ? <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={recover} className="wallet-btn wallet-btn-secondary">{t('wallet.conversion.check')}</button>
      <PrimaryButton disabled={busy} onClick={() => confirm(pending)}>{t('wallet.conversion.retry')}</PrimaryButton>
    </div> : <div className="flex gap-2"><SecondaryButton onClick={onClose} full>{t('wallet.cancel')}</SecondaryButton>
      <PrimaryButton full disabled={busy || !valid} onClick={quote ? () => confirm() : preview}>{t(quote ? 'wallet.convert' : 'wallet.conversion.preview')}</PrimaryButton></div>
  }>
    {done ? <div role="status" className="space-y-3"><p>{t('wallet.conversion.success')}</p><p className="num break-all">{done.fromAmount} {done.fromAsset} → {done.toAmount} {done.toAsset}</p></div> : <div className="space-y-4">
      {pending ? <p role="status">{t('wallet.conversion.unknown')}</p> : <fieldset disabled={busy} className="space-y-4">
        <div><label className="mb-1.5 block text-[13px] font-medium text-ink-2" htmlFor="conversion-from">{t('wallet.conversion.from')}</label><Select id="conversion-from" value={from} disabled={busy || !assets} options={options()} onChange={v => { invalidate(); setFrom(v); if (v === to) setTo(assets?.find(a => a.asset !== v)?.asset || ''); }} /></div>
        <div><label className="mb-1.5 block text-[13px] font-medium text-ink-2" htmlFor="conversion-to">{t('wallet.conversion.to')}</label><Select id="conversion-to" value={to} disabled={busy || !assets} options={options(from)} onChange={v => { invalidate(); setTo(v); }} /></div>
        <div><label className="mb-1.5 block text-[13px] font-medium text-ink-2" htmlFor="conversion-amount">{t('wallet.txAmount')}</label><TextInput id="conversion-amount" value={amount} inputMode="decimal" onChange={value => { invalidate(); setAmount(value.replace(',', '.')); }} /></div>
        <p className="text-[12px] break-all text-ink-3">{t('wallet.available')}: {available ?? '—'} {from}</p>
        {quote && <div className="space-y-2" data-conversion-quote><SummaryRow label={t('wallet.conversion.receive')} value={`${quote.toAmount} ${quote.toAsset}`} />
          <SummaryRow label={t('wallet.conversion.rate')} value={`1 ${quote.fromAsset} = ${new BigNumber(quote.toAmount).div(quote.fromAmount).toFixed()} ${quote.toAsset}`} />
          <SummaryRow label={t('wallet.conversion.fee')} value="0%" /><p className="text-[12px] text-ink-3">{t('wallet.conversion.priceNotice')}</p></div>}
      </fieldset>}
      {error && <FieldError>{error}</FieldError>}
    </div>}
  </Modal>;
}
