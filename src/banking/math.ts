import BigNumber from 'bignumber.js';
import { bankingProgram, type BankingProgramConfig } from './config';

const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const utcDate = (value: string | Date) => value instanceof Date ? new Date(value.getTime()) : new Date(`${value}T00:00:00.000Z`);

export function addCalendarMonthsClamped(startInput: string | Date, months: number): Date {
  const start = utcDate(startInput);
  if (!Number.isFinite(start.getTime()) || !Number.isInteger(months)) throw new Error('invalid_date');
  const year = start.getUTCFullYear(), month = start.getUTCMonth(), day = start.getUTCDate();
  const targetFirst = new Date(Date.UTC(year, month + months, 1));
  const lastDay = new Date(Date.UTC(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth(), Math.min(day, lastDay)));
}

export function completedCalendarMonths(startInput: string | Date, endInput: string | Date, cap = 120): number {
  const start = utcDate(startInput), end = utcDate(endInput);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) return 0;
  let completed = 0;
  for (let next = 1; next <= cap; next += 1) {
    if (addCalendarMonthsClamped(start, next).getTime() > end.getTime()) break;
    completed = next;
  }
  return completed;
}

export interface BankingCalculation {
  programId: string;
  principal: string;
  completedMonths: number;
  startDate: string;
  endDate: string;
  monthlyReward: string | null;
  totalRewards: string;
  balance: string;
  profit: string;
  maturityDate: string;
}

export function calculateBankingProgram(params: {
  program: BankingProgramConfig | string;
  amount: string;
  startDate: string | Date;
  endDate: string | Date;
}): BankingCalculation {
  const program = typeof params.program === 'string' ? bankingProgram(params.program) : params.program;
  if (!program) throw new Error('program_not_found');
  const principal = new BigNumber(params.amount);
  if (!principal.isFinite() || !principal.isGreaterThan(0)) throw new Error('invalid_amount');
  const start = utcDate(params.startDate), requestedEnd = utcDate(params.endDate);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(requestedEnd.getTime())) throw new Error('invalid_date');
  const maturity = addCalendarMonthsClamped(start, program.termMonths);
  const effectiveEnd = requestedEnd > maturity ? maturity : requestedEnd;
  if (effectiveEnd < start) throw new Error('end_before_start');
  const months = completedCalendarMonths(start, effectiveEnd, program.termMonths);
  const rate = new BigNumber(program.monthlyRate);
  let monthlyReward: BigNumber | null = null, rewards: BigNumber, balance: BigNumber;
  if (program.compound) {
    balance = principal.times(new BigNumber(1).plus(rate).pow(months));
    rewards = balance.minus(principal);
  } else {
    monthlyReward = principal.times(rate);
    rewards = monthlyReward.times(months);
    balance = principal;
  }
  return {
    programId: program.id,
    principal: principal.toFixed(), completedMonths: months,
    startDate: isoDay(start), endDate: isoDay(effectiveEnd), maturityDate: isoDay(maturity),
    monthlyReward: monthlyReward?.toFixed() ?? null,
    totalRewards: rewards.toFixed(), balance: balance.toFixed(), profit: rewards.toFixed(),
  };
}

export function rewardForMonth(program: BankingProgramConfig, principalValue: string, month: number): string {
  if (month < 1 || month > program.termMonths) throw new Error('invalid_period_index');
  const principal = new BigNumber(principalValue), rate = new BigNumber(program.monthlyRate);
  if (!program.compound) return principal.times(rate).toFixed();
  const prior = principal.times(new BigNumber(1).plus(rate).pow(month - 1));
  return prior.times(rate).toFixed();
}
