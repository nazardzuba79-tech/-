import { createHash, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { BANKING_PROGRAMS, VOLTEX_CARD_YIELD, bankingAsset, bankingProgram, minimumAssetQuantity, type BankingAsset } from './config';
import { addCalendarMonthsClamped, calculateBankingProgram, completedCalendarMonths, rewardForMonth } from './math';

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

  private async syncAccruals(userId:string, placements:PlacementRow[], now=new Date()) {
    for (const placement of placements) {
      const program=bankingProgram(placement.program_id); if(!program) continue;
      const completed=completedCalendarMonths(placement.opened_at, now, program.termMonths);
      for(let month=1;month<=completed;month+=1){
        const reward=rewardForMonth(program,placement.principal,month),effective=addCalendarMonthsClamped(placement.opened_at,month);
        await this.prisma.$executeRaw`
          INSERT INTO banking_ledger_entries(id,user_id,placement_id,entry_type,asset,amount,period_index,effective_at,metadata,created_at)
          VALUES(${randomUUID()},${userId},${placement.id},'REWARD_ACCRUED',${placement.asset},${reward}::numeric,${month},${effective},${JSON.stringify({monthlyRate:program.monthlyRate,compound:program.compound})}::jsonb,NOW())
          ON CONFLICT (placement_id,entry_type,period_index) WHERE period_index IS NOT NULL DO NOTHING`;
      }
    }
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
      const program=bankingProgram(row.program_id)!;
      const months=completedCalendarMonths(row.opened_at,now,program.termMonths);
      const calc=calculateBankingProgram({program,amount:row.principal,startDate:row.opened_at,endDate:now});
      const price=prices[row.asset as BankingAsset]??null;
      return {id:row.id,programId:row.program_id,programName:program.name,asset:row.asset,principal:row.principal,monthlyRate:program.monthlyRate,termMonths:program.termMonths,compound:program.compound,payoutFrequency:program.payoutFrequency,lockRule:program.lockRule,openedAt:row.opened_at.toISOString(),maturityDate:isoDay(row.matures_at),completedMonths:months,status:months>=program.termMonths?'MATURED':'ACTIVE',rewardAccrued:calc.totalRewards,currentBalance:calc.balance,rewardCurrency:row.asset,priceUsd:price,principalUsd:price?new BigNumber(row.principal).times(price).toFixed(2):null};
    });
    const active=rows.filter(row=>row.status==='ACTIVE');
    const totalUsd=active.length===0?'0':active.every(row=>row.priceUsd)?active.reduce((sum,row)=>sum.plus(new BigNumber(row.currentBalance).times(row.priceUsd!)),new BigNumber(0)).toFixed(2):null;
    const accruedUsd=rows.length===0?'0':rows.every(row=>row.priceUsd)?rows.reduce((sum,row)=>sum.plus(new BigNumber(row.rewardAccrued).times(row.priceUsd!)),new BigNumber(0)).toFixed(2):null;
    return {placements:rows,ledger:ledger.map(row=>({...row,effectiveAt:row.effective_at.toISOString(),createdAt:row.created_at.toISOString()})),summary:{totalUsd,accruedUsd,activeCount:active.length},cardYield:{...VOLTEX_CARD_YIELD,availableCardBalance:null,accruedReward:null,dataStatus:'UNAVAILABLE',reason:'CARD_BALANCE_NOT_AVAILABLE'}};
  }
}
