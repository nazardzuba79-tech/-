import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2Icon, ClockIcon, InfoIcon } from 'lucide-react';
import { api } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { checkWithdrawAddress, withdrawNetworks } from '../../lib/withdrawNetworks';
import { FieldError, FieldLabel, Modal, PrimaryButton, SecondaryButton, Select, SummaryRow, TextInput } from './ui';
import { decimalsFor, formatAmount } from './format';
import { customerErrorText } from '../../lib/customerError';

type Options = Awaited<ReturnType<typeof api.getWithdrawalOptions>>;
type Submitted = { asset: string; amount: string; network: string; toAddress: string };

/** FieldLabel's look, as a real <label> for the text fields below. */
function InputLabel({ htmlFor, children, hint }: { htmlFor: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-3">
      <label htmlFor={htmlFor} className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">{children}</label>
      {hint && <span className="num text-[11px] text-ink-3">{hint}</span>}
    </div>
  );
}

/** A typed amount as a plain decimal, or null: `,` is accepted as the separator. */
function decimalInput(raw: string): string | null {
  const value = raw.trim().replace(',', '.');
  return /^\d{1,18}(\.\d{1,18})?$/.test(value) ? value : null;
}

/**
 * The withdrawal request: coin, network, address, amount.
 *
 * What can be withdrawn comes from the server (`/withdrawals/options`),
 * which checks the same figure again on submit: the Cross trading account's
 * own available balance for the owner's and the configured test accounts,
 * the spot ledger for everyone else. A request goes to the admin's
 * «Выводы» queue and is paid by hand; the panel says it can take up to 60
 * minutes, before and after sending.
 */
