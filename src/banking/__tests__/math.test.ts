import BigNumber from 'bignumber.js';
import { BANKING_PROGRAMS, VOLTEX_CARD_YIELD, minimumAssetQuantity } from '../config';
import {
  addCalendarMonthsClamped, calculateBankingProgram, completedCalendarMonths,
  placementTerms, rewardForMonth,
} from '../math';

const payout=BANKING_PROGRAMS.find(x=>x.id==='MONTHLY_17_24M')!;
const compound=BANKING_PROGRAMS.find(x=>x.id==='COMPOUND_21_12M')!;

describe('Banking & Earn exact decimal/calendar model',()=>{
  test('program terms are 12% monthly for 12 months and 17% monthly compounding for 24',()=>{
    expect(payout.monthlyRate).toBe('0.12');expect(payout.termMonths).toBe(12);expect(payout.compound).toBe(false);
    expect(compound.monthlyRate).toBe('0.17');expect(compound.termMonths).toBe(24);expect(compound.compound).toBe(true);
  });

  // The ids are frozen and now name neither the right rate nor the right term. That is
  // deliberate — they are persisted in banking_placements.program_id — so pin it, or a
  // future tidy-up rename silently orphans every existing row.
  test('legacy program ids are frozen even though they no longer describe their own terms',()=>{
    expect(BANKING_PROGRAMS.map(p=>p.id)).toEqual(['MONTHLY_17_24M','COMPOUND_21_12M']);
    expect(payout.id).toContain('17');expect(payout.monthlyRate).not.toBe('0.17');
    expect(compound.id).toContain('12');expect(compound.termMonths).not.toBe(12);
  });

  // 12% MONTHLY and 12% ANNUAL sit on the same page sharing the same digits.
  test('Card yield is annual and stays 12% while Program 1 is monthly 12%',()=>{
    expect(VOLTEX_CARD_YIELD.annualRate).toBe('0.12');
    expect(payout.monthlyRate).toBe('0.12');
    expect(Object.keys(VOLTEX_CARD_YIELD)).toContain('annualRate');
    expect(Object.keys(VOLTEX_CARD_YIELD)).not.toContain('monthlyRate');
  });

  test('12% simple fixtures are exact on the original principal',()=>{
    const six=calculateBankingProgram({program:payout,amount:'2500',startDate:'2026-09-14',endDate:'2027-03-14'});
    const twelve=calculateBankingProgram({program:payout,amount:'2500',startDate:'2026-09-14',endDate:'2027-09-14'});
    expect(six.monthlyReward).toBe('300');expect(six.totalRewards).toBe('1800');expect(six.completedMonths).toBe(6);
    expect(six.balance).toBe('2500');
    expect(twelve.totalRewards).toBe('3600');expect(twelve.completedMonths).toBe(12);
    expect(twelve.balance).toBe('2500');
  });

  // The worked example from the brief, kept in its own test so it reads as the spec does.
  test('1000 at 12% pays 120 a month, 720 by month six, 1440 by month twelve',()=>{
    const six=calculateBankingProgram({program:payout,amount:'1000',startDate:'2026-01-10',endDate:'2026-07-10'});
    const twelve=calculateBankingProgram({program:payout,amount:'1000',startDate:'2026-01-10',endDate:'2027-01-10'});
    expect(six.monthlyReward).toBe('120');
    expect(six.totalRewards).toBe('720');
    expect(twelve.totalRewards).toBe('1440');
  });

  // Exact strings, not Number(...).toFixed(). A float round-trip cannot represent these
  // and would quietly pass on a value that is wrong in the 15th digit.
  test('17% compound fixtures are exact BigNumber strings across the 24 month term',()=>{
    const at=(end:string)=>calculateBankingProgram({program:compound,amount:'2500',startDate:'2026-09-14',endDate:end});
    const six=at('2027-03-14'),twelve=at('2027-09-14'),twentyFour=at('2028-09-14');
    expect(six.balance).toBe('6412.9105044225');
    expect(six.profit).toBe('3912.9105044225');
    expect(twelve.balance).toBe('16450.1684550929773568234025');
    expect(twelve.profit).toBe('13950.1684550929773568234025');
    expect(twentyFour.balance).toBe('108243.2168803744293557999497645672565245702286708025');
    expect(twentyFour.profit).toBe('105743.2168803744293557999497645672565245702286708025');
    const btc=calculateBankingProgram({program:compound,amount:'1',startDate:'2026-09-14',endDate:'2028-09-14'});
    expect(btc.balance).toBe('43.297286752149771742319979905826902609828091468321');
  });

  test('1000 at 17% compounds to an exact balance at 1, 6, 12 and 24 completed months',()=>{
    const growth=new BigNumber('1.17');
    for(const months of [1,6,12,24]){
      const end=addCalendarMonthsClamped('2026-01-10',months).toISOString().slice(0,10);
      const result=calculateBankingProgram({program:compound,amount:'1000',startDate:'2026-01-10',endDate:end});
      expect(result.completedMonths).toBe(months);
      expect(result.balance).toBe(new BigNumber('1000').times(growth.pow(months)).toFixed());
      expect(result.monthlyReward).toBeNull();
    }
  });

  test('each compound month reward is the growth on the balance that month started with',()=>{
    expect(rewardForMonth(compound,'1000',1)).toBe('170');
    expect(rewardForMonth(compound,'1000',2)).toBe(new BigNumber('1170').times('0.17').toFixed());
    expect(rewardForMonth(payout,'1000',1)).toBe('120');
    expect(rewardForMonth(payout,'1000',12)).toBe('120');
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

/**
 * A placement is a signed contract. Editing config.ts is a commercial decision about
 * what to offer NEXT; it is not permission to reprice what was already sold.
 *
 * These use placementTerms() on rows carrying the OLD 17%/21% rates, which is exactly
 * the state of the production table after the config change in this branch.
 */
describe('historical placements keep the terms they were opened under',()=>{
  const oldSimple={program_id:'MONTHLY_17_24M',monthly_rate:'0.17',term_months:12,compound:false};
  const oldCompound={program_id:'COMPOUND_21_12M',monthly_rate:'0.21',term_months:24,compound:true};

  test('placementTerms reads the row, not the program config',()=>{
    expect(placementTerms(oldSimple).monthlyRate).toBe('0.17');
    expect(placementTerms(oldCompound).monthlyRate).toBe('0.21');
    expect(payout.monthlyRate).toBe('0.12');
    expect(compound.monthlyRate).toBe('0.17');
  });

  test('a placement opened at 17% simple still accrues 17% after the config moved to 12%',()=>{
    const terms=placementTerms(oldSimple);
    const result=calculateBankingProgram({program:terms,amount:'1000',startDate:'2026-01-10',endDate:'2026-07-10'});
    expect(result.monthlyReward).toBe('170');
    expect(result.totalRewards).toBe('1020');
    expect(rewardForMonth(terms,'1000',1)).toBe('170');
    const repriced=calculateBankingProgram({program:payout,amount:'1000',startDate:'2026-01-10',endDate:'2026-07-10'});
    expect(repriced.totalRewards).toBe('720');
    expect(result.totalRewards).not.toBe(repriced.totalRewards);
  });

  test('a placement opened at 21% compound still compounds at 21% after the config moved to 17%',()=>{
    const terms=placementTerms(oldCompound);
    const result=calculateBankingProgram({program:terms,amount:'1000',startDate:'2026-01-10',endDate:'2026-07-10'});
    expect(result.balance).toBe(new BigNumber('1000').times(new BigNumber('1.21').pow(6)).toFixed());
    expect(rewardForMonth(terms,'1000',1)).toBe('210');
  });

  test('a row whose program_id is no longer in config still values correctly',()=>{
    const retired={program_id:'RETIRED_PROGRAM_X',monthly_rate:'0.09',term_months:6,compound:false};
    const result=calculateBankingProgram({program:placementTerms(retired),amount:'1000',startDate:'2026-01-10',endDate:'2026-04-10'});
    expect(result.monthlyReward).toBe('90');
    expect(result.totalRewards).toBe('270');
    expect(result.completedMonths).toBe(3);
  });

  test('new placements take the new rates',()=>{
    expect(calculateBankingProgram({program:payout,amount:'1000',startDate:'2026-01-10',endDate:'2026-02-10'}).monthlyReward).toBe('120');
    expect(rewardForMonth(compound,'1000',1)).toBe('170');
  });
});
