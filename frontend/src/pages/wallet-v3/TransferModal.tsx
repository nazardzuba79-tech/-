import { useEffect, useMemo, useState } from 'react';
import { ArrowRightIcon, ArrowUpDownIcon } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { FieldError, FieldLabel, Modal, PrimaryButton, SecondaryButton, Select, SummaryRow, TextInput } from './ui';
import { decimalsFor, formatAmount } from './format';

type Side = 'spot' | 'futures';

/**
 * The approved V3 transfer design, on the real Spot <-> Futures transfer.
 *
 * The limit on each side is that wallet's own real `available`. A Wallet
 * presentation profile does not appear here and cannot raise it; the server
 * re-checks the balance on submit either way.
 */
export function TransferModal({ open, onClose, onSubmitted }: { open: boolean; onClose: () => void; onSubmitted: () => void }) {
  const { t, lang } = useLanguage();
  const [spot, setSpot] = useState<{ asset: string; available: string }[]>([]);
  const [futures, setFutures] = useState<{ asset: string; available: string }[]>([]);
  const [from, setFrom] = useState<Side>('spot');
  const [asset, setAsset] = useState('USDT');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const load = () => {
    api.getBalances().then(setSpot).catch(() => setSpot([]));
    api.getFuturesBalances().then(setFutures).catch(() => setFutures([]));
  };

  useEffect(() => {
    if (!open) return;
    setDone(false);
    setServerError(null);
    load();
  }, [open]);

  const to: Side = from === 'spot' ? 'futures' : 'spot';
  const sourceRows = from === 'spot' ? spot : futures;
  const assetOptions = useMemo(() => {
    const set = new Set<string>(['USDT', ...spot.map((b) => b.asset), ...futures.map((b) => b.asset)]);
    return [...set];
  }, [spot, futures]);

  const available = Number(sourceRows.find((b) => b.asset === asset)?.available ?? 0);
  const parsed = Number(amount.replace(',', '.'));
  const amountEntered = amount.trim() !== '';

  const error = useMemo(() => {
    if (!amountEntered) return null;
    if (!Number.isFinite(parsed) || parsed <= 0) return t('wallet.amountMustBePositive');
    if (parsed > available) {
      return t('wallet.insufficientAvailable', { amount: formatAmount(available, lang, decimalsFor(asset)), asset });
    }
    return null;
  }, [amountEntered, parsed, available, asset, lang, t]);

  const canSubmit = amountEntered && !error && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setServerError(null);
    try {
      await api.transferFuturesFunds(asset, String(parsed), from === 'spot' ? 'TO_FUTURES' : 'TO_SPOT');
      setDone(true);
      setAmount('');
      load();
      onSubmitted();
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : t('futures.transferError'));
    } finally {
      setSubmitting(false);
    }
  }

  const label = (s: Side) => (s === 'spot' ? t('wallet.spot') : t('wallet.futures'));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('wallet.transferTitle')}
      subtitle={t('wallet.transferSubtitle')}
      footer={
        done ? (
          <SecondaryButton onClick={onClose} full>
            {t('deposit.close')}
          </SecondaryButton>
        ) : (
          <div className="flex items-center gap-2">
            <SecondaryButton onClick={onClose} full>
              {t('wallet.cancel')}
            </SecondaryButton>
            <PrimaryButton disabled={!canSubmit} onClick={submit} full>
              {submitting ? t('auth.wait') : t('wallet.transfer')}
            </PrimaryButton>
          </div>
        )
      }
    >
      {done ? (
        <p className="rounded-w border border-[#cfe6dc] bg-[#eaf5f0] px-3 py-3 text-[12.5px] leading-[18px] text-[#136f53]">
          {t('wallet.transferDone')}
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-stretch gap-2">
            <div className="min-w-0 flex-1 rounded-w border border-hair bg-panel-2 px-3 py-2.5">
              <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-4">{t('wallet.transferFrom')}</p>
              <p className="mt-1 truncate text-[13px] font-semibold text-ink">{label(from)}</p>
            </div>
            <div className="flex items-center">
              <ArrowRightIcon className="h-3.5 w-3.5 text-ink-4" strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1 rounded-w border border-hair bg-panel-2 px-3 py-2.5">
              <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-4">{t('wallet.transferTo')}</p>
              <p className="mt-1 truncate text-[13px] font-semibold text-ink">{label(to)}</p>
            </div>
            <button
              type="button"
              onClick={() => setFrom(to)}
              aria-label={t('wallet.swapDirection')}
              className="flex w-10 shrink-0 items-center justify-center rounded-w border border-hair bg-panel-2 text-ink-3 transition-colors duration-150 ease-exp hover:border-hair-strong hover:text-ink"
            >
              <ArrowUpDownIcon className="h-4 w-4" strokeWidth={1.7} />
            </button>
          </div>

          <div>
            <FieldLabel>{t('wallet.colAsset')}</FieldLabel>
            <Select
              value={asset}
              onChange={(v) => {
                setAsset(v);
                setAmount('');
              }}
              options={assetOptions.map((a) => ({ value: a, label: a }))}
            />
          </div>

          <div>
            <FieldLabel hint={`${t('wallet.available')}: ${formatAmount(available, lang, decimalsFor(asset))} ${asset}`}>
              {t('wallet.txAmount')}
            </FieldLabel>
            <TextInput
              value={amount}
              onChange={setAmount}
              inputMode="decimal"
              placeholder="0.00"
              invalid={!!error}
              mono
              suffix={
                <button
                  type="button"
                  onClick={() => setAmount(String(available))}
                  className="rounded-wsm border border-hair px-1.5 py-0.5 text-[11px] font-semibold text-ink-3 transition-colors duration-150 ease-exp hover:border-hair-strong hover:text-ink"
                >
                  {t('wallet.max')}
                </button>
              }
            />
            {error && <FieldError>{error}</FieldError>}
          </div>

          <div className="rounded-w border border-hair bg-surface-1 px-3.5 py-2">
            <SummaryRow label={`${label(from)} — ${t('wallet.available')}`} value={`${formatAmount(available, lang, decimalsFor(asset))} ${asset}`} />
            <SummaryRow label={t('wallet.transferFee')} value={t('wallet.noFee')} strong />
          </div>

          {serverError && <FieldError>{serverError}</FieldError>}
        </div>
      )}
    </Modal>
  );
}
