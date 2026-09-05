import type {
  CashflowReviewState, CopiedTrade, FollowerAllocationEvent,
  PerformanceFeeEvent, ReviewFollower,
} from './reviewEconomicsTypes';
import type { AumSnapshot } from './types';

const DAY_MS = 86_400_000;
const MONEY_SCALE = 10_000;

/** Explicit review cohorts, not random deposits subsequently rescaled to a target.
 * Eight grandfathered small allocations, 20 standard, 20 medium, 12 large and
 * four larger allocations independently sum to 7,200,000 USDT. The last join is
 * an ordinary 132,500 allocation, not a reconciliation residual. No cohort is
 * created by advancing the simulation after this initial 380-day schedule.
 */
const COHORTS: readonly (readonly [day: number, allocation: number])[] = [
  [0, 5_000], [0, 7_000], [9, 8_500], [16, 28_750],
  [28, 10_000], [39, 76_800], [46, 12_000], [57, 71_850],
  [69, 151_750], [73, 15_000], [84, 32_750], [91, 143_200],
  [97, 17_500], [106, 67_850], [118, 82_500], [123, 238_250],
  [139, 35_400], [151, 19_000], [156, 137_500], [166, 65_200],
  [172, 163_500], [187, 89_125], [193, 38_900], [203, 326_500],
  [216, 61_700], [228, 130_875], [235, 226_500], [241, 41_650],
  [246, 92_500], [253, 58_950], [259, 179_250], [262, 127_500],
  [268, 44_750], [276, 96_800], [279, 210_750], [283, 373_500],
  [289, 55_850], [293, 123_200], [301, 187_000], [305, 101_750],
  [308, 47_900], [313, 118_250], [317, 198_000], [320, 52_700],
  [326, 104_600], [330, 194_600], [334, 49_125], [338, 115_400],
  [341, 418_750], [345, 51_475], [350, 107_250], [354, 190_400],
  [357, 26_750], [360, 112_750], [363, 174_250], [365, 73_850],
  [368, 79_500], [370, 461_250], [372, 37_250], [374, 140_500],
  [376, 205_750], [378, 87_500], [379, 63_350], [380, 132_500],
];

function timestamp(date: string): number {
  const value = Date.parse(date.length === 10 ? `${date}T00:00:00.000Z` : date);
  if (!Number.isFinite(value)) throw new Error(`Invalid review ledger date: ${date}`);
  return value;
}

const utcDay = (date: string): string => new Date(timestamp(date)).toISOString().slice(0, 10);
const money = (units: number): number => units / MONEY_SCALE;
function units(value: number): number {
  const result = Math.round(value * MONEY_SCALE);
  if (!Number.isFinite(value) || !Number.isSafeInteger(result)) {
    throw new Error('Review follower money is outside safe fixed-point precision');
  }
  return result;
}

function sumUnits(values: number[]): number {
  const sum = values.reduce((total, value) => total + units(value), 0);
  if (!Number.isSafeInteger(sum)) throw new Error('Review follower ledger sum is unsafe');
  return sum;
}

/** Populate only a fresh, explicitly selected v7 review environment. */
export function populateReviewFollowers(state: CashflowReviewState): void {
  if (state.version !== 7) throw new Error('Follower population requires an explicitly selected v7 review state');
  if (state.followers.length || state.cashflow.followerAllocationEvents.length) {
    if (!state.followers.length || !state.cashflow.followerAllocationEvents.length) {
      throw new Error('Cannot replace a partially populated review follower ledger');
    }
    refreshReviewFollowerLedgers(state);
    return;
  }
  if (state.cashflow.copiedTrades.length || state.cashflow.performanceFeeEvents.length) {
    throw new Error('Cannot replace review history with a new follower cohort');
  }
  if (COHORTS.length !== 64 || sumUnits(COHORTS.map(([, allocation]) => allocation)) !== units(7_200_000)) {
    throw new Error('The explicit review cohort allocation schedule is inconsistent');
  }
  const inception = timestamp(utcDay(state.initialEquityDate));
  state.followers = COHORTS.map(([offset, allocation], index): ReviewFollower => {
    const id = `review-follower-${String(index + 1).padStart(3, '0')}`;
    const copyStartDate = new Date(inception + offset * DAY_MS).toISOString();
    state.cashflow.followerAllocationEvents.push({
      id: `${id}:allocation:join`, followerId: id, date: copyStartDate,
      type: 'JOIN', oldAllocation: 0, delta: allocation, newAllocation: allocation,
    });
    return {
      id, displayName: `R•••${String(index + 1).padStart(2, '0')}`, copyStartDate,
      startingAllocation: allocation, allocatedCapital: allocation,
      copyRatio: (89 + (index * 7) % 12) / 100,
      // Explicit liquid-market review execution assumptions, not a profit
      // calibration: 0.15–0.75 bps adverse slippage and 40–350 ms latency.
      slippageBps: (15 + (index * 11) % 61) / 100,
      latencyMs: 40 + (index * 137) % 311,
      currentEquity: allocation, realizedPnl: 0, unrealizedPnl: 0, roi: 0,
      copiedTrades: 0, grossPnl: 0, performanceFees: 0, netPnl: 0,
      copiedVolume: 0, highWaterMark: 0, active: true,
    };
  });
  refreshReviewFollowerLedgers(state);
}

