import { createHash, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { BANKING_PROGRAMS, BANKING_REFERRAL_REWARD_PERCENT, VOLTEX_CARD_YIELD, bankingAsset, bankingProgram, minimumAssetQuantity, type BankingAsset } from './config';
import { addCalendarMonthsClamped, calculateBankingProgram, completedCalendarMonths, placementTerms, rewardForMonth } from './math';

export class BankingError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}

type PriceMap = Partial<Record<BankingAsset, string>>;
type PlacementRow = {
  id:string; user_id:string; program_id:string; asset:string; principal:string; monthly_rate:string;
  term_months:number; compound:boolean; payout_frequency:string; lock_rule:string;
  opened_at:Date; matures_at:Date; created_at:Date;
};
type LedgerRow = { id:string; placement_id:string|null; entry_type:string; asset:string; amount:string; period_index:number|null; effective_at:Date; created_at:Date };

const ASSET_IDS: Record<BankingAsset,string> = { USDT:'tether', USDC:'usd-coin', BTC:'bitcoin', ETH:'ethereum', SOL:'solana' };
const REQUEST_TIMEOUT_MS = 7000;

export class BankingPriceService {
  private cached: { at:number; prices:PriceMap } | null = null;
  constructor(private readonly fetchFn: typeof fetch = fetch) {}
  async prices(): Promise<PriceMap> {
    if (this.cached && Date.now() - this.cached.at < 15_000) return this.cached.prices;
    const ids = Object.values(ASSET_IDS).join(',');
    const base = process.env.COINGECKO_API_BASE_URL || 'https://api.coingecko.com/api/v3';
    const url = `${base.replace(/\/$/,'')}/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd`;
    const headers: Record<string,string> = { Accept:'application/json' };
    if (process.env.COINGECKO_API_KEY) headers['x-cg-demo-api-key'] = process.env.COINGECKO_API_KEY;
    const response = await this.fetchFn(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new BankingError('asset_price_unavailable', 503);
    const body = await response.json() as Record<string,{usd?:number}>;
    const prices: PriceMap = {};
    for (const asset of Object.keys(ASSET_IDS) as BankingAsset[]) {
      const value = body[ASSET_IDS[asset]]?.usd;
      if (Number.isFinite(value) && Number(value) > 0) prices[asset] = String(value);
    }
    this.cached = { at: Date.now(), prices };
    return prices;
  }
}

/**
 * Decimal places the ledger and Balance columns actually store: both are
 * NUMERIC/DECIMAL(36,18).
 *
 * Compound maturity profit carries ~50 significant decimals — 1000 x 1.17^24 is
 * not a terminating 18-place number — so a value handed to Postgres unrounded
 * comes back rounded by Postgres's own rule, while anything derived from it in
 * JS keeps the long tail. Ledger and payment then disagree in the last place.
 * Quantise once, here, and everything downstream agrees with what is stored.
 */
const LEDGER_SCALE = 18;

/**
 * Round a payable amount DOWN to what the ledger can hold.
 *
 * Down, not half-even: rounding a payout up invents money that was never
 * earned, and does it silently, once per settlement, forever.
 */
const payable = (value: BigNumber.Value) =>
  new BigNumber(value).decimalPlaces(LEDGER_SCALE, BigNumber.ROUND_DOWN);

const hashRequest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const decimal = (value: unknown) => new BigNumber(String(value));
const isoDay = (value: Date) => value.toISOString().slice(0,10);

export class BankingService {
  constructor(private readonly prisma: PrismaClient, private readonly priceService = new BankingPriceService()) {}

  async config() {
    let prices: PriceMap = {};
    try { prices = await this.priceService.prices(); } catch { /* explicit nulls below */ }
    return {
      programs: BANKING_PROGRAMS,
      assets: (Object.keys(ASSET_IDS) as BankingAsset[]).map(asset => ({ asset, priceUsd: prices[asset] ?? null, minimumAssetQty: prices[asset] ? minimumAssetQuantity(prices[asset]!, asset) : null })),
      rewardCurrencyRule: 'SAME_AS_DEPOSIT_ASSET', usdValuesAreReferenceOnly: true,
      cardYield: { ...VOLTEX_CARD_YIELD, availableCardBalance: null, accruedReward: null, dataStatus: 'UNAVAILABLE', reason: 'CARD_BALANCE_NOT_AVAILABLE' },
    };
  }

