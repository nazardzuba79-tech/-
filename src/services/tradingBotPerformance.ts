import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { z } from 'zod';
import BigNumber from 'bignumber.js';
import { buildMonthlyPerformance, periodDrawdown } from '../shared/monthlyCopyPerformance';
import { BOT_PERIODS, THOMAS_STRATEGY, type BotHistory, type BotPeriod, type BotPeriodResult } from '../shared/thomasPerformance';

const DAY = 86_400_000;
const unavailable = { status: 'unavailable' } as const;
// Input is an operator-provisioned, read-only publication of verified daily aggregates.
// No current order ledger in VOLTEX identifies executions by this bot and strategy.
const amount = z.string().regex(/^-?\d{1,16}(\.\d{1,12})?$/).transform(value => new BigNumber(value));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const snapshot = z.object({
  version: z.literal(1), publication: z.literal('approved-aggregate'),
  botId: z.literal('range'), strategyId: z.literal(THOMAS_STRATEGY), pair: z.literal('XRP/USDT'),
  creatorUserId: z.string().uuid(), inceptionDate: date, asOf: z.string().datetime(),
  flowTiming: z.literal('end-of-day'), currency: z.literal('USDT'),
  days: z.array(z.object({
    date, opening: amount, closing: amount, externalFlow: amount,
    realizedGross: amount.nullable(), unrealizedChange: amount.nullable(), fees: amount.nullable(),
    trades: z.number().int().min(0).max(1e8), wins: z.number().int().min(0).max(1e8),
  }).strict()).min(1).max(3660),
}).strict();

type InputDay = z.infer<typeof snapshot>['days'][number];
type Day = InputDay & { net: BigNumber; dailyReturn: number };
function sum(days: Day[], key: 'net' | 'realizedGross' | 'unrealizedChange' | 'fees') {
  let total = new BigNumber(0);
  for (const day of days) {
    const value = day[key];
    if (value === null) return null;
    total = total.plus(value);
  }
  return total.toNumber();
}

function summarize(days: Day[]): BotPeriodResult {
  let factor = 1, trades = 0, wins = 0;
  const series = [0];
  for (const day of days) {
    factor *= 1 + day.dailyReturn; // The same daily TWR factors as the shared monthly table.
    series.push((factor - 1) * 100);
    trades += day.trades;
    wins += day.wins;
  }
  if (!series.every(Number.isFinite)) throw Error('Unrepresentable performance index');
  return { firstDate: days[0].date, lastDate: days[days.length - 1].date,
    roi: series[series.length - 1], series, netPnl: sum(days, 'net')!,
    realizedPnl: sum(days, 'realizedGross'), unrealizedChange: sum(days, 'unrealizedChange'),
    fees: sum(days, 'fees'), trades, winRate: trades ? wins / trades * 100 : null,
    drawdown: periodDrawdown(days.map(d => d.dailyReturn), 'DAILY_TWR'),
  };
}

export function buildBotHistory(input: unknown, ownerId: string, now = Date.now()): BotHistory {
  const data = snapshot.parse(input);
  if (data.creatorUserId !== ownerId || Date.parse(data.asOf) > now) throw Error('Invalid history attribution or cutoff');
  const inception = Date.parse(data.inceptionDate + 'T00:00:00Z');
  const days: Day[] = data.days.map((d, i) => {
    const expectedDate = new Date(inception + i * DAY).toISOString().slice(0, 10);
    const net = d.closing.minus(d.opening).minus(d.externalFlow);
    if (d.date !== expectedDate || (!i && d.date !== data.inceptionDate) || !d.opening.gt(0) || d.closing.lt(0) ||
      net.lt(d.opening.negated()) || (i > 0 && !d.opening.eq(data.days[i-1].closing)) ||
      d.wins > d.trades || d.fees?.lt(0)) throw Error('Discontinuous or invalid daily performance');
    if (d.realizedGross && d.unrealizedChange && d.fees && !d.realizedGross.plus(d.unrealizedChange).minus(d.fees).eq(net))
      throw Error('Daily PnL does not reconcile');
    return { ...d, net, dailyReturn: net.div(d.opening).toNumber() };
  });
  if (days[days.length - 1].date !== data.asOf.slice(0,10)) throw Error('Incomplete daily coverage');
  const end = new Date(data.asOf.slice(0,10) + 'T00:00:00Z');
  const anniversary = new Date(end);
  anniversary.setUTCFullYear(end.getUTCFullYear() - 1);
  if (anniversary.getUTCMonth() !== end.getUTCMonth()) anniversary.setUTCDate(0);
  const periods = {} as Record<BotPeriod, BotPeriodResult>;
  for (const p of BOT_PERIODS) {
    const length = p === 'ALL' ? days.length : p === '1Y' ? (end.getTime() - anniversary.getTime()) / DAY : parseInt(p,10);
    periods[p] = summarize(days.slice(-length));
  }
  const monthly = buildMonthlyPerformance(days.map(d => ({
    date: d.date, dailyReturn: d.dailyReturn, realizedPnl: d.realizedGross?.toNumber() ?? null, numberOfTrades: d.trades,
  })), 'DAILY_TWR');
  if (Object.values(monthly.cells).some(cell => !Number.isFinite(cell.roi))) throw Error('Unrepresentable monthly index');
  return { status: 'verified', botId: data.botId, strategyId: data.strategyId, inceptionDate: data.inceptionDate,
    asOf: data.asOf, periods, monthly };
}

/** The server operator owns the path. HTTP callers cannot select a file, account or strategy.
 * Replace complete snapshots atomically. A bad replacement fails closed, including after cache expiry. */
export function botHistoryReader(path: string | undefined, ownerId: string) {
  let cached: Promise<BotHistory> | undefined, expires = 0;
  let lastDigest: string | undefined, previous: BotHistory | undefined;
  async function read(): Promise<BotHistory> {
    const file = await open(path!, 'r');
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 3_000_000) throw Error('Invalid publication');
      const bytes = Buffer.alloc(stat.size + 1);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset !== stat.size) throw Error('Incomplete publication');
      const digest = createHash('sha256').update(bytes.subarray(0,offset)).digest('hex');
      if (digest === lastDigest && previous) return previous;
      const next = buildBotHistory(JSON.parse(bytes.toString('utf8', 0, offset)), ownerId);
      previous = next;
      lastDigest = digest;
      return next;
    } finally { await file.close(); }
  }
  return () => {
    if (!path || !ownerId) return Promise.resolve(unavailable);
    if (!cached || Date.now() >= expires) {
      expires = Date.now() + 15_000;
      cached = read();
    }
    return cached;
  };
}
