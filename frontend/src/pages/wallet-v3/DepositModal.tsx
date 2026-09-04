import { useEffect, useState } from 'react';
import { CheckIcon, CopyIcon, TriangleAlertIcon } from 'lucide-react';
import { api } from '../../lib/api';
import { Key, useLanguage } from '../../lib/i18n';
import { FieldLabel, Modal, SecondaryButton, Select } from './ui';
import { formatAmount, formatUsd } from './format';

const MIN_DEPOSIT_USD = 1000;
const STABLECOINS = new Set(['USDT', 'USDC', 'DAI', 'TUSD']);

/**
 * The approved V3 deposit design, on the real deposit backend.
 *
 * Chains, addresses and supported assets all come from the exchange's own
 * configured treasury (GET /deposits/chains, /deposits/address/:chain) —
 * the reference archive's sample addresses are not used anywhere, and no
 * address is ever constructed client-side.
 */
export function DepositModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang } = useLanguage();
  const CHAIN_LABEL: Record<string, Key> = {
    bitcoin: 'deposit.chain.bitcoin',
    tron: 'deposit.chain.tron',
    ethereum: 'deposit.chain.ethereum',
    bsc: 'deposit.chain.bsc',
    solana: 'deposit.chain.solana',
    ton: 'deposit.chain.ton',
  };

  const [chains, setChains] = useState<{ chain: string; nativeAsset: string; tokens: string[] }[]>([]);
  const [chain, setChain] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [assets, setAssets] = useState<string[]>([]);
  const [asset, setAsset] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [minEquivalent, setMinEquivalent] = useState<number | null>(null);

  // Only chains this deployment actually has a treasury address for — which
  // is what stops the modal offering a network it cannot verify a deposit on.
  useEffect(() => {
    if (!open) return;
    api
      .getDepositChains()
      .then((res) => {
        setChains(res);
        if (res.length > 0) setChain((cur) => cur ?? res[0].chain);
      })
      .catch(() => setError(t('deposit.loadChainsError')));
  }, [open, t]);

  useEffect(() => {
    if (!chain) return;
    setAddress(null);
    api
      .getDepositAddress(chain)
      .then((res) => {
        setAddress(res.address);
        setAssets(res.supportedAssets);
        setAsset(res.supportedAssets[0] ?? '');
      })
      .catch(() => setError(t('deposit.loadAddressError')));
  }, [chain, t]);

  // Live minimum conversion off the same market feed the terminal prices
  // from. On failure it stays null and the plain dollar hint is shown
  // instead — never a fabricated conversion.
  useEffect(() => {
    if (!asset) return;
    setMinEquivalent(null);
    if (STABLECOINS.has(asset)) {
      setMinEquivalent(MIN_DEPOSIT_USD);
      return;
    }
    let cancelled = false;
    api
      .getExternalTicker(`${asset}/USDT`)
      .then((res) => {
        if (cancelled) return;
        const price = parseFloat(res.ticker.lastPrice);
        if (Number.isFinite(price) && price > 0) setMinEquivalent(MIN_DEPOSIT_USD / price);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [asset]);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(id);
  }, [copied]);

  const chainLabel = (c: string) => (CHAIN_LABEL[c] ? t(CHAIN_LABEL[c]) : c);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('deposit.title')}
      subtitle={t('wallet.spotAccount')}
      footer={
        <SecondaryButton onClick={onClose} full>
          {t('deposit.close')}
        </SecondaryButton>
      }
    >
      <div className="space-y-4">
        {error && (
          <p className="rounded-w border border-[#f0d0d3] bg-[#fbecec] px-3 py-2.5 text-[11.5px] leading-[17px] text-[#a93a43]">
            {error}
          </p>
        )}

        <div>
          <FieldLabel>{t('deposit.network')}</FieldLabel>
          <Select
            id="deposit-network"
            value={chain ?? ''}
            onChange={setChain}
            options={chains.map((c) => ({ value: c.chain, label: chainLabel(c.chain) }))}
          />
        </div>

        <div>
          <FieldLabel>{t('wallet.colAsset')}</FieldLabel>
          <Select
            id="deposit-asset"
            value={asset}
            onChange={setAsset}
            options={assets.map((a) => ({ value: a, label: a }))}
          />
        </div>

        <div className="rounded-w border border-hair">
          <div className="border-b border-hair-soft bg-surface-1 px-3.5 py-2.5">
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">{t('deposit.address')}</p>
          </div>
          <div className="p-3.5">
            <p className="num break-all text-[12.5px] leading-[18px] text-ink">{address ?? t('wallet.loading')}</p>
            <button
              type="button"
              disabled={!address}
              onClick={() => {
                if (!address) return;
                navigator.clipboard?.writeText(address).catch(() => undefined);
                setCopied(true);
              }}
              className="mt-2.5 flex h-8 items-center gap-1.5 rounded-w border border-hair bg-panel px-2.5 text-[12px] font-medium text-ink-2 transition-colors duration-150 ease-exp hover:border-hair-strong hover:bg-panel-2 hover:text-ink disabled:cursor-not-allowed disabled:text-ink-4"
            >
              {copied ? <CheckIcon className="h-3.5 w-3.5 text-pos" strokeWidth={2} /> : <CopyIcon className="h-3.5 w-3.5" strokeWidth={1.7} />}
              {copied ? t('deposit.copied') : t('deposit.copy')}
            </button>
          </div>
          <dl className="border-t border-hair-soft px-3.5 py-2.5">
            <dt className="text-[11px] text-ink-4">{t('deposit.minAmount')}</dt>
            <dd className="num mt-1 text-[12.5px] font-medium text-ink-2">
              {asset && minEquivalent !== null && !STABLECOINS.has(asset)
                ? `${formatUsd(MIN_DEPOSIT_USD, lang, 0)} ≈ ${formatAmount(minEquivalent, lang, 8)} ${asset}`
                : formatUsd(MIN_DEPOSIT_USD, lang, 0)}
            </dd>
          </dl>
        </div>

        <p className="flex items-start gap-2 rounded-w border border-[#efe1c0] bg-gold-wash px-3 py-2.5 text-[11.5px] leading-[17px] text-[#7a5b15]">
          <TriangleAlertIcon className="mt-px h-3.5 w-3.5 shrink-0 text-gold-deep" strokeWidth={1.8} />
          <span>{t('wallet.depositWarning', { asset: asset || '—', chain: chain ? chainLabel(chain) : '—' })}</span>
        </p>
      </div>
    </Modal>
  );
}