type TimedAllocation = { event: FollowerAllocationEvent; time: number };

function allocationLedgers(state: CashflowReviewState): Map<string, TimedAllocation[]> {
  const ledgers = new Map(state.followers.map(follower => [follower.id, [] as TimedAllocation[]]));
  if (ledgers.size !== state.followers.length) throw new Error('Duplicate review follower ID');
  const eventIds = new Set<string>();
  for (const event of state.cashflow.followerAllocationEvents) {
    const ledger = ledgers.get(event.followerId);
    if (!ledger || eventIds.has(event.id)) throw new Error('Unknown follower or duplicate allocation event');
    eventIds.add(event.id);
    ledger.push({ event, time: timestamp(event.date) });
  }
  for (const follower of state.followers) {
    const ledger = ledgers.get(follower.id)!;
    ledger.sort((a, b) => a.time - b.time);
    if (!ledger.length || ledger[0].event.type !== 'JOIN') throw new Error('Follower must start with an explicit JOIN');
    let allocation = 0;
    for (const [index, { event, time }] of ledger.entries()) {
      // This is a complete-UTC-day review simulation. Supporting intraday
      // contributions would require extra performance valuation checkpoints;
      // reject them explicitly instead of using the day's closing allocation
      // as though that capital had been available for the whole session.
      if (time % DAY_MS !== 0) throw new Error('Review allocation events require UTC day start');
      if (index > 0 && ledger[index - 1].time === time) {
        throw new Error('Only one allocation event per follower per UTC day is supported');
      }
      const previous = units(event.oldAllocation);
      const delta = units(event.delta);
      const next = units(event.newAllocation);
      if (previous !== allocation || previous + delta !== next || next < 0) {
        throw new Error(`Allocation event does not reconcile: ${event.id}`);
      }
      if (event.type === 'JOIN') {
        if (index !== 0 || previous !== 0 || next <= 0 || time !== timestamp(follower.copyStartDate)) {
          throw new Error('JOIN must match the real beginning of the review copy ledger');
        }
        const policy = state.cashflow.policy;
        if (time >= timestamp(policy.copyMinimumPolicyEffectiveDate) && next < units(policy.currentCopyMinimum)) {
          throw new Error('New review follower is below the effective copy minimum');
        }
      } else if (event.type === 'INCREASE' ? delta <= 0
        : event.type === 'DECREASE' ? delta >= 0
          : event.type === 'STOP' ? next !== 0 || delta >= 0 : true) {
        throw new Error(`Invalid allocation event direction: ${event.id}`);
      }
      allocation = next;
    }
  }
  return ledgers;
}

function allocationAt(ledger: TimedAllocation[], time: number): number {
  let allocation = 0;
  for (const item of ledger) {
    if (item.time > time) break;
    allocation = item.event.newAllocation;
  }
  return allocation;
}

/** Reuse existing immutable entries when replaying or appending complete days.
 * Reject an implicit rewrite of history; a reset must create a fresh state.
 */
function preserveRecords<T extends { id: string }>(previous: T[], next: T[]): T[] {
  const byId = new Map(previous.map(record => [record.id, record]));
  if (byId.size !== previous.length) throw new Error('Duplicate existing review ledger ID');
  const nextIds = new Set(next.map(record => record.id));
  if (nextIds.size !== next.length || previous.some(record => !nextIds.has(record.id))) {
    throw new Error('Review replay cannot remove previously recorded history');
  }
  return next.map(record => {
    const existing = byId.get(record.id);
    if (!existing) return record;
    if (Object.keys(record).some(key => existing[key as keyof T] !== record[key as keyof T])) {
      throw new Error(`Review replay would rewrite historical record ${record.id}`);
    }
    return existing;
  });
}

/** AUM is contributed allocation only. Neither profits nor performance fees are
 * deposits; historical follower counts are reconstructed from dated events.
 */