export function WithdrawModal({ open, onClose, onSubmitted, onTransfer }: {
  open: boolean;
  onClose: () => void;
  onSubmitted: () => void;
  /** Opens the Spot ⇄ Futures transfer, for funds that sit on futures. */
  onTransfer?: () => void;
}) {
  const { t, lang } = useLanguage();
  const addressId = useId();
  const amountId = useId();
  const [options, setOptions] = useState<Options | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [asset, setAsset] = useState('');
  const [networkCode, setNetworkCode] = useState('');
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setSubmitted(null);
    setServerError(null);
    setLoadFailed(false);
    setOptions(null);
    api.getWithdrawalOptions()
      .then((next) => {
        if (!alive) return;
        setOptions(next);
        setAsset((current) => (next.assets.some((a) => a.asset === current) ? current : next.assets[0]?.asset ?? ''));
      })
      .catch(() => { if (alive) setLoadFailed(true); });
    return () => { alive = false; };
  }, [open, reload]);

  const networks = useMemo(() => withdrawNetworks(asset), [asset]);
  // A new coin starts on its own first network (TRC20 for USDT), not on
  // whatever the previous coin had selected.
  useEffect(() => { setNetworkCode(networks[0]?.code ?? ''); }, [networks]);
  const network = networks.find((n) => n.code === networkCode) ?? networks[0];

  const row = options?.assets.find((a) => a.asset === asset) ?? null;
  const available = row ? Number(row.available) : 0;
  const decimals = decimalsFor(asset);
  const shown = (value: number) => formatAmount(value, lang, decimals);

  const amountEntered = amount.trim() !== '';
  const plain = decimalInput(amount);
  const amountError = !amountEntered ? null
    : plain === null || Number(plain) <= 0 ? t('withdraw.amountPositive')
      : Number(plain) > available ? t('withdraw.amountTooMuch', { amount: shown(available), asset })
        : null;

  const verdict = network ? checkWithdrawAddress(network, address) : 'empty';
  const addressError = verdict === 'spaces' ? t('withdraw.addressSpaces')
    : verdict === 'wrongNetwork' ? t('withdraw.addressWrongNetwork', { network: network.label })
      : verdict === 'unrecognised' ? t('withdraw.addressUnrecognised', { network: network.label })
        : null;

  const canSubmit = !!row && !!network && verdict === 'ok' && plain !== null && !amountError && !submitting;

  async function submit() {
    if (!canSubmit || !plain || !network) return;
    setSubmitting(true);
    setServerError(null);
    const request = { asset, network: network.code, toAddress: address.trim(), amount: plain };
    try {
      await api.requestWithdrawal(request);
      setSubmitted({ ...request, network: network.label });
      setAddress('');
      setAmount('');
      onSubmitted();
    } catch (err) {
      setServerError(customerErrorText(err, t, t('withdraw.error')));
    } finally {
      setSubmitting(false);
    }
  }

  const futuresOnly = options?.source === 'SPOT' && options.assets.length === 0 && options.futures.length > 0;
  const subtitle = options?.source === 'TRADING' ? t('withdraw.fromTrading') : t('withdraw.fromSpot');

  const footer = submitted ? (
    <PrimaryButton onClick={onClose} full>{t('withdraw.done')}</PrimaryButton>
  ) : futuresOnly && onTransfer ? (
    <div className="flex items-center gap-2">
      <SecondaryButton onClick={onClose} full>{t('withdraw.cancel')}</SecondaryButton>
      <PrimaryButton onClick={onTransfer} full>{t('withdraw.transfer')}</PrimaryButton>
    </div>
  ) : row ? (
    <div className="flex items-center gap-2">
      <SecondaryButton onClick={onClose} full>{t('withdraw.cancel')}</SecondaryButton>
      <PrimaryButton disabled={!canSubmit} onClick={submit} full>
        {submitting ? t('auth.wait') : t('withdraw.submit')}
      </PrimaryButton>
    </div>
  ) : (
    <SecondaryButton onClick={onClose} full>{t('deposit.close')}</SecondaryButton>
  );

  return (
    <Modal open={open} onClose={onClose} title={t('withdraw.title')} subtitle={options ? subtitle : undefined} footer={footer}>
      {submitted ? (
        <div className="space-y-4" role="status">
          <div className="flex flex-col items-center gap-2 pt-1 text-center">
            <CheckCircle2Icon className="h-10 w-10 text-pos" strokeWidth={1.6} aria-hidden="true" />
            <p className="text-[15px] font-semibold text-ink">{t('withdraw.doneTitle')}</p>
            <p className="max-w-[340px] text-[12.5px] leading-[18px] text-ink-3">{t('withdraw.doneEta')}</p>
          </div>
          <div className="rounded-w border border-hair bg-surface-1 px-3.5 py-2">
            <SummaryRow label={t('withdraw.youWithdraw')} value={`${shown(Number(submitted.amount))} ${submitted.asset}`} strong />
            <SummaryRow label={t('withdraw.network')} value={submitted.network} />
            <SummaryRow label={t('withdraw.address')} value={<span className="num break-all text-right">{submitted.toAddress}</span>} />
          </div>
        </div>
      ) : loadFailed ? (
        <div className="space-y-3">
          <FieldError>{t('withdraw.loadError')}</FieldError>
          <SecondaryButton onClick={() => setReload((n) => n + 1)}>{t('withdraw.retry')}</SecondaryButton>
        </div>
      ) : !options ? (
        <p className="text-[12.5px] leading-[18px] text-ink-3">{t('withdraw.loading')}</p>
      ) : !row ? (
        <p className="text-[12.5px] leading-[18px] text-ink-3">{futuresOnly ? t('withdraw.onFutures') : t('withdraw.nothing')}</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel>{t('withdraw.asset')}</FieldLabel>
              <Select
                value={asset}
                onChange={(v) => { setAsset(v); setAmount(''); }}
                options={options.assets.map((a) => ({ value: a.asset, label: a.asset }))}
              />
            </div>
            <div>
              <FieldLabel>{t('withdraw.network')}</FieldLabel>
              <Select value={network?.code ?? ''} onChange={setNetworkCode} options={networks.map((n) => ({ value: n.code, label: n.label }))} />
            </div>
          </div>

          <div>
            <InputLabel htmlFor={addressId}>{t('withdraw.address')}</InputLabel>
            <TextInput
              id={addressId}
              value={address}
              onChange={setAddress}
              placeholder={t('withdraw.addressPlaceholder')}
              invalid={!!addressError}
              mono
            />
            {addressError && <FieldError>{addressError}</FieldError>}
          </div>

          <div>
            <InputLabel htmlFor={amountId} hint={`${t('withdraw.available')}: ${shown(available)} ${asset}`}>{t('withdraw.amount')}</InputLabel>
            <TextInput
              id={amountId}
              value={amount}
              onChange={setAmount}
              inputMode="decimal"
              placeholder="0.00"
              invalid={!!amountError}
              mono
              suffix={
                <>
                  <span className="text-[12px] font-medium text-ink-3">{asset}</span>
                  <button
                    type="button"
                    onClick={() => setAmount(row.available)}
                    className="rounded-wsm border border-hair px-1.5 py-0.5 text-[11px] font-semibold text-ink-3 transition-colors duration-150 ease-exp hover:border-hair-strong hover:text-ink"
                  >
                    {t('withdraw.max')}
                  </button>
                </>
              }
            />
            {amountError && <FieldError>{amountError}</FieldError>}
          </div>

          <div className="rounded-w border border-hair bg-surface-1 px-3.5 py-2">
            <SummaryRow label={t('withdraw.available')} value={`${shown(available)} ${asset}`} />
            <SummaryRow
              label={t('withdraw.youWithdraw')}
              value={plain !== null && !amountError ? `${shown(Number(plain))} ${asset}` : '—'}
              strong
            />
          </div>

          {serverError && <FieldError>{serverError}</FieldError>}

          <div className="space-y-1.5 rounded-w border border-hair bg-panel-2 px-3 py-2.5 text-[11.5px] leading-[17px] text-ink-3">
            <p className="flex items-start gap-2 font-medium text-ink-2">
              <ClockIcon className="mt-px h-3.5 w-3.5 shrink-0 text-gold-deep" strokeWidth={1.8} aria-hidden="true" />
              <span>{t('withdraw.eta')}</span>
            </p>
            <p className="flex items-start gap-2">
              <InfoIcon className="mt-px h-3.5 w-3.5 shrink-0 text-ink-4" strokeWidth={1.8} aria-hidden="true" />
              <span>{options.source === 'SPOT' ? `${t('withdraw.spotHold')} ` : ''}{t('withdraw.checkAddress')}</span>
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}
