import { useEffect, useMemo, useState } from 'react';
import { InfoIcon } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { FieldError, FieldLabel, Modal, PrimaryButton, SecondaryButton, Select, SummaryRow, TextInput } from './ui';
import { decimalsFor, formatAmount } from './format';

const NETWORKS = ['TRC20', 'ERC20', 'BEP20', 'native'];

/**
 * The approved V3 withdraw design, on the real withdrawal backend.
 *
 * What can be withdrawn is the account's real spot `available` — the
 * ledger, and nothing else. A Wallet presentation profile cannot raise it:
 * this modal never sees that profile, and the server re-checks the balance
 * when the request is submitted regardless.
 */
export function WithdrawModal({ open, onClose, onSubmitted }: { open: boolean; onClose: () => void; onSubmitted: () => void }) {
  const { t, lang } = useLanguage();
  const [balances, setBalances] = useState<{ asset: string; available: string; locked: string }[]>([]);
  const [asset, setAsset] = useState('');
  const [network, setNetwork] = useState('TRC20');
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDone(false);
    setServerError(null);
    api
      .getBalances()
      .then((res) => {
        const funded = res.filter((b) => parseFloat(b.available) > 0);
        setBalances(funded);
        setAsset((cur) => cur || funded[0]?.asset || '');
      })
      .catch(() => setBalances([]));
  }, [open]);

  const selected = balances.find((b) => b.asset === asset) ?? null;
  const available = selected ? parseFloat(selected.available) : 0;
  const parsed = Number(amount.replace(',', '.'));
  const amountEntered = amount.trim() !== '';

  const amountError = useMemo(() => {
    if (!amountEntered) return null;
    if (!Number.isFinite(parsed) || parsed <= 0) return t('wallet.amountMustBePositive');
    if (parsed > available) {
      return t('wallet.insufficientAvailable', {
        amount: formatAmount(available, lang, decimalsFor(asset)),
        asset,
      });
    }
    return null;
  }, [amountEntered, parsed, available, asset, lang, t]);

  const addressError = address.trim().length > 0 && address.trim().length < 20 ? t('wallet.addressTooShort') : null;
  const canSubmit = !!selected && address.trim().length >= 20 && amountEntered && !amountError && !addressError && !submitting;

  async function submit() {
    if (!canSubmit || !selected) return;
    setSubmitting(true);
    setServerError(null);
    try {
      await api.requestWithdrawal({ asset, network, toAddress: address.trim(), amount: String(parsed) });
      setDone(true);
      setAddress('');
      setAmount('');
      onSubmitted();
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : t('wallet.withdrawError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('wallet.withdrawTitle')}
      subtitle={t('wallet.fromSpotAccount')}
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
              {submitting ? t('auth.wait') : t('wallet.confirmWithdraw')}
            </PrimaryButton>
          </div>
        )
      }
    >
      {done ? (
        <p className="rounded-w border border-[#cfe6dc] bg-[#eaf5f0] px-3 py-3 text-[12.5px] leading-[18px] text-[#136f53]">
          {t('wallet.withdrawSubmitted')}
        </p>
      ) : balances.length === 0 ? (
        <p className="text-[12.5px] leading-[18px] text-ink-3">{t('wallet.nothingToWithdraw')}</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel>{t('wallet.colAsset')}</FieldLabel>
              <Select
                value={asset}
                onChange={(v) => {
                  setAsset(v);
                  setAmount('');
                }}
                options={balances.map((b) => ({ value: b.asset, label: b.asset }))}
              />
            </div>
            <div>
              <FieldLabel>{t('deposit.network')}</FieldLabel>
              <Select value={network} onChange={setNetwork} options={NETWORKS.map((n) => ({ value: n, label: n }))} />
            </div>
          </div>

          <div>
            <FieldLabel>{t('wallet.recipientAddress')}</FieldLabel>
            <TextInput value={address} onChange={setAddress} placeholder={t('wallet.addressPlaceholder')} invalid={!!addressError} mono />
            {addressError && <FieldError>{addressError}</FieldError>}
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
              invalid={!!amountError}
              mono
              suffix={
                <button
                  type="button"
                  onClick={() => setAmount(selected ? selected.available : '')}
                  className="rounded-wsm border border-hair px-1.5 py-0.5 text-[11px] font-semibold text-ink-3 transition-colors duration-150 ease-exp hover:border-hair-strong hover:text-ink"
                >
                  {t('wallet.max')}
                </button>
              }
            />
            {amountError && <FieldError>{amountError}</FieldError>}
          </div>

          <div className="rounded-w border border-hair bg-surface-1 px-3.5 py-2">
            <SummaryRow label={t('wallet.available')} value={`${formatAmount(available, lang, decimalsFor(asset))} ${asset}`} />
            <SummaryRow
              label={t('wallet.willBeDeducted')}
              value={amountEntered && !amountError ? `${formatAmount(parsed, lang, decimalsFor(asset))} ${asset}` : '—'}
              strong
            />
          </div>

          {serverError && <FieldError>{serverError}</FieldError>}

          <p className="flex items-start gap-2 rounded-w border border-hair bg-panel-2 px-3 py-2.5 text-[11.5px] leading-[17px] text-ink-3">
            <InfoIcon className="mt-px h-3.5 w-3.5 shrink-0 text-ink-4" strokeWidth={1.8} />
            <span>{t('wallet.withdrawManualNotice')}</span>
          </p>
        </div>
      )}
    </Modal>
  );
}