  async calculate(input:{programId:string;asset:string;amount:string;startDate:string;periodMonths?:number;endDate?:string}) {
    const program = bankingProgram(input.programId), asset = bankingAsset(input.asset);
    if (!program || !program.enabled) throw new BankingError('program_unavailable');
    if (!asset || !program.assets.includes(asset)) throw new BankingError('asset_unavailable');
    const amount = decimal(input.amount); if (!amount.isFinite() || !amount.isGreaterThan(0)) throw new BankingError('invalid_amount');
    const prices = await this.priceService.prices(), price = prices[asset];
    if (!price) throw new BankingError('asset_price_unavailable',503);
    const minimum = minimumAssetQuantity(price, asset, program.minUsd);
    const start = new Date(`${input.startDate}T00:00:00.000Z`);
    if (!Number.isFinite(start.getTime())) throw new BankingError('invalid_date');
    let end: Date;
    if (input.endDate) end = new Date(`${input.endDate}T00:00:00.000Z`);
    else if (input.periodMonths) end = addCalendarMonthsClamped(start, input.periodMonths);
    else throw new BankingError('period_required');
    if (!Number.isFinite(end.getTime())) throw new BankingError('invalid_date');
    const result = calculateBankingProgram({ program, amount: amount.toFixed(), startDate:start, endDate:end });
    return { ...result, asset, priceUsd: price, minimumAssetQty: minimum, usdEquivalent: amount.times(price).toFixed(2), rewardCurrency: asset };
  }