export function buildReviewAumHistory(state: CashflowReviewState): AumSnapshot[] {
  const ledgers = allocationLedgers(state);
  const history: AumSnapshot[] = [];
  const end = timestamp(utcDay(state.simulatedAt));
  for (let day = timestamp(utcDay(state.initialEquityDate)); day <= end; day += DAY_MS) {
    const allocations = [...ledgers.values()].map(ledger => allocationAt(ledger, day + DAY_MS - 1));
    history.push({
      date: new Date(day).toISOString().slice(0, 10),
      aum: money(sumUnits(allocations)), followerCount: allocations.filter(allocation => allocation > 0).length,
    });
  }
  return history;
}

/** Trade-level review copy accounting, never an exchange execution/account API.
 * Copies are sized at ENTRY by min(committed allocation, current account equity)
 * and master capital at risk, not by the TWR index or a displayed ROI. Profits
 * do not automatically increase allocation; losses reduce available margin.
 * Execution drag applies to both legs:
 * adverse slippage plus one basis point per second of modeled latency. Trading
 * fees/funding are proportional copies of the actual master ledger costs.
 * Daily fees crystallize only above the previous lifetime gross-PnL HWM, after
 * costs and before performance fees. Contributions cannot reset that mark.
 */
export function refreshReviewFollowerLedgers(state: CashflowReviewState): void {
  if (state.version !== 7 || state.cashflow.policy.performanceFeeRate !== 0.10) {
    throw new Error('Follower ledger is restricted to the v7 Nazara 10% review policy');
  }
  const ledgers = allocationLedgers(state);
  const masterDays = new Map(state.cashflow.masterDays.map(day => [day.date, day]));
  if (masterDays.size !== state.cashflow.masterDays.length) throw new Error('Duplicate master capital day');
  const asOf = timestamp(utcDay(state.simulatedAt)) + DAY_MS - 1;
  const masterTrades = state.trades.filter(trade => timestamp(trade.closedAt) <= asOf)
    .slice().sort((a, b) => timestamp(a.closedAt) - timestamp(b.closedAt) || a.id.localeCompare(b.id));
  if (new Set(masterTrades.map(trade => trade.id)).size !== masterTrades.length) throw new Error('Duplicate master trade');
  for (let index = 1; index < masterTrades.length; index++) {
    if (timestamp(masterTrades[index].openedAt) < timestamp(masterTrades[index - 1].closedAt)) {
      throw new Error('Review copy margin accounting requires sequential master positions');
    }
  }
  const copiedTrades: CopiedTrade[] = [];
  const feeEvents: PerformanceFeeEvent[] = [];
  const followerUpdates: ReviewFollower[] = [];

  for (const follower of state.followers) {
    if (!(follower.copyRatio > 0 && follower.copyRatio <= 1)
      || !Number.isFinite(follower.slippageBps) || follower.slippageBps < 0
      || !Number.isFinite(follower.latencyMs) || follower.latencyMs < 0) {
      throw new Error('Invalid review follower execution settings');
    }
    const allocations = ledgers.get(follower.id)!;
    const join = timestamp(follower.copyStartDate);
    const followerTrades: CopiedTrade[] = [];
    let cumulativeGross = 0;
    let cumulativeFees = 0;
    let highWaterMark = 0;
    let netReturnFactor = 1;
    let currentDay: string | undefined;
    let dailyGross = 0;
    let dayOpeningNet = 0;
    const crystallizeDay = (): void => {
      if (!currentDay) return;
      const eligible = Math.max(0, cumulativeGross - highWaterMark);
      const fee = eligible > 0 ? Math.round(eligible * state.cashflow.policy.performanceFeeRate) : 0;
      if (eligible > 0) {
        feeEvents.push({
          id: `${follower.id}:fee:${currentDay}`, followerId: follower.id, date: currentDay,
          eligibleProfit: money(eligible), feeRate: state.cashflow.policy.performanceFeeRate,
          feeAmount: money(fee), highWaterMarkBefore: money(highWaterMark),
          highWaterMarkAfter: money(cumulativeGross),
        });
        highWaterMark = cumulativeGross;
      }
      cumulativeFees += fee;
      // Allocation events are explicitly day-start only. This denominator
      // neutralizes their cash flows while retaining prior trading gains/losses.
      const openingAccount = units(allocationAt(allocations, timestamp(currentDay))) + dayOpeningNet;
      if (openingAccount <= 0 || openingAccount + dailyGross - fee <= 0) {
        throw new Error(`Review follower cannot fund continuing copy execution: ${follower.id} on ${currentDay}`);
      }
      netReturnFactor *= 1 + (dailyGross - fee) / openingAccount;
      currentDay = undefined;
      dailyGross = 0;
    };
    for (const master of masterTrades) {
      const opened = timestamp(master.openedAt);
      if (opened < join) continue;
      const closedDay = utcDay(master.closedAt);
      if (currentDay && currentDay !== closedDay) crystallizeDay();
      const allocated = allocationAt(allocations, opened);
      if (allocated <= 0) continue;
      const day = masterDays.get(utcDay(master.openedAt));
      if (!day || !Number.isFinite(day.capitalAtRisk) || day.capitalAtRisk <= 0) {
        throw new Error(`Missing positive capital at risk for copied trade ${master.id}`);
      }
      if (timestamp(master.closedAt) < opened || utcDay(master.openedAt) !== closedDay
        || ![master.entryPrice, master.exitPrice, master.quantity, master.leverage].every(Number.isFinite)
        || master.entryPrice <= 0 || master.exitPrice <= 0 || master.quantity <= 0 || !(master.leverage >= 1)) {
        throw new Error('Invalid master position for review copy sizing');
      }
      if (!currentDay) {
        currentDay = closedDay;
        dayOpeningNet = cumulativeGross - cumulativeFees;
      }
      const availableEquity = units(allocated) + cumulativeGross - cumulativeFees;
      if (availableEquity <= 0) throw new Error(`Review follower cannot fund continuing copy execution: ${follower.id}`);
      const exposure = Math.min(units(allocated), availableEquity);
      const scale = money(exposure) / day.capitalAtRisk * follower.copyRatio;
      const quantity = master.quantity * scale;
      const grossBefore = units(master.grossPnl * scale);
      const fees = units(master.fees * scale);
      const funding = units(master.funding * scale);
      const roundTripNotional = quantity * (master.entryPrice + master.exitPrice);
      const execution = units(roundTripNotional * (follower.slippageBps + follower.latencyMs / 1000) / 10_000);
      const copied: CopiedTrade = {
        id: `${follower.id}:copy:${master.id}`, followerId: follower.id, masterTradeId: master.id,
        openedAt: master.openedAt, closedAt: master.closedAt,
        quantity, entryPrice: master.entryPrice, exitPrice: master.exitPrice,
        notional: money(units(master.entryPrice * quantity)),
        grossPnlBeforeCosts: money(grossBefore), tradingFees: money(fees), funding: money(funding),
        executionCost: money(execution), grossPnl: money(grossBefore - fees - funding - execution),
      };
      if (units(copied.notional / master.leverage) > availableEquity + 1) {
        throw new Error(`Copied position margin exceeds available review equity: ${copied.id}`);
      }
      followerTrades.push(copied);
      const gross = units(copied.grossPnl);
      cumulativeGross += gross;
      dailyGross += gross;
      if (units(allocated) + cumulativeGross - cumulativeFees <= 0) {
        throw new Error(`Review follower cannot fund continuing copy execution: ${follower.id} on ${closedDay}`);
      }
    }
    crystallizeDay();
    const currentAllocation = units(allocationAt(allocations, asOf));
    const net = cumulativeGross - cumulativeFees;
    followerUpdates.push({
      ...follower,
      startingAllocation: allocations[0].event.newAllocation,
      allocatedCapital: money(currentAllocation), active: currentAllocation > 0,
      grossPnl: money(cumulativeGross), performanceFees: money(cumulativeFees),
      netPnl: money(net), realizedPnl: money(net), unrealizedPnl: 0,
      currentEquity: money(currentAllocation + net), roi: (netReturnFactor - 1) * 100,
      copiedTrades: followerTrades.length, copiedVolume: money(sumUnits(followerTrades.map(trade => trade.notional))),
      highWaterMark: money(highWaterMark),
    });
    copiedTrades.push(...followerTrades);
  }
  copiedTrades.sort((a, b) => timestamp(a.closedAt) - timestamp(b.closedAt) || a.id.localeCompare(b.id));
  feeEvents.sort((a, b) => a.date.localeCompare(b.date) || a.followerId.localeCompare(b.followerId));
  const nextTrades = preserveRecords(state.cashflow.copiedTrades, copiedTrades);
  const nextFees = preserveRecords(state.cashflow.performanceFeeEvents, feeEvents);
  const nextAum = buildReviewAumHistory(state);
  // Publish projections only after the entire replay and immutable-history
  // checks succeeded, so a rejected historical rewrite cannot half-apply.
  state.cashflow.copiedTrades = nextTrades;
  state.cashflow.performanceFeeEvents = nextFees;
  state.followers = followerUpdates;
  state.aumHistory = nextAum;
}
