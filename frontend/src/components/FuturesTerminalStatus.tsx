import { useSampledMotion } from './SampledDataNote';
import { useFuturesExecution } from '../lib/futuresExecution';
import { useLanguage } from '../lib/i18n';
import type { FuturesDepthStatus } from '../lib/futuresDepth';
import './FuturesTerminalStatus.css';

function ratePercent(rate: string | undefined): string | null {
  if (!rate) return null;
  const value = Number(rate);
  if (!Number.isFinite(value) || value <= 0) return null;
  const percent = value * 100;
  return `${percent.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

/**
 * Customer-facing Futures strip. Internal feed/cache/snapshot state is not
 * rendered here; only actual trading fees remain visible.
 */
export function FuturesTerminalStatus({ status: _status, asOf: _asOf }: {
  status: FuturesDepthStatus;
  asOf: number | null;
}) {
  const { t } = useLanguage();
  useSampledMotion();
  const execution = useFuturesExecution();
  const maker = ratePercent(execution.contract?.makerFeeRate);
  const taker = ratePercent(execution.contract?.takerFeeRate);

  if (!maker && !taker) return null;

  return (
    <div className="fts-bar">
      <span className="fts-fees">
        {maker && <span className="fts-fee"><i>{t('futures.feeMaker')}</i> <b className="mono">{maker}</b></span>}
        {taker && <span className="fts-fee"><i>{t('futures.feeTaker')}</i> <b className="mono">{taker}</b></span>}
      </span>
    </div>
  );
}