  async createPlacement(userId:string,input:{programId:string;asset:string;amount:string;idempotencyKey:string}) {
    const program = bankingProgram(input.programId), asset = bankingAsset(input.asset);
    if (!program || !program.enabled) throw new BankingError('program_unavailable');
    if (!asset || !program.assets.includes(asset)) throw new BankingError('asset_unavailable');
    const amount = decimal(input.amount); if (!amount.isFinite() || !amount.isGreaterThan(0)) throw new BankingError('invalid_amount');
    const prices = await this.priceService.prices(), price = prices[asset];
    if (!price) throw new BankingError('asset_price_unavailable',503);
    const minimum = new BigNumber(minimumAssetQuantity(price, asset, program.minUsd));
    if (amount.isLessThan(minimum)) throw new BankingError('below_minimum');
    const request = { programId:program.id, asset, amount:amount.toFixed() }, requestHash = hashRequest(request);

    return this.prisma.$transaction(async tx => {
      const old = await tx.$queryRaw<{request_hash:string;result_json:any}[]>`
        SELECT request_hash, result_json FROM banking_commands WHERE user_id=${userId} AND idempotency_key=${input.idempotencyKey} LIMIT 1`;
      if (old[0]) {
        if (old[0].request_hash !== requestHash) throw new BankingError('idempotency_key_reused',409);
        return old[0].result_json;
      }
      const debited = await tx.$queryRaw<{available:string}[]>`
        UPDATE "Balance" SET "available"="available"-${amount.toFixed()}::numeric, "updatedAt"=NOW()
        WHERE "userId"=${userId} AND asset=${asset} AND "available">=${amount.toFixed()}::numeric
        RETURNING "available"::text AS available`;
      if (!debited[0]) throw new BankingError('insufficient_available_balance');
      const id=randomUUID(), now=new Date(), maturity=addCalendarMonthsClamped(now, program.termMonths);
      await tx.$executeRaw`
        INSERT INTO banking_placements(id,user_id,program_id,asset,principal,monthly_rate,term_months,compound,payout_frequency,lock_rule,opened_at,matures_at,created_at)
        VALUES(${id},${userId},${program.id},${asset},${amount.toFixed()}::numeric,${program.monthlyRate}::numeric,${program.termMonths},${program.compound},${program.payoutFrequency},${program.lockRule},${now},${maturity},NOW())`;
      const ledgerId=randomUUID();
      await tx.$executeRaw`
        INSERT INTO banking_ledger_entries(id,user_id,placement_id,entry_type,asset,amount,period_index,effective_at,metadata,created_at)
        VALUES(${ledgerId},${userId},${id},'PRINCIPAL_LOCKED',${asset},${amount.toFixed()}::numeric,NULL,${now},${JSON.stringify({source:'WALLET_AVAILABLE'})}::jsonb,NOW())`;
      const result={id,programId:program.id,asset,principal:amount.toFixed(),openedAt:now.toISOString(),maturityDate:isoDay(maturity),rewardCurrency:asset};
      await tx.$executeRaw`
        INSERT INTO banking_commands(id,user_id,idempotency_key,action,request_hash,result_json,created_at)
        VALUES(${randomUUID()},${userId},${input.idempotencyKey},'CREATE_PLACEMENT',${requestHash},${JSON.stringify(result)}::jsonb,NOW())`;
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /**
   * Accrue whatever months have completed, at the rate the placement was OPENED at.
   *
   * Terms come from the row, never from bankingProgram(). The lookup used to decide the
   * rate here, which meant a config edit repriced every placement already in the table;
   * it also meant a placement whose program had been retired from config stopped
   * accruing entirely, because `if(!program) continue` skipped it. A row carries
   * everything this needs, so neither failure is reachable any more.
   */
  private async syncAccruals(userId:string, placements:PlacementRow[], now=new Date()) {
    for (const placement of placements) {
      const terms=placementTerms(placement);
      const completed=completedCalendarMonths(placement.opened_at, now, terms.termMonths);
      for(let month=1;month<=completed;month+=1){
        const reward=payable(rewardForMonth(terms,placement.principal,month)).toFixed(),effective=addCalendarMonthsClamped(placement.opened_at,month);
        await this.prisma.$executeRaw`
          INSERT INTO banking_ledger_entries(id,user_id,placement_id,entry_type,asset,amount,period_index,effective_at,metadata,created_at)
          VALUES(${randomUUID()},${userId},${placement.id},'REWARD_ACCRUED',${placement.asset},${reward}::numeric,${month},${effective},${JSON.stringify({monthlyRate:terms.monthlyRate,compound:terms.compound})}::jsonb,NOW())
          ON CONFLICT (placement_id,entry_type,period_index) WHERE period_index IS NOT NULL DO NOTHING`;
      }
    }
  }

  /**
   * Which periods of this placement are payable RIGHT NOW, under its own rules.
   *
   * A MONTHLY product pays each completed month. A MATURITY product pays
   * nothing at all until its term is up and then pays once — so a compound
   * placement cannot hand its referrer next year's growth today, which is the
   * whole point of asking the product rather than asking the calendar.
   */
  private payablePeriods(row:PlacementRow, now:Date): number[] {
    const terms=placementTerms(row);
    const completed=completedCalendarMonths(row.opened_at,now,terms.termMonths);
    if(completed<1) return [];
    if(row.payout_frequency==='MATURITY') return completed>=terms.termMonths?[terms.termMonths]:[];
    return Array.from({length:completed},(_,index)=>index+1);
  }

  /** What one payable period is worth, in the placement's own asset. */
  private settlementAmount(row:PlacementRow, period:number): string {
    const terms=placementTerms(row);
    if(row.payout_frequency!=='MATURITY') return payable(rewardForMonth(terms,row.principal,period)).toFixed();
    // One payment for the whole compounded term, not the final month's growth.
    return payable(calculateBankingProgram({program:terms,amount:row.principal,startDate:row.opened_at,
      endDate:addCalendarMonthsClamped(row.opened_at,terms.termMonths)}).totalRewards).toFixed();
  }

  /**
   * Pay out whatever this placement has actually earned, and only that.
   *
   * THIS IS THE ONLY PATH IN BANKING THAT MOVES MONEY OUTWARD, and it is a
   * POST for that reason. Accrual — what syncAccruals writes, and what
   * GET /banking/state triggers — records that a reward was earned. It does
   * not pay it, and it must never pay it: a page refresh is not a financial
   * instruction, and a GET that credits balances would pay a referrer every
   * time someone opened a tab.
   *
   * EXACTLY-ONCE lives in the database, not in this function. Each payout
   * first inserts a REWARD_PAID ledger row under the existing partial unique
   * index on (placement_id, entry_type, period_index); if that insert reports
   * zero rows, this period was already settled by some earlier call, a
   * concurrent request or a retry after a crash, and nothing further happens
   * for it — no balance credit, no commission. There is deliberately no
   * banking_commands entry here: a request-hash cache would be keyed on the
   * REQUEST, and two different requests should each be able to settle
   * different periods. The ledger row is keyed on the PERIOD, which is the
   * thing that must not be paid twice.
   *
   * The referral commission rides the same guarantee. It can only be created
   * alongside a REWARD_PAID row that this call actually inserted, and its own
   * table has a unique key on that row's id, so it is impossible to pay a
   * commission for profit that was not settled, or to pay one twice.
   */
  async settlePlacement(userId:string, placementId:string, now=new Date()) {
    return this.prisma.$transaction(async tx => {
      const rows=await tx.$queryRaw<PlacementRow[]>`
        SELECT id,user_id,program_id,asset,principal::text,monthly_rate::text,term_months,compound,payout_frequency,lock_rule,opened_at,matures_at,created_at
        FROM banking_placements WHERE id=${placementId} AND user_id=${userId} FOR UPDATE`;
      const placement=rows[0];
      if(!placement) throw new BankingError('placement_not_found',404);

      const owner=await tx.user.findUnique({where:{id:userId},select:{referredById:true}});
      const referrerId=owner?.referredById&&owner.referredById!==userId?owner.referredById:null;
      const asset=placement.asset;
      const settled:{period:number;amount:string;ledgerEntryId:string;commission:string|null}[]=[];

      for(const period of this.payablePeriods(placement,now)){
        const amount=this.settlementAmount(placement,period);
        if(!new BigNumber(amount).isGreaterThan(0)) continue;
        const ledgerEntryId=randomUUID();
        // The gate. Zero rows means somebody already settled this period.
        const inserted=await tx.$executeRaw`
          INSERT INTO banking_ledger_entries(id,user_id,placement_id,entry_type,asset,amount,period_index,effective_at,metadata,created_at)
          VALUES(${ledgerEntryId},${userId},${placement.id},'REWARD_PAID',${asset},${amount}::numeric,${period},${addCalendarMonthsClamped(placement.opened_at,period)},${JSON.stringify({monthlyRate:placement.monthly_rate,payoutFrequency:placement.payout_frequency})}::jsonb,NOW())
          ON CONFLICT (placement_id,entry_type,period_index) WHERE period_index IS NOT NULL DO NOTHING`;
        if(inserted===0) continue;

        await tx.balance.upsert({where:{userId_asset:{userId,asset}},
          create:{userId,asset,available:amount,locked:'0'},
          update:{available:{increment:amount}}});

        let commission:string|null=null;
        if(referrerId){
          // 20% OF THE PROFIT JUST PAID, in that same asset. Never of principal,
          // and never deducted from the referred user — the credit above already
          // gave them the whole amount.
          commission=payable(new BigNumber(amount).times(BANKING_REFERRAL_REWARD_PERCENT).div(100)).toFixed();
          if(new BigNumber(commission).isGreaterThan(0)){
            await tx.bankingReferralReward.create({data:{referrerId,referredUserId:userId,
              placementId:placement.id,bankingRewardLedgerEntryId:ledgerEntryId,asset,
              sourceProfitAmount:amount,commissionRate:new BigNumber(BANKING_REFERRAL_REWARD_PERCENT).div(100).toFixed(),
              amount:commission}});
            await tx.balance.upsert({where:{userId_asset:{userId:referrerId,asset}},
              create:{userId:referrerId,asset,available:commission,locked:'0'},
              update:{available:{increment:commission}}});
            await tx.auditLog.create({data:{userId:referrerId,action:'BANKING_REFERRAL_REWARD_CREDITED',
              metadata:{referrerId,referredUserId:userId,placementId:placement.id,sourceRewardId:ledgerEntryId,
                asset,sourceProfitAmount:amount,rate:BANKING_REFERRAL_REWARD_PERCENT,rewardAmount:commission}}});
          } else commission=null;
        }
        settled.push({period,amount,ledgerEntryId,commission});
      }

      return {placementId:placement.id,asset,settled,
        settledCount:settled.length,
        totalSettled:settled.reduce((sum,row)=>sum.plus(row.amount),new BigNumber(0)).toFixed()};
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
  }

  /**
   * Banking referral facts for the Banking page. READ ONLY — it pays nothing.
   *
   * Reports only Banking commissions. The 5%-of-deposit programme has its own
   * endpoint, its own table and its own totals; adding them together here would
   * let the page label deposit money as "20% от прибыли", which it is not.
   */
  async referralSummary(userId:string) {
    const [user,referredCount,byAsset,recent]=await Promise.all([
      this.prisma.user.findUnique({where:{id:userId},select:{referralCode:true}}),
      this.prisma.user.count({where:{referredById:userId}}),
      this.prisma.bankingReferralReward.groupBy({by:['asset'],where:{referrerId:userId},_sum:{amount:true}}),
      this.prisma.bankingReferralReward.findMany({where:{referrerId:userId},orderBy:{createdAt:'desc'},take:20,
        select:{id:true,asset:true,amount:true,sourceProfitAmount:true,createdAt:true}}),
    ]);
    if(!user) throw new BankingError('user_not_found',404);
    return {
      referralCode:user.referralCode,
      referralPercent:BANKING_REFERRAL_REWARD_PERCENT,
      referredCount,
      rewardsByAsset:byAsset.map(row=>({asset:row.asset,amount:(row._sum.amount??'0').toString()})),
      recentRewards:recent.map(row=>({id:row.id,asset:row.asset,amount:row.amount.toString(),
        sourceProfitAmount:row.sourceProfitAmount.toString(),createdAt:row.createdAt.toISOString()})),
    };
  }

  async state(userId:string, now=new Date()) {
    const placements=await this.prisma.$queryRaw<PlacementRow[]>`
      SELECT id,user_id,program_id,asset,principal::text,monthly_rate::text,term_months,compound,payout_frequency,lock_rule,opened_at,matures_at,created_at
      FROM banking_placements WHERE user_id=${userId} ORDER BY created_at DESC`;
    await this.syncAccruals(userId,placements,now);
    const ledger=await this.prisma.$queryRaw<LedgerRow[]>`
      SELECT id,placement_id,entry_type,asset,amount::text,period_index,effective_at,created_at
      FROM banking_ledger_entries WHERE user_id=${userId} ORDER BY effective_at DESC,created_at DESC LIMIT 500`;
    let prices:PriceMap={}; try{prices=await this.priceService.prices();}catch{}
    const rows=placements.map(row=>{
      // Every commercial figure below is the placement's own, from its own row. The
      // program config is consulted for ONE thing — the display name — and even that
      // falls back rather than throwing, so a retired program still renders.
      const terms=placementTerms(row);
      const months=completedCalendarMonths(row.opened_at,now,terms.termMonths);
      const calc=calculateBankingProgram({program:terms,amount:row.principal,startDate:row.opened_at,endDate:now});
      const price=prices[row.asset as BankingAsset]??null;
      return {id:row.id,programId:row.program_id,programName:bankingProgram(row.program_id)?.name??row.program_id,asset:row.asset,principal:row.principal,monthlyRate:terms.monthlyRate,termMonths:terms.termMonths,compound:terms.compound,payoutFrequency:row.payout_frequency,lockRule:row.lock_rule,openedAt:row.opened_at.toISOString(),maturityDate:isoDay(row.matures_at),completedMonths:months,status:months>=terms.termMonths?'MATURED':'ACTIVE',rewardAccrued:calc.totalRewards,currentBalance:calc.balance,rewardCurrency:row.asset,priceUsd:price,principalUsd:price?new BigNumber(row.principal).times(price).toFixed(2):null};
    });
    const active=rows.filter(row=>row.status==='ACTIVE');
    const totalUsd=active.length===0?'0':active.every(row=>row.priceUsd)?active.reduce((sum,row)=>sum.plus(new BigNumber(row.currentBalance).times(row.priceUsd!)),new BigNumber(0)).toFixed(2):null;
    const accruedUsd=rows.length===0?'0':rows.every(row=>row.priceUsd)?rows.reduce((sum,row)=>sum.plus(new BigNumber(row.rewardAccrued).times(row.priceUsd!)),new BigNumber(0)).toFixed(2):null;
    return {placements:rows,ledger:ledger.map(row=>({...row,effectiveAt:row.effective_at.toISOString(),createdAt:row.created_at.toISOString()})),summary:{totalUsd,accruedUsd,activeCount:active.length},cardYield:{...VOLTEX_CARD_YIELD,availableCardBalance:null,accruedReward:null,dataStatus:'UNAVAILABLE',reason:'CARD_BALANCE_NOT_AVAILABLE'}};
  }
}
