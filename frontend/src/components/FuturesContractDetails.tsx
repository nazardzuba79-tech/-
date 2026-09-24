import { useEffect, useState, type ReactNode } from 'react';
import { useLanguage } from '../lib/i18n';
import { useFuturesReference } from '../lib/useFuturesReference';
import { useFuturesConfig } from '../lib/futuresConfigStore';
import { useFuturesExecution } from '../lib/futuresExecution';
import { contractFacts, fundingCountdown } from '../lib/contractDetails';

const DASH = '—';

/**
 * CONTRACT DETAILS, under the order ticket on the archive design: the
 * selected contract's facts in one quiet list where the trader reads the
 * ticket, so the header does not have to be scanned while sizing an
 * order. Index and mark price, open interest, 24h turnover, funding with
 * its countdown and the settlement asset come from the same reference
 * quote the header paints; the order limits appear only when the engine
 * publishes them (the real engine does not), so nothing here is invented.
 * Read-only: no request, no handler, no trading logic.
 */
export function FuturesContractDetails({ symbol }: { symbol: string }) {
  const { t } = useLanguage();
  const reference = useFuturesReference();
  const { config } = useFuturesConfig();
  const { contract } = useFuturesExecution();
  const quote = reference.get(symbol) ?? null;
  const facts = contractFacts(quote, config, contract);
  const intervalHours = config?.fundingIntervalHours ?? null;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalHours === null || intervalHours <= 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [intervalHours]);
  const countdown = fundingCountdown(intervalHours, now);

  const row = (key: string, label: string, value: ReactNode) => (
    <div className="fcd-row" key={key} data-contract-fact={key}>
      <span className="fcd-label">{label}</span>
      <span className="fcd-value mono">{value}</span>
    </div>
  );
  const withUnit = (figure: { value: string; unit: string } | null) =>
    figure ? <>{figure.value}<span className="fcd-unit">{figure.unit}</span></> : DASH;

  return (
    <details className="futures-contract-details" open data-contract-details={symbol}>
      <summary className="fcd-title">{t('futures.contractDetails')}</summary>
      <div className="fcd-rows">
        {row('expiry', t('futures.contractExpiry'), facts.perpetual === null ? DASH : facts.perpetual ? t('futures.contractPerpetual') : DASH)}
        {row('index', t('futures.indexPrice'), facts.indexPrice ?? DASH)}
        {row('mark', t('futures.markPrice'), facts.markPrice ?? DASH)}
        {row('open-interest', t('futures.openInterest'), withUnit(facts.openInterest))}
        {row('turnover', t('futures.headerTurnover24h'), withUnit(facts.turnover24h))}
        {row('funding', t('futures.fundingRate'),
          <>
            <span className={facts.fundingRate ? (facts.fundingRate.negative ? 'down' : 'up') : undefined}>{facts.fundingRate?.value ?? DASH}</span>
            <span className="fcd-unit">/</span>
            <span>{countdown ?? DASH}</span>
          </>)}
        {row('settle', t('futures.contractSettle'), facts.settleAsset ?? DASH)}
        {row('max-leverage', t('futures.contractMaxLeverage'), facts.maxLeverage ?? DASH)}
        {facts.minOrderQty && row('min-qty', t('futures.limitMinQty'), withUnit(facts.minOrderQty))}
        {facts.qtyStep && row('qty-step', t('futures.contractQtyStep'), withUnit(facts.qtyStep))}
        {facts.maxOrderQty && row('max-qty', t('futures.contractMaxQty'), withUnit(facts.maxOrderQty))}
      </div>
    </details>
  );
}
