import { sampledDisplayText } from '../lib/sampledDisplayCopy';
import { useSampledMotion } from './SampledDataNote';
import { useEffect, useState } from 'react';
import { useFuturesExecution } from '../lib/futuresExecution';
import { useLanguage } from '../lib/i18n';
import type { FuturesDepthStatus } from '../lib/futuresDepth';
import './FuturesTerminalStatus.css';

/**
 * THE STATUS LINE: is the feed alive, and what does trading cost.
 *
 * Two facts, and neither of them is invented.
 *
 * CONNECTION comes from the depth transport's own state machine — the same
 * `FuturesDepthStatus` the order book already renders, so the strip cannot
 * say "Live" while the book beside it is showing a last-good snapshot. Age
 * is computed from `asOf`, the LOCAL arrival time of the newest accepted
 * frame, which is a real measurement of how old the numbers on screen are.
 *
 * THERE IS NO LATENCY FIGURE. Latency is a round trip, and nothing in this
 * client measures one: the depth transport is a subscription, so the time
 * between frames is the venue's publishing cadence plus the network, and
 * printing that as "23 ms" would be a number with the wrong name on it. A
 * terminal that prints a plausible latency is worse than one that prints
 * none, because the plausible one gets believed.
 *
 * FEES are `contract.makerFeeRate` / `takerFeeRate`, and the pair renders
 * only when the engine actually publishes them. The real futures engine
 * charges nothing and publishes nothing, so on that path the fee half of
 * this strip is simply absent — not "0.00%", which is a rate nobody set.
 */

/** Which depth states are honestly "live", and which are not. */
const LIVE: ReadonlySet<FuturesDepthStatus> = new Set<FuturesDepthStatus>(['live']);

function ageSeconds(asOf: number | null, now: number): number | null {
  if (asOf === null) return null;
  const seconds = Math.floor((now - asOf) / 1000);
  return seconds >= 0 ? seconds : null;
}

/** A rate as a percentage, at the precision the rate actually carries. */
function ratePercent(rate: string | undefined): string | null {
  if (!rate) return null;
  const value = Number(rate);
  if (!Number.isFinite(value) || value <= 0) return null;
  const percent = value * 100;
  // 0.00055 -> "0.055%", 0.0002 -> "0.02%". Trailing zeros are dropped so a
  // three-decimal rate does not make every other one look three-decimal.
  return `${percent.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

export function FuturesTerminalStatus({ status, asOf }: {
  status: FuturesDepthStatus;
  /** Local arrival time of the newest accepted frame, or null while none has. */
  asOf: number | null;
}) {
  const { t, lang } = useLanguage();
  useSampledMotion();
  const execution = useFuturesExecution();

  /**
   * A once-a-second tick, and ONLY while there is an age to show.
   *
   * The age has to move on its own — a figure that says "2s ago" and then
   * stays there while the feed dies is the opposite of a status line. One
   * interval for one number is the whole cost, and it stops the moment
   * there is nothing to count.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (asOf === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [asOf]);

  const live = LIVE.has(status);
  const age = ageSeconds(asOf, now);
  const maker = ratePercent(execution.contract?.makerFeeRate);
  const taker = ratePercent(execution.contract?.takerFeeRate);

  return (
    <div className="fts-bar" data-terminal-status={live ? 'live' : status}>
      <span className="fts-conn">
        <span className={`fts-dot${live ? ' fts-dotLive' : ''}`} aria-hidden="true" />
        <span className="fts-connText">{status === 'sampled' ? sampledDisplayText(lang, asOf).label : t(live ? 'futures.statusLive' : status === 'stale' ? 'catalogue.stale' : status === 'unavailable' ? 'trade.bookUnavailable' : 'trade.marketDelayed')}</span>
        {/* The age is a measurement, so it renders whatever the state is —
            a stale book is exactly when its age matters most. */}
        {age !== null && <span className="fts-age mono" data-feed-age={age}>{age}s</span>}
      </span>
      {(maker || taker) && (
        <span className="fts-fees">
          {maker && <span className="fts-fee"><i>{t('futures.feeMaker')}</i> <b className="mono">{maker}</b></span>}
          {taker && <span className="fts-fee"><i>{t('futures.feeTaker')}</i> <b className="mono">{taker}</b></span>}
        </span>
      )}
    </div>
  );
}
