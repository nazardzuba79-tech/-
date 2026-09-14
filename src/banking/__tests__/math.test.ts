import { BANKING_PROGRAMS, minimumAssetQuantity } from '../config';
import { addCalendarMonthsClamped, calculateBankingProgram, completedCalendarMonths } from '../math';

const payout=BANKING_PROGRAMS.find(x=>x.id==='MONTHLY_17_24M')!;
const compound=BANKING_PROGRAMS.find(x=>x.id==='COMPOUND_21_12M')!;

describe('Banking & Earn exact decimal/calendar model',()=>{
  test('program terms are 17% for 12 months and 21% for 24 months',()=>{
    expect(payout.monthlyRate).toBe('0.17');expect(payout.termMonths).toBe(12);
    expect(compound.monthlyRate).toBe('0.21');expect(compound.termMonths).toBe(24);
  });
  test('17% fixtures are exact on original principal',()=>{
    const six=calculateBankingProgram({program:payout,amount:'2500',startDate:'2026-09-14',endDate:'2027-03-14'});
    const twelve=calculateBankingProgram({program:payout,amount:'2500',startDate:'2026-09-14',endDate:'2027-09-14'});
    expect(six.monthlyReward).toBe('425');expect(six.totalRewards).toBe('2550');expect(six.completedMonths).toBe(6);
    expect(twelve.totalRewards).toBe('5100');expect(twelve.completedMonths).toBe(12);
  });
  test('21% compound fixtures use BigNumber, including the 24 month term',()=>{
    const six=calculateBankingProgram({program:compound,amount:'2500',startDate:'2026-09-14',endDate:'2027-03-14'});
    const twelve=calculateBankingProgram({program:compound,amount:'2500',startDate:'2026-09-14',endDate:'2027-09-14'});
    const twentyFour=calculateBankingProgram({program:compound,amount:'2500',startDate:'2026-09-14',endDate:'2028-09-14'});
    expect(Number(six.balance).toFixed(2)).toBe('7846.07');expect(Number(six.profit).toFixed(2)).toBe('5346.07');
    expect(Number(twelve.balance).toFixed(2)).toBe('24624.33');expect(Number(twelve.profit).toFixed(2)).toBe('22124.33');
    expect(Number(twentyFour.balance).toFixed(2)).toBe('242543.08');expect(Number(twentyFour.profit).toFixed(2)).toBe('240043.08');
    const btc=calculateBankingProgram({program:compound,amount:'1',startDate:'2026-09-14',endDate:'2028-09-14'});
    expect(Number(btc.balance).toFixed(8)).toBe('97.01723378');
  });
  test('calendar months are floored and month end clamps',()=>{
    expect(completedCalendarMonths('2026-09-14','2027-03-13')).toBe(5);
    expect(completedCalendarMonths('2026-09-14','2027-03-14')).toBe(6);
    expect(addCalendarMonthsClamped('2027-01-31',1).toISOString().slice(0,10)).toBe('2027-02-28');
    expect(addCalendarMonthsClamped('2028-01-31',1).toISOString().slice(0,10)).toBe('2028-02-29');
    expect(addCalendarMonthsClamped('2027-01-31',2).toISOString().slice(0,10)).toBe('2027-03-31');
  });
  test('minimum uses live price input and rounds upward to the asset step',()=>{
    expect(minimumAssetQuantity('100000','BTC')).toBe('0.02500000');
    expect(minimumAssetQuantity('1.002','USDT')).toBe('2495.01');
    expect(minimumAssetQuantity('0.998','USDC')).toBe('2505.02');
  });
  test('requested end past term is capped at 24 month maturity',()=>{
    const result=calculateBankingProgram({program:compound,amount:'2500',startDate:'2026-09-14',endDate:'2029-01-14'});
    expect(result.completedMonths).toBe(24);expect(result.endDate).toBe('2028-09-14');
  });
});