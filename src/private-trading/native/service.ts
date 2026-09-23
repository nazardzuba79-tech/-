import { randomUUID } from 'crypto';
import { CommandScope, commandScope, commandCheck, commandRead, commandSignal } from './commandScope';
import BigNumber from 'bignumber.js';
import { nativeHistoryCache } from './historyCache';
import { liveCheckpoint, recoverEmptyObservationCheckpoint } from './replay';
import type { CollateralHolding } from './collateral';
import { PrivateTradingMarketData, PrivateChartInterval, PrivateMark, PrivateMarketDataError, PrivateValuationMark, PRIVATE_QUOTE_MAX_AGE_MS, assertPrivateFreshQuote, assertPrivateFreshMark, assertHistoricalDemoCurrentPrice, HISTORICAL_DEMO_CURRENT_MAX_AGE_MS, HISTORICAL_DEMO_COMMIT_HEADROOM_MS } from '../marketData';
import { OwnerSession, PrivateTradingError } from '../serviceTypes';
import { contractRules, simulationProfile } from '../service';
import { calculatePosition, closePositionAllocation, fundingCashflow, pnlForRoi, quoteOrderCost, roiPercent, targetExitPrice, validateContractOrder, ContractRuleError } from '../math';
import { NativeAccount, NativeRepository, commandHash } from './store';
import { demoAccount, demoPositionView, DemoEngineError, DemoMarginType, DemoProtection, DemoState, ExternalCollateral, executeObservedBook, protectionTrigger, migrateDemoState, NATIVE_DEMO_MODEL, setDemoCollateral } from './engine';
import { valueCollateral, CollateralPrice, CollateralValuation } from './collateral';
import { crossAccount, CrossAccount } from './accountModel';

/**
 * What the calculator can ask to have priced. Four shapes, one per tab, each
 * carrying only what its authoritative function needs — there is no "compute
 * everything" mode, because a field the answer does not depend on is a field
 * that can silently disagree with the one the trader typed.
 */
export type NativeQuoteInput =
  | { kind:'ORDER'; symbol:string; side:'LONG'|'SHORT'; quantity:string; price:string; leverage:string; maker?:boolean; market?:boolean }
  | { kind:'POSITION'; symbol:string; side:'LONG'|'SHORT'; quantity:string; entryPrice:string; markPrice:string; leverage:string; allocatedMargin?:string }
  | { kind:'TARGET'; symbol:string; side:'LONG'|'SHORT'; quantity:string; entryPrice:string; leverage:string; basis:'GROSS'|'NET';
      targetPnl?:string; targetRoiPercent?:string; allocatedMargin?:string; maker?:boolean }
  | { kind:'FUNDING'; symbol:string; side:'LONG'|'SHORT'; quantity:string; markPrice:string; rate:string; intervals?:number }
  | { kind:'PNL'; symbol:string; side:'LONG'|'SHORT'; quantity:string; entryPrice:string; exitPrice:string; leverage:string; maker?:boolean };

/** Which contract rule an order broke, in the engine's own words. */
export interface NativeQuoteViolation { code:string; limit:string; allowed:string; actual:string }

export type NativeQuoteResult =
  | { kind:'ORDER'; entryNotional:string|null; baseInitialMargin:string|null; closeFeeReserve:string|null; openingFee:string|null;
      positionMargin:string|null; totalCost:string|null; violation:NativeQuoteViolation|null;
      rules:ReturnType<typeof contractRules>; takerFeeRate:string; makerFeeRate:string }
  | ({ kind:'POSITION'; takerFeeRate:string; makerFeeRate:string } & ReturnType<typeof calculatePosition>)
  | { kind:'TARGET'; exitPrice:string|null; targetPnl:string; roiMarginBasis:string; openingFee:string; closingFeeRate:string;
      takerFeeRate:string; makerFeeRate:string }
  | { kind:'FUNDING'; perInterval:string; intervals:number; total:string; takerFeeRate:string; makerFeeRate:string }
  | { kind:'PNL'; entryNotional:string; baseInitialMargin:string; positionMargin:string; openingFee:string; closingFee:string;
      grossPnl:string; netPnl:string; roiMarginBasis:string; roiPercent:string|null; roiPercentNet:string|null;
      takerFeeRate:string; makerFeeRate:string };
import { unifiedWalletRows, UnifiedWalletRow } from './walletRows';
import { accountLedger, AccountLedger } from './ledger';
import { applyLatestQuotes, BarRequest, compareInstructions, exposedSymbols, historicalLimitTouch, nativeAdmissionLimits, NativeBook, NativeInstruction, nextInstructionSeq, ReplayBar, ReplayResult, replayNativeDemoAsync } from './replay';
import type { PrivateFreshQuote } from '../marketData';
import { markDemoAccount } from './engine';
export interface NativeCandle {source:'BYBIT_LINEAR';interval:PrivateChartInterval;openTime:number;pricePoint:'OPEN'|'CLOSE'}
export type NativeCommand = {idempotencyKey:string;executionMode?:'LIVE_EXECUTION'|'HISTORICAL_DEMO'} & (
  | {kind:'REFRESH'}
  /**
   * `reduceOnly` + `positionId` make this a REDUCING order that keeps its
   * own type. A reduce-only LIMIT is a resting close at a price — the
   * engine has always supported it (`placeDemoOrder` validates the side
   * and size against the position) — and it must NOT be collapsed into a
   * CLOSE, which prices at the book instead of at the price the trader set.
   */
  | {kind:'OPEN';symbol:string;side:'LONG'|'SHORT';type:'MARKET'|'LIMIT';margin?:string;quantity?:string;leverage:string;price?:string;candle?:NativeCandle;protection?:Partial<DemoProtection>;reduceOnly?:boolean;positionId?:string;marginType?:DemoMarginType}
  | {kind:'CLOSE';positionId:string;quantity?:string;candle?:NativeCandle}
  | {kind:'CANCEL';orderId:string}
  | {kind:'PROTECTION';positionId:string;protection:Partial<DemoProtection>}
  | {kind:'LEVERAGE';positionId:string;leverage:string}
);
/** Superseded observations are compacted once at least this many have accumulated (a full replay each time). */
export const NATIVE_OBSERVE_COMPACT_MIN=200;
/** The full verification replay's own time budget, well inside a command's 30 s. */
export const NATIVE_OBSERVE_COMPACT_BUDGET_MS=12_000;
/** Large legacy journals need extra room for the one full verification replay. */
export const NATIVE_OBSERVE_COMPACT_LARGE_BUDGET_MS=20_000;
export const NATIVE_OBSERVE_COMPACT_LARGE_DROP_MIN=1_000;
const canonicalJson=(v:unknown)=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
/** The whole engine state, key order aside; a from-scratch replay creates an empty `historicalMarks` a checkpointed one never had. */
const comparableState=(s:DemoState)=>{const{historicalMarks,...rest}=s;return canonicalJson(historicalMarks&&Object.keys(historicalMarks).length?s:rest);};
/**
 * The HISTORICAL_DEMO OBSERVE instructions whose whole effect the next
 * instruction overwrites: no event was emitted at their time, and the next
 * instruction in journal order is an OBSERVE that re-marks every contract
 * they marked and carries collateral whenever they did.
 */
export function supersededObservations(row:NativeAccount):Set<string>{
  const eventTimes=new Set(row.snapshot.events.map(e=>e.time));
  const ordered=[...row.commands].sort(compareInstructions),out=new Set<string>();
  for(let i=0;i+1<ordered.length;i++){
    const c=ordered[i],next=ordered[i+1];
    if(c.kind!=='OBSERVE'||next.kind!=='OBSERVE'||c.executionMode!=='HISTORICAL_DEMO'||next.executionMode!=='HISTORICAL_DEMO')continue;
    if(eventTimes.has(c.at)||c.at===next.at)continue;
    if(c.collateral!==undefined&&next.collateral===undefined)continue;
    if(Object.keys(c.marks).some(symbol=>!next.marks[symbol]))continue;
    out.add(c.id);
  }
  return out;
}
/** HISTORICAL_DEMO commands that are accepted without a current price (see `historicalDemoRest`). */
const restsWithoutPrice=(c:NativeCommand)=>c.kind==='CANCEL'
  ||(c.kind==='OPEN'&&c.type==='LIMIT'&&!!c.reduceOnly&&!!c.positionId&&!!c.price&&!!c.quantity&&!c.candle);
/** The sampled prices could not be had: the collector refused, timed out or was unreachable, or its prices were stale. */
const marketOutage=(e:unknown)=>e instanceof PrivateMarketDataError?e.status>=500||e.status===429
  :e instanceof Error&&(e.name==='TimeoutError'||(e instanceof TypeError&&e.message==='fetch failed'));
const MINUTE=60_000;
/** A plain refresh is persisted only when something happened or the stored canonical checkpoint is this old. */
export const NATIVE_REFRESH_PERSIST_MS=15*MINUTE;
/**
 * Commands waiting per account, beyond the one running. Two tabs, a burst
 * of closes and the 30-second refresh all fit; a runaway client does not.
 * Overflow is an explicit retriable refusal, never a silent drop.
 */
export const NATIVE_COMMAND_QUEUE_LIMIT=16;
/**
 * A quote fetched this recently is reused for VALUATION — marking the other
 * open contracts and pricing wallet collateral — instead of being fetched
 * again. Well inside the 5-second freshness the engine re-checks at use.
 * The contract an order EXECUTES on always gets a fresh book; that fresh
 * quote then serves the same command's valuation, so it is fetched once.
 */
export const NATIVE_QUOTE_REUSE_MS=2000;
/**
 * A mark taken from the collector's live frame is used only while it is
 * younger than this at the moment it is applied — inside the engine's own
 * 5-second window with a margin — otherwise the contract is quoted itself.
 */
export const NATIVE_FRAME_MARK_MAX_AGE_MS=4000;
/** Attempts one command gets at the revision CAS before a cross-instance conflict is reported to the caller. */
export const NATIVE_COMMIT_ATTEMPTS=3;
/** Upstream quotes requested in parallel while valuing many open contracts. */
export const NATIVE_QUOTE_BATCH=8;
interface CommandLane{chain:Promise<unknown>;depth:number;/** The most recently queued plain REFRESH, while nothing was queued after it. */tailRefresh:Promise<unknown>|null;tailRefreshOwner?:object}
// HTTP routes and the cached executor construct different services over the
// same Prisma client. Coordinate before reading/replaying, outside DB locks.
// Separate clients/replicas still use the unchanged transactional CAS guard.
const repositoryLanes=new WeakMap<object,Map<string,CommandLane>>();
/** The three fields of a valuation the engine acts on. */
export const externalCollateral=(v:CollateralValuation):ExternalCollateral=>({priced:v.collateralPriced,complete:v.complete,asOf:v.asOf});
/** A copy of the snapshot valued on `valuation`, or the snapshot itself when it already carries the same figure. */
function projectCollateral(snapshot:DemoState,valuation:CollateralValuation):DemoState{
  const next=externalCollateral(valuation),current=snapshot.collateral??null;
  if(current&&current.priced===next.priced&&current.complete===next.complete&&current.asOf===next.asOf)return snapshot;
  const copy={...snapshot};setDemoCollateral(copy,next);return copy;
}
const outcome=(s:NativeAccount['snapshot'])=>JSON.stringify([s.events.map(e=>e.id+e.kind+e.time+e.price),s.orders.map(o=>o.status+o.filled),s.positions.map(p=>p.status+p.quantity)]);
/** Keep only the observed depth a command can consume (deterministic replay without storing 1000 levels). */
export function truncateBook(book:NativeBook,side:'BUY'|'SELL',quantity:string,limit?:string):NativeBook{
  const need=new BigNumber(quantity),levels=side==='BUY'?book.asks:book.bids,kept:NativeBook['bids']=[];let total=new BigNumber(0);
  for(const level of levels){
    if(limit!==undefined&&(side==='BUY'?new BigNumber(level.price).gt(limit):new BigNumber(level.price).lt(limit)))break;
    kept.push({price:level.price,quantity:level.quantity});total=total.plus(level.quantity);if(total.gte(need))break;
  }
  return side==='BUY'?{bids:[],asks:kept,timestamp:book.timestamp}:{bids:kept,asks:[],timestamp:book.timestamp};
}
export class NativeDemoService {
  /**
   * ONE ORDERED LANE PER ACCOUNT, in this process.
   *
   * The previous guard was a `Set` of busy accounts that answered a second
   * request with `native_busy` — so a CLOSE arriving while the 30-second
   * REFRESH ran was refused, and the trader's click was lost. Commands for
   * one account now wait their turn in arrival order; different accounts
   * never block each other. A plain REFRESH that is still the tail of the
   * lane is shared with the next plain REFRESH instead of being run twice.
   *
   * This lane is process-local. Two replicas are still serialized by the
   * repository: `commit` takes the account row lock and refuses a stale
   * revision, so a double spend across processes remains impossible — the
   * lane only stops one process from refusing its own trader.
   */
  private readonly lanes:Map<string,CommandLane>;
  private quotes=new Map<string,{at:number;quote:PrivateFreshQuote}>();
  private marks=new Map<string,{at:number;mark:PrivateMark}>();
  constructor(readonly repository:NativeRepository,private readonly market:PrivateTradingMarketData,private readonly now:()=>number=Date.now){
    const scope=repository.commandLaneScope;
    this.lanes=(scope&&repositoryLanes.get(scope))||new Map<string,CommandLane>();
    if(scope)repositoryLanes.set(scope,this.lanes);
  }
  /** A reused snapshot that no longer passes the freshness check is replaced by a fresh fetch, not reported as stale. */
  private async valuationQuote(symbol:string):Promise<PrivateFreshQuote>{
    const cached=await this.quote(symbol);
    try{return assertPrivateFreshQuote(cached,symbol,this.now());}
    catch{const fresh=await this.quote(symbol,true);return assertPrivateFreshQuote(fresh,symbol,this.now());}
  }
  /**
   * A collateral valuation needs a contract's MARK and the moment the venue
   * produced it, not its book (`assertPrivateFreshMark`): a source answering
   * with a mark alone prices the holding, and a reused snapshot whose mark
   * no longer passes at use is replaced by a fresh fetch, never reported.
   */
  private async valuationMark(symbol:string):Promise<PrivateValuationMark>{
    const cached=await this.quote(symbol);
    try{return assertPrivateFreshMark(cached,symbol,this.now());}
    catch{const fresh=await this.quote(symbol,true);return assertPrivateFreshMark(fresh,symbol,this.now());}
  }
  /**
   * Marks of the contracts an account holds but is NOT executing on, from the
   * collector's live frame in one call (`PrivateTradingMarketData.marks`).
   * A market source without the method (fixtures, older collectors) or a
   * failed call answers with no marks, and every contract is then quoted
   * itself as before; nothing stale is ever used in place of a quote.
   */
  private async frameMarks(symbols:string[]):Promise<Map<string,PrivateMark>>{
    const out=new Map<string,PrivateMark>(),missing:string[]=[];
    const valid=(m:PrivateMark,symbol:string)=>m.symbol===symbol&&new BigNumber(m.markPrice).isFinite()&&new BigNumber(m.markPrice).gt(0)
      &&new BigNumber(m.lastPrice).isFinite()&&new BigNumber(m.lastPrice).gt(0)
      &&[m.markProviderTimestamp,m.receivedAt,m.fetchedAt].every(t=>Number.isSafeInteger(t)&&t>0&&t<=this.now()+1000&&this.now()-t<=NATIVE_FRAME_MARK_MAX_AGE_MS);
    for(const symbol of new Set(symbols)){
      const cached=this.marks.get(symbol);
      if(cached&&this.now()-cached.at<NATIVE_QUOTE_REUSE_MS&&valid(cached.mark,symbol))out.set(symbol,cached.mark);
      else{this.marks.delete(symbol);missing.push(symbol);}
    }
    if(typeof this.market.marks==='function')for(let i=0;i<missing.length;i+=64){
      const wanted=missing.slice(i,i+64);
      try{for(const [symbol,mark] of await commandRead('market.marks',()=>this.market.marks(wanted,commandSignal())))if(wanted.includes(symbol)&&valid(mark,symbol)){
        this.marks.set(symbol,{at:this.now(),mark});out.set(symbol,mark);
      }}catch{commandCheck();/* Missing marks take the validated quote fallback. */}
    }
    while(this.marks.size>256)this.marks.delete(this.marks.keys().next().value!);
    return out;
  }
  private youngQuote(symbol:string){const c=this.quotes.get(symbol);return !!c&&this.now()-c.at<NATIVE_QUOTE_REUSE_MS;}
  /** A quote for valuation may be a recent one; a quote to execute on is always fetched now. */
  private async quote(symbol:string,fresh=false):Promise<PrivateFreshQuote>{
    const cached=this.quotes.get(symbol);
    if(!fresh&&cached&&this.now()-cached.at<NATIVE_QUOTE_REUSE_MS)return cached.quote;
    const quote=await commandRead('market.book',()=>this.market.freshQuote(symbol,commandSignal()));
    this.quotes.set(symbol,{at:this.now(),quote});
    if(this.quotes.size>256)for(const [k,v] of this.quotes)if(this.now()-v.at>=NATIVE_QUOTE_REUSE_MS)this.quotes.delete(k);
    return quote;
  }
  /**
   * The state projection WITHOUT an account.
   *
   * `account` and `ledger` are deliberately `null` here and filled in by
   * `authoritative()`. The engine's own settle-denominated figures used to
   * be returned straight from this method, which made every response's type
   * a UNION of two different account shapes — a caller could not tell from
   * the contract which one it had, and a field could go missing without
   * anything failing to compile. There is now exactly one account shape on
   * the wire, and exactly one place that builds it.
   */
  view(row:NativeAccount|null){
    const empty={model:NATIVE_DEMO_MODEL,account:null as CrossAccount|null,ledger:null as AccountLedger|null};
    if(!row)return{...empty,initialized:false,revision:0,positions:[] as ReturnType<typeof demoPositionView>[],history:[] as ReturnType<typeof demoPositionView>[],
      orders:[] as DemoState['orders'],events:[] as DemoState['events'],source:null as NativeAccount['source']|null,asOf:null as number|null,
      entries:[] as {positionId:string;candle:NativeCandle|null}[]};
    const positions=row.snapshot.positions.map(p=>({...demoPositionView(row.snapshot,p),...(p.entryTimestamp?{openedAt:p.entryTimestamp}:{})}));
    return{...empty,initialized:true,executionMode:row.executionMode??'LIVE_EXECUTION',revision:row.revision,positions:positions.filter(p=>p.status==='OPEN'),history:positions.filter(p=>p.status!=='OPEN'),
      orders:row.snapshot.orders,events:row.snapshot.events,source:row.source as NativeAccount['source']|null,asOf:row.snapshot.time as number|null,
      entries:row.commands.filter((c):c is Extract<NativeInstruction,{kind:'OPEN'}>=>c.kind==='OPEN').map(c=>({positionId:c.order.id,candle:c.candle??null}))};
  }
  /**
   * WHAT THE WHOLE WALLET IS WORTH, as the Cross collateral base.
   *
   * Every asset the owner holds is priced in the settle asset from the SAME
   * market data the terminal trades on — one price source, no second table
   * of numbers to disagree with the first. An asset whose quote cannot be
   * fetched comes back UNPRICED and named: the valuation says so and stays
   * `complete: false`, rather than pretending the holding is worth nothing.
   * A caller that needs a collateral figure must read `complete`.
   *
   * No total is written into the code. The figure is whatever the owner's
   * rows and the live quotes make it.
   */
  async collateral(actor:OwnerSession,row?:NativeAccount|null,options:{reuse?:boolean;holdings?:CollateralHolding[]}={}):Promise<CollateralValuation>{
    const accountRow=row===undefined?await commandRead('repository.read',()=>this.repository.read(actor)):row;
    const holdings=options.holdings??await commandRead('repository.holdings',()=>this.repository.holdings(actor));
    if(accountRow?.executionMode==='HISTORICAL_DEMO'){
      const symbols=holdings.filter(h=>h.asset!=='USDT'&&new BigNumber(h.available).plus(h.locked??'0').gt(0)).map(h=>h.asset+'USDT');
      const prices=await this.demoCurrentPrices(symbols,new Set());
      return this.demoCollateral(holdings,prices,accountRow);
    }
    const settle='USDT';
    // Commands need enabled, nonzero collateral. Wallet reads still value
    // disabled holdings too, so a preference cannot alter economic equity.
    const priced=holdings.filter(h=>h.asset!==settle&&new BigNumber(h.available).plus(h.locked??'0').gt(0)
      &&(!options.reuse||!accountRow?.disabledCollateralAssets?.includes(h.asset)));
    // One frame read for every asset that has no quote of this command's own; a mark is all a valuation needs.
    const frame=await this.frameMarks(priced.map(h=>`${h.asset}${settle}`).filter(symbol=>!(options.reuse&&this.youngQuote(symbol))));
    const priceOne=async(h:{asset:string},fresh:boolean):Promise<CollateralPrice>=>{
      try{
        const mark=fresh?undefined:frame.get(`${h.asset}${settle}`);
        if(mark&&this.now()-mark.markProviderTimestamp<=NATIVE_FRAME_MARK_MAX_AGE_MS)return{asset:h.asset,price:mark.markPrice,source:'BYBIT_LINEAR_MARK',asOf:mark.markProviderTimestamp};
        // Inside a command the valuation may share the command's own fresh
        // quotes (the same observation, once). A plain read always prices
        // the wallet now: a reader asking for the account gets the market
        // as it is, not a two-second-old snapshot. EITHER WAY the quote's
        // MARK is checked for freshness at the moment it is used — a
        // snapshot that was 4.5 s old when it was taken is 6 s old 1.5 s
        // later, and the service's own reuse window says nothing about the
        // provider's timestamp — and a quote that fails is fetched again,
        // then refused as unpriced rather than used. A new order is admitted
        // only on a valuation that passed this check; what the terminal
        // keeps on screen from an earlier reading is its own display.
        // The mark is all a valuation reads: a source that answers with a
        // mark and no book (the test-account wallet projection) prices
        // the holding; execution alone needs the whole observed book.
        const symbol=`${h.asset}${settle}`;
        const quoted=options.reuse&&!fresh?await this.valuationMark(symbol):assertPrivateFreshMark(await this.quote(symbol,true),symbol,this.now());
        // Mark, not last: the collateral is valued the way the positions
        // it backs are valued, so the two cannot drift apart.
        return{asset:h.asset,price:quoted.markPrice,source:'BYBIT_LINEAR_MARK',asOf:quoted.markProviderTimestamp};
      }catch{
        commandCheck();
        // A contract that does not exist and a provider that is down are
        // the same answer here: we do not know what this is worth.
        return{asset:h.asset,price:null,source:'BYBIT_LINEAR_MARK',asOf:null};
      }
    };
    let prices=await Promise.all(priced.map(h=>priceOne(h,false)));
    // WHAT WAS FRESH WHEN IT ANSWERED MAY NOT BE FRESH NOW. The assets are
    // priced in parallel; one source answering late makes every other
    // price older by the wait. A price that has left the freshness window
    // by the time all sources have answered is fetched ONCE more, fresh;
    // one that is still outside it afterwards is unpriced. Bounded: one
    // extra round, never a loop, and nothing here holds a database lock.
    const expired=(p:CollateralPrice)=>p.price!==null&&p.asOf!==null&&this.now()-p.asOf>PRIVATE_QUOTE_MAX_AGE_MS;
    if(prices.some(expired)){
      prices=await Promise.all(prices.map((p,i)=>expired(p)?priceOne(priced[i],true):Promise.resolve(p)));
      prices=prices.map(p=>expired(p)?{asset:p.asset,price:null,source:p.source,asOf:null}:p);
    }
    return valueCollateral(holdings,prices,settle,new Set(accountRow?.disabledCollateralAssets??[]));
  }
  /**
   * ONE ACCOUNT OBJECT, WHATEVER ASKED FOR IT.
   *
   * `view()` projects the engine's own settle-denominated figures. Every
   * response the terminal receives — a state poll, an order, a close, a
   * refresh — replaces that with the AUTHORITATIVE account: the same
   * engine figures folded together with the wallet's other collateral by
   * `crossAccount`, plus the ledger that explains the balance.
   *
   * Going through one helper is the point. When the poll and the order
   * response each built their own account, a trader could place an order
   * and watch available margin disagree with itself for five seconds.
   */
  private async authoritative(actor:OwnerSession,view:ReturnType<NativeDemoService['view']>,row:NativeAccount|null,valued?:CollateralValuation):Promise<ReturnType<NativeDemoService['view']>>{
    if(!row||!view.initialized)return view;
    // `valued` lets a caller that already has THIS request's valuation pass
    // it in instead of paying for a second one. It is the same object, so
    // the account it produces is the same account — never a second reading
    // of prices that could have moved between the two.
    const valuation=valued??await this.collateral(actor,row);
    // A plain read projects the CURRENT valuation into the engine state it
    // reports from, so the account figures and every position's liquidation
    // reference are answered on the same collateral. Nothing is persisted.
    const snapshot=projectCollateral(row.snapshot,valuation);
    const projected=snapshot===row.snapshot?view:this.view({...row,snapshot});
    const open=snapshot.positions.some(p=>p.status==='OPEN');
    return{...projected,account:crossAccount(demoAccount(snapshot),valuation,open),ledger:accountLedger(snapshot)};
  }
  /**
   * THE AUTHORITATIVE ACCOUNT — one computation, server-side.
   *
   * Equity, available margin, both margins, the liquidation verdict and the
   * ledger all come from here. Nothing downstream recomputes any of them:
   * two derivations of one figure are two figures, and the terminal has
   * already been bitten once by exactly that (a maintenance margin derived
   * a second time from the real tier table read 0.00%).
   *
   * The collateral valuation is folded in here rather than in the engine
   * because the engine is denominated in the settle asset and knows nothing
   * about the owner's other holdings. Keeping it out of the engine also
   * keeps replay deterministic: the journal does not depend on what BTC was
   * worth when the account happened to be read.
   */
  async account(actor:OwnerSession):Promise<{account:CrossAccount;ledger:AccountLedger}|null>{
    const row=await commandRead('repository.read',()=>this.repository.read(actor));
    if(!row)return null;
    const view=await this.authoritative(actor,this.view(row),row);
    return{account:view.account as CrossAccount,ledger:view.ledger as AccountLedger};
  }
  private async walletForRow(actor:OwnerSession,row:NativeAccount,valuation?:CollateralValuation){
    const valued=valuation??await this.collateral(actor,row);
    const view=await this.authoritative(actor,this.view(row),row,valued);
    const account=view.account as CrossAccount;
    const assetsValue=new BigNumber(account.settleBalance).plus(valued.priced);
    return{
      initialized:true,
      account,
      ledger:view.ledger as AccountLedger,
      collateral:valued,
      rows:unifiedWalletRows(account,valued),
      // All wallet assets stay visible here even when the owner elects not
      // to use one of them as margin. Only account.collateral/equity use the
      // enabled subset.
      assetsValue:assetsValue.toFixed(),
      // Wallet equity is the economic account value used by Overview and
      // performance snapshots. Toggling collateral eligibility must not
      // manufacture a profit/loss event.
      assetsEquityValue:assetsValue.plus(account.unrealizedPnl).toFixed(),
      assetsComplete:valued.unpriced.length===0,
      unpricedAssets:valued.unpriced,
    };
  }
  /**
   * THE WALLET, AS ONE ANSWER.
   *
   * The Wallet page needs the account (equity, margins, P&L) AND the
   * per-asset breakdown that backs it. Asking `/account` and `/collateral`
   * for those would be two requests, two valuations and — because
   * `freshQuote` is deliberately uncached — two rounds of upstream quotes
   * that can disagree with each other. One valuation is computed here and
   * used for both, so the rows a reader sees ADD UP to the header above
   * them by construction rather than by coincidence.
   *
   * Nothing is recomputed: `account` is the same `crossAccount()` the
   * terminal reads and `collateral` the same `valueCollateral()` result it
   * was built from. `settleBalance` is the part of the wallet that has
   * already moved into the simulation ledger; the collateral lines are the
   * part that has not. They are disjoint by construction — initialization
   * DEBITS the settle row it takes — so a reader may add them without
   * counting a unit of value twice.
   *
   * `null` when the account has not been opened yet: there is no equity to
   * report, and reporting zero would be a different claim.
   */
  async wallet(actor:OwnerSession){
    const row=await commandRead('repository.read',()=>this.repository.read(actor));
    if(!row)return null;
    return this.walletForRow(actor,row);
  }
  /**
   * Toggle one non-settle wallet asset in/out of Cross collateral.
   *
   * This changes NO holding and NO engine position. The asset remains in the
   * wallet at its full market value; only the amount that backs margin is
   * changed. A disable is refused when the remaining collateral would no
   * longer cover existing IM/order reserve or would make the Cross account
   * liquidatable. The preference is persisted in the same revisioned native
   * account row, so reloads and another tab see the same state.
   */
  async setCollateralPreference(actor:OwnerSession,assetInput:string,enabled:boolean,idempotencyKey:string){
    const asset=assetInput.toUpperCase();
    if(asset==='USDT')throw new PrivateTradingError('collateral_locked','USDT является расчётным активом и всегда используется как обеспечение.',409);
    const hash=commandHash({kind:'COLLATERAL_PREFERENCE',asset,enabled});
    const prior=await this.repository.prior(actor,idempotencyKey,hash);
    if(prior)return this.walletForRow(actor,prior);

    const row=await commandRead('repository.read',()=>this.repository.read(actor));
    if(!row)throw new PrivateTradingError('initialize_demo','Сначала подключите торговый счёт',409);
    const holdings=await commandRead('repository.holdings',()=>this.repository.holdings(actor));
    const holding=holdings.find(h=>h.asset===asset);
    const held=holding?new BigNumber(holding.available).plus(holding.locked??'0'):new BigNumber(0);
    if(!holding||!held.gt(0))throw new PrivateTradingError('collateral_asset_missing','Этот актив отсутствует в кошельке.',409);

    const disabled=new Set(row.disabledCollateralAssets??[]);
    const alreadyEnabled=!disabled.has(asset);
    if(alreadyEnabled===enabled)return this.walletForRow(actor,row);
    if(enabled)disabled.delete(asset);else disabled.add(asset);

    const next:NativeAccount={...row,disabledCollateralAssets:[...disabled].sort()};
    const valuation=await this.collateral(actor,next);
    if(enabled&&valuation.collateralUnpriced.includes(asset)){
      throw new PrivateTradingError('collateral_unpriced','Для этого актива сейчас нет подтверждённой цены. Его нельзя включить в обеспечение.',409);
    }

    const engine=demoAccount(projectCollateral(row.snapshot,valuation));
    const open=row.snapshot.positions.some(p=>p.status==='OPEN');
    const prospective=crossAccount(engine,valuation,open);
    if(!enabled){
      const freeBeforeFloor=new BigNumber(prospective.equity)
        .minus(engine.isolatedUnrealizedPnl??'0')
        .minus(prospective.initialMargin)
        .minus(prospective.orderReserve);
      if(freeBeforeFloor.lt(0)||prospective.liquidatable===true){
        throw new PrivateTradingError('collateral_required','Этот актив сейчас нужен для обеспечения открытых позиций или ордеров.',409);
      }
    }

    const committed=await this.repository.commit(actor,row.revision,next,idempotencyKey,hash);
    return this.walletForRow(actor,committed,valuation);
  }
  /** Display revaluation only: never replay, settle, trigger, execute or commit. */
  async live(actor:OwnerSession){
    if(!this.repository.live)throw new PrivateTradingError('live_unavailable','Счёт временно недоступен',503);
    const projection=await this.repository.live(actor);
    if(!projection)return{...this.view(null),demoAvailable:await this.repository.available(actor)};
    const snapshot=structuredClone(projection.state);
    const row:NativeAccount={revision:projection.revision,executionMode:projection.executionMode,deposit:snapshot.initialDeposit,commands:[],snapshot,
      source:projection.source,createdAt:projection.createdAt,disabledCollateralAssets:projection.disabledCollateralAssets};
    const valuation=await this.collateral(actor,row);
    setDemoCollateral(snapshot,externalCollateral(valuation));
    const symbols=[...new Set(snapshot.positions.map(p=>p.symbol))].sort();
    const hybrid=projection.executionMode==='HISTORICAL_DEMO';
    const frame=hybrid?await this.demoCurrentPrices(symbols):await this.frameMarks(symbols);
    const latest:Record<string,{mark:string;last:string;time:number}>={};
    for(const symbol of symbols){
      const mark=frame.get(symbol);
      if(mark&&(hybrid||this.now()-mark.markProviderTimestamp<=NATIVE_FRAME_MARK_MAX_AGE_MS))
        latest[symbol]={mark:mark.markPrice,last:mark.lastPrice,time:mark.markProviderTimestamp};
      else{const quote=await this.valuationQuote(symbol);latest[symbol]={mark:quote.markPrice,last:quote.lastPrice,time:quote.markProviderTimestamp};}
    }
    const at=Math.max(this.now(),snapshot.time);
    if(Object.values(latest).some(q=>at-q.time>(hybrid?HISTORICAL_DEMO_CURRENT_MAX_AGE_MS:PRIVATE_QUOTE_MAX_AGE_MS)||q.time>at+1000))throw new PrivateMarketDataError('quote_stale');
    markDemoAccount(snapshot,latest,at);
    return{initialized:true,revision:projection.revision,executionMode:projection.executionMode,source:projection.source,asOf:at,model:NATIVE_DEMO_MODEL,
      account:crossAccount(demoAccount(snapshot),valuation,snapshot.positions.length>0),
      ledger:{...projection.ledger,entries:[]},
      positions:snapshot.positions.map(p=>({...demoPositionView(snapshot,p),...(p.entryTimestamp?{openedAt:p.entryTimestamp}:{})})),orders:snapshot.orders,
      history:[],events:[],entries:projection.entryMarkers??[],historyDeferred:true};
  }
  async state(actor:OwnerSession){
    const row=await commandRead('repository.read',()=>this.repository.read(actor));
    const view=await this.authoritative(actor,this.view(row),row);
    return{...view,demoAvailable:row?null:await this.repository.available(actor)};
  }
  /**
   * The contract's own trading rules, for the terminal's order form.
   *
   * These are the numbers `validateContractOrder` enforces. Publishing them
   * is what lets the form SIZE to the contract — snap to `qtyStep`, stop at
   * `maxMarketOrderQty`, refuse below `minNotionalValue` — instead of
   * sending a quantity the engine then has to refuse. The rules are the
   * instrument service's cached Bybit values; nothing here invents or
   * relaxes one. `actor` is required so this stays behind the same
   * owner+ADMIN+session gate as every other native route.
   */
  /**
   * PRICED, NOT PLACED — the calculator's only server call.
   *
   * Every figure the Futures calculator shows comes from here, computed by
   * the same functions the engine itself uses to admit and settle an order.
   * The frontend owns no copy of this arithmetic, because a second
   * implementation is a second set of answers: the moment the fee model or
   * the risk ladder moves, a mirrored formula keeps quoting the old one and
   * the trader is shown a margin the server will not accept.
   *
   * This method is READ-ONLY and structurally so, not by convention:
   *   - it never touches `this.repository`, so nothing is persisted;
   *   - it issues no command, so no revision and no idempotency key exist;
   *   - it reads exactly one thing, the instrument, for its contract rules
   *     and fee/risk profile.
   * The only reason it is a server call at all is that `frontend/Dockerfile`
   * builds from `frontend/` alone — `src/` is not in that image, so the
   * shared module the frontend would otherwise import is not reachable.
   */
  async priceQuote(actor:OwnerSession,input:NativeQuoteInput):Promise<NativeQuoteResult>{
    void actor;
    const instrument=await this.market.instrument(input.symbol);
    const profile=simulationProfile(instrument);
    const rules=contractRules(instrument);
    if(input.kind==='ORDER'){
      // The rule check is REPORTED, not thrown: a calculator is a place to
      // discover that a size is out of bounds, and the numbers beside that
      // warning are still worth showing.
      let violation:NativeQuoteViolation|null=null;
      try{
        validateContractOrder({rules,profile,quantity:input.quantity,price:input.price,leverage:input.leverage,market:input.market??false});
      }catch(error){
        violation=error instanceof ContractRuleError
          ? {code:error.message,...error.detail}
          : {code:error instanceof Error?error.message:'INVALID_ORDER',limit:'',allowed:'',actual:''};
      }
      try{
        const cost=quoteOrderCost({side:input.side,quantity:input.quantity,price:input.price,leverage:input.leverage,profile,maker:input.maker});
        return {kind:'ORDER',...cost,violation,rules,takerFeeRate:profile.takerFeeRate,makerFeeRate:profile.makerFeeRate};
      }catch(error){
        // A cost that cannot be quoted at all (tier leverage, bad input) is
        // still an answer: the violation explains it and the figures are null.
        return {kind:'ORDER',entryNotional:null,baseInitialMargin:null,closeFeeReserve:null,openingFee:null,positionMargin:null,totalCost:null,
          violation:violation??{code:error instanceof Error?error.message:'INVALID_ORDER',limit:'',allowed:'',actual:''},
          rules,takerFeeRate:profile.takerFeeRate,makerFeeRate:profile.makerFeeRate};
      }
    }
    if(input.kind==='POSITION'){
      const snapshot=calculatePosition({side:input.side,quantity:input.quantity,entryPrice:input.entryPrice,markPrice:input.markPrice,
        leverage:input.leverage,profile,...(input.allocatedMargin===undefined?{}:{allocatedMargin:input.allocatedMargin})});
      return {kind:'POSITION',...snapshot,takerFeeRate:profile.takerFeeRate,makerFeeRate:profile.makerFeeRate};
    }
    if(input.kind==='TARGET'){
      // ROI is resolved against the engine's OWN basis, taken from the same
      // snapshot the position panel reads, so "+200%" here and "+200%" there
      // are the same number rather than two conventions.
      const basisSnapshot=calculatePosition({side:input.side,quantity:input.quantity,entryPrice:input.entryPrice,markPrice:input.entryPrice,
        leverage:input.leverage,profile,...(input.allocatedMargin===undefined?{}:{allocatedMargin:input.allocatedMargin})});
      const targetPnl=input.targetPnl!==undefined?input.targetPnl:pnlForRoi(input.targetRoiPercent??'0',basisSnapshot.roiMarginBasis);
      const opening=quoteOrderCost({side:input.side,quantity:input.quantity,price:input.entryPrice,leverage:input.leverage,profile,maker:input.maker});
      const exitPrice=targetExitPrice({side:input.side,quantity:input.quantity,entryPrice:input.entryPrice,targetPnl,
        basis:input.basis,openingFee:opening.openingFee,closingFeeRate:profile.takerFeeRate});
      return {kind:'TARGET',exitPrice,targetPnl,roiMarginBasis:basisSnapshot.roiMarginBasis,openingFee:opening.openingFee,
        closingFeeRate:profile.takerFeeRate,takerFeeRate:profile.takerFeeRate,makerFeeRate:profile.makerFeeRate};
    }
    if(input.kind==='PNL'){
      // Nothing is computed here. The opening side comes from the same
      // function that admits an order; the closing side from the same
      // function that settles one, asked for a FULL close at the exit price
      // — which is what a "what if I close here" question actually is.
      const opening=quoteOrderCost({side:input.side,quantity:input.quantity,price:input.entryPrice,leverage:input.leverage,profile,maker:input.maker});
      const closed=closePositionAllocation({side:input.side,quantity:input.quantity,closeQuantity:input.quantity,
        entryPrice:input.entryPrice,exitPrice:input.exitPrice,allocatedMargin:opening.positionMargin,
        openingFeesRemaining:opening.openingFee,feeRate:profile.takerFeeRate});
      const basis=calculatePosition({side:input.side,quantity:input.quantity,entryPrice:input.entryPrice,markPrice:input.entryPrice,
        leverage:input.leverage,profile}).roiMarginBasis;
      return {kind:'PNL',entryNotional:opening.entryNotional,baseInitialMargin:opening.baseInitialMargin,
        positionMargin:opening.positionMargin,openingFee:opening.openingFee,closingFee:closed.closingFee,
        grossPnl:closed.realizedGross,netPnl:closed.netRealized,roiMarginBasis:basis,
        roiPercent:roiPercent(closed.realizedGross,basis),roiPercentNet:roiPercent(closed.netRealized,basis),
        takerFeeRate:profile.takerFeeRate,makerFeeRate:profile.makerFeeRate};
    }
    const perInterval=fundingCashflow(input.side,input.quantity,input.markPrice,input.rate);
    const intervals=input.intervals??1;
    return {kind:'FUNDING',perInterval,intervals,
      total:new BigNumber(perInterval).times(intervals).toFixed(),
      takerFeeRate:profile.takerFeeRate,makerFeeRate:profile.makerFeeRate};
  }
  async contract(actor:OwnerSession,symbol:string){
    void actor;
    const instrument=await commandRead('market.instrument',()=>this.market.instrument(symbol,commandSignal()));
    return{...contractRules(instrument),riskTiers:simulationProfile(instrument).riskTiers,
      takerFeeRate:simulationProfile(instrument).takerFeeRate,makerFeeRate:simulationProfile(instrument).makerFeeRate};
  }
  async initialize(actor:OwnerSession,key:string){const row=await this.repository.initialize(actor,key);return this.authoritative(actor,this.view(row),row);}
  private async bars(request:BarRequest):Promise<ReplayBar[]>{
    return commandRead('market.history',()=>nativeHistoryCache(this.market,this.now).load(request,commandSignal()));
  }
  /** Mark price at a minute boundary: the open of the minute starting there, or the close of the minute ending there. */
  private async markAt(symbol:string,time:number,edge:'START'|'END'):Promise<string>{
    if(time%MINUTE!==0)throw new DemoEngineError('ENTRY_MARK_UNAVAILABLE');
    const start=edge==='START'?time:time-MINUTE,bars=await this.bars({symbol,start,end:start+MINUTE,intervalMs:MINUTE});
    const bar=bars.find(b=>b.time===start);if(!bar)throw new DemoEngineError('ENTRY_MARK_UNAVAILABLE');
    return edge==='START'?bar.mark.open:bar.mark.close;
  }
  command(actor:OwnerSession,request:NativeCommand,options:{persist?:boolean;scope?:CommandScope}={}){
    // The lane is entered SYNCHRONOUSLY, so arrival order is call order and
    // not the order in which two idempotency lookups happened to return.
    const scope=options.scope??new CommandScope(request.kind);
    return scope.run(async()=>{
      scope.trace('received');
      try{const result=await this.serialized(actor.userId,request,options,()=>this.execute(actor,request,commandHash(request),options));
        scope.trace('confirmed',{revision:result.revision});return result;
      }catch(e){scope.trace('refused',{code:e instanceof PrivateTradingError||e instanceof PrivateMarketDataError||e instanceof DemoEngineError?e.code:'internal_error'});throw e;}
    });
  }
  /** How many commands this account has running or waiting right now. */
  queued(userId:string){return this.lanes.get(userId)?.depth??0;}
  private serialized<T>(userId:string,request:NativeCommand,options:{persist?:boolean},task:()=>Promise<T>):Promise<T>{
    const lane=this.lanes.get(userId)??{chain:Promise.resolve(),depth:0,tailRefresh:null};
    const plainRefresh=request.kind==='REFRESH'&&!options.persist;
    // A refresh queued behind a refresh would read the same state twice.
    // Only the TAIL is shared: a refresh queued after a CLOSE must observe it.
    // Share ordering across services, not responses/authorization envelopes.
    if(plainRefresh&&lane.tailRefresh&&lane.tailRefreshOwner===this)return lane.tailRefresh as Promise<T>;
    if(lane.depth>=NATIVE_COMMAND_QUEUE_LIMIT)return Promise.reject(new PrivateTradingError('native_queue_full','Слишком много операций в очереди. Повторите через секунду',429));
    lane.depth+=1;this.lanes.set(userId,lane);
    const predecessor=lane.chain;
    const run=(async()=>{await commandRead('lane.wait',()=>predecessor.catch(()=>undefined));commandCheck();return task();})();
    lane.chain=Promise.allSettled([predecessor,run]);
    lane.tailRefresh=plainRefresh?run:null;
    lane.tailRefreshOwner=plainRefresh?this:undefined;
    const settle=()=>{lane.depth-=1;if(lane.tailRefresh===run)lane.tailRefresh=null;if(lane.depth===0)this.lanes.delete(userId);};
    run.then(settle,settle);
    return run;
  }
  /**
   * Two server instances (or a command that overlaps a scheduled refresh on
   * another replica) can both read revision N and both try to commit N+1.
   * The database lets exactly one through; the other's whole attempt is
   * discarded by the revision CAS — nothing of it was persisted — and used
   * to surface as `account_changed` after the trader had already been told
   * to try again. The loser now decides AGAIN on the row as it is now: the
   * row is re-read, the same idempotency key is re-checked (the winner may
   * have been this very command from another tab), the instruction is
   * rebuilt from the new row (a reduce order whose position the winner
   * closed is refused, never filled), the contract is quoted fresh, the
   * scenario replayed and the commit retried against the new revision. It
   * is bounded: after `NATIVE_COMMIT_ATTEMPTS` the conflict is reported as
   * before. Nothing here is optimistic — every attempt persists only through
   * the same CAS, and a receipt is returned only for a committed row.
   */
  private async execute(actor:OwnerSession,request:NativeCommand,hash:string,options:{persist?:boolean}){
    for(let attempt=1;;attempt++){
      try{return await this.attempt(actor,request,hash,options);}
      catch(e){
        if(attempt>=NATIVE_COMMIT_ATTEMPTS||!(e instanceof PrivateTradingError&&e.code==='account_changed'))throw e;
        this.conflicts+=1;commandScope()?.trace('revision.conflict',{attempt});commandCheck();
      }
    }
  }
  /** Revision conflicts that were retried inside a command (observability for the audit; never a user-facing figure). */
  conflicts=0;
  /** Live decisions made again because the execution book had expired during the command's waits (audit only). */
  expiredDecisions=0;
  private async attempt(actor:OwnerSession,request:NativeCommand,hash:string,options:{persist?:boolean}){
    {
      // Re-checked INSIDE the lane: a double click queues the same key twice,
      // and the second must answer with the first's receipt rather than find
      // its position already closed and refuse.
      let prepared:Awaited<ReturnType<NonNullable<NativeRepository['commandContext']>>>|null,prior:NativeAccount|null;
      try{
        prepared=this.repository.commandContext?await commandRead('repository.context',()=>this.repository.commandContext!(actor,request.idempotencyKey,hash)):null;
        prior=prepared?prepared.prior:await commandRead('repository.prior',()=>this.repository.prior(actor,request.idempotencyKey,hash));
      }catch(e){
        // Until the receipt lookup completes, a request with this key may
        // already have committed on another instance. Do not claim refusal.
        if(e instanceof PrivateTradingError&&e.code==='native_command_timeout')throw new PrivateTradingError('native_confirmation_unknown','Не удалось проверить результат команды. Обновите позиции и ордера перед повторной отправкой.',503);
        throw e;
      }
      if(prior){
        commandScope()?.trace('receipt.found',{revision:prior.revision});
        try{return await this.authoritative(actor,this.view(prior),prior);}
        catch(e){
          // Failure to refresh today's collateral cannot undo a recorded receipt
          // or tell the client that its previously committed order was refused.
          commandScope()?.trace('receipt.projection_unavailable',{revision:prior.revision});
          throw new PrivateTradingError('native_confirmation_unknown','Команда уже записана. Обновите позиции и ордера перед повторной отправкой.',503);
        }
      }
      const row=prepared?prepared.row:await commandRead('repository.read',()=>this.repository.read(actor));if(!row)throw new PrivateTradingError('initialize_demo','Сначала подключите демо-баланс',409);
      if(request.executionMode==='HISTORICAL_DEMO'||row.executionMode==='HISTORICAL_DEMO'){
        commandScope()?.trace('execution.dispatch',{executionMode:'HISTORICAL_DEMO'});
        if(request.executionMode==='LIVE_EXECUTION')throw new DemoEngineError('EXECUTION_MODE_MISMATCH');
        // A resting close at the trader's price (and its cancellation) changes no exposure and
        // needs no current price to be ACCEPTED. When the sampled prices cannot be had, it is
        // journaled without an observation; the next fresh observation decides whether it fills.
        const base=await this.compactHistoricalObservations(row);
        return this.historicalDemoAttempt(actor,base,request,hash,prepared?.holdings,!!options.persist).catch(e=>{
          if(!restsWithoutPrice(request)||!marketOutage(e))throw e;
          commandScope()?.trace('historical_demo.rest_without_price',{reason:e instanceof PrivateMarketDataError?e.code:(e as Error).name});
          return this.historicalDemoRest(actor,base,request,hash,prepared?.holdings);
        });
      }
      // A monotonic per-account sequence orders instructions journaled in the
      // same millisecond. A burst drained from the lane, or a clock that does
      // not advance, must never replay a reduce before the position it names.
      const seq=nextInstructionSeq(row.commands);
      let valuation!:CollateralValuation;
      let collateralReady=false;
      const prepareCollateral=async()=>{
        commandScope()?.trace('collateral');
        valuation=await this.collateral(actor,row,{reuse:true,holdings:prepared?.holdings});
        collateralReady=true;
      };
      // The instruction first: its row-based checks (a reduce order that
      // names a position that does not fit) refuse before any upstream read.
      commandScope()?.trace('instruction',{revision:row.revision});
      let instruction=await this.instruction(row,request,seq,prepareCollateral);
      let collateral:ExternalCollateral,commands:NativeInstruction[],result:Awaited<ReturnType<NativeDemoService['replay']>>;
      // THE DECISION IS TAKEN ON WHAT IS FRESH WHEN IT IS TAKEN. The execution
      // book is observed after wallet valuation; the replay/history pass
      // can still wait on a slow source. If the book has left the
      // freshness window by the time the command is about to commit, the
      // decision is made again ONCE on a fresh observation (a new
      // instruction, a new time); if that one has expired too, the command
      // is refused rather than committed on an old book. Replayed journal
      // entries keep their own event time: this check is for the live
      // decision only.
      for(let round=0;;round++){
        // ONE valuation per command, taken BEFORE the decision and journaled
        // with it: admission, the fill margin check, the liquidation verdict
        // and the account in the response all read this same figure.
        if(!collateralReady)await prepareCollateral();
        collateral=externalCollateral(valuation);
        if(instruction){
          instruction.collateral=collateral;instruction.recordedAt=this.now();
          if((instruction.kind==='OPEN'||instruction.kind==='CLOSE')&&instruction.book){
            instruction.context=await this.decisionMarks(row,instruction);
            instruction.at=this.now();
          }
        }
        if(this.expiredAtDecision(instruction)){
          if(round>=1)throw new PrivateMarketDataError('quote_stale');
          this.expiredDecisions+=1;collateralReady=false;instruction=await this.instruction(row,request,seq,prepareCollateral);continue;
        }
        // A shallow copy: the row is this command's own read and the replay
        // never mutates an instruction. Cloning the whole journal here was the
        // single largest share of a command's compute.
        commands=instruction?[...row.commands,instruction]:[...row.commands];
        if(!commands.length&&!options.persist)return this.authoritative(actor,this.view(row),row,valuation);
        // Backdated trades re-simulate the scenario from the beginning; everything else continues the
        // canonical checkpoint, so outcomes already shown are never recomputed away.
        const incremental=row.checkpoint&&(!instruction||instruction.at>=row.checkpoint.time)?row.checkpoint:null;
        commandScope()?.trace('replay');commandCheck();
        result=await this.replay(row,commands,incremental,collateral,instruction?.context);
        if(!this.expiredAtDecision(instruction))break;
        if(round>=1)throw new PrivateMarketDataError('quote_stale');
        this.expiredDecisions+=1;
        collateralReady=false;instruction=await this.instruction(row,request,seq,prepareCollateral);
      }
      let seqNext=instruction?seq+1:seq;
      const changed=!!instruction||!!result.observed||result.books.length>0||outcome(result.snapshot)!==outcome(row.snapshot);
      const stale=!row.checkpoint||this.now()-row.checkpoint.time>=NATIVE_REFRESH_PERSIST_MS;
      const executionPending=result.snapshot.orders.some(o=>!o.historical&&o.type==='LIMIT'&&(o.status==='OPEN'||o.status==='PARTIALLY_FILLED'))
        ||result.snapshot.positions.some(p=>!p.historical&&p.status==='OPEN');
      const sessionChanged=executionPending&&(!row.executionSession||row.executionSession.sessionId!==actor.sessionId||row.executionSession.expiresAt!==actor.expiresAt);
      const persist=request.kind!=='REFRESH'||options.persist||changed||stale||sessionChanged;
      if(result.observed||result.books.length||(persist&&result.projectionChanged)){
        // The marks and the collateral this pass decided on, journaled AHEAD
        // of the books it executed: a later replay values, triggers, admits
        // fills and runs the post-fill risk pass on exactly these, never on
        // whatever an older entry left in the state. Never undone by a
        // later replay.
        const marks=Object.fromEntries(Object.entries(result.latest).map(([symbol,q])=>[symbol,{mark:q.mark,last:q.last}]));
        const observedAt=Object.fromEntries(Object.entries(result.latest).map(([symbol,q])=>[symbol,q.time]));
        commands.push({id:`observe-${randomUUID()}`,kind:'OBSERVE',at:result.snapshot.time,seq:seqNext++,collateral,marks,observedAt});
      }
      // The books this pass executed — a fill, a partial fill, a cancellation without a fill: journaled so a later replay does exactly the same.
      for(const b of result.books)commands.push({id:`book-${randomUUID()}`,kind:'BOOK',at:b.at,seq:seqNext++,symbol:b.symbol,book:b.book});
      const next:NativeAccount={...row,commands,snapshot:result.snapshot,checkpoint:result.checkpoint};
      if(!persist){const unchanged={...next,revision:row.revision};return this.authoritative(actor,this.view(unchanged),unchanged,valuation);}
      // Seal only persisted live decisions AFTER OBSERVE/BOOK were appended.
      // Historical scenarios keep the minute checkpoint and OHLC replay.
      next.checkpoint=liveCheckpoint(next.snapshot,commands)??result.checkpoint;
      next.executionSession={...actor};
      next.executionPending=executionPending;
      commandCheck();commandScope()?.trace('commit',{revision:row.revision});
      const committed=await this.repository.commit(actor,row.revision,next,request.idempotencyKey,hash,()=>{commandCheck();if(this.expiredAtDecision(instruction))throw new PrivateMarketDataError('quote_stale');});
      return this.authoritative(actor,this.view(committed),committed,valuation);
    }
  }
  private async demoCurrentPrices(symbols:string[],required:ReadonlySet<string>=new Set(symbols),minRemainingMs=0):Promise<Map<string,PrivateMark>>{
    // Execution symbols lead the batch: when the frame has aged, the market's
    // on-demand reads run in this order, and a collateral asset must never
    // stand between the contract being traded and its price.
    const all=new Map<string,PrivateMark>(),wanted=[...new Set(symbols)].sort((a,b)=>Number(required.has(b))-Number(required.has(a))||a.localeCompare(b));
    for(let i=0;i<wanted.length;i+=64){
      const batch=wanted.slice(i,i+64);
      const prices=await commandRead('market.near_live_prices',()=>this.market.historicalDemoPrices(batch,commandSignal(),minRemainingMs));
      for(const symbol of batch){
        const quote=prices.get(symbol);if(!quote){if(required.has(symbol))throw new PrivateMarketDataError('near_live_price_unavailable');continue;}
        all.set(symbol,assertHistoricalDemoCurrentPrice(quote,symbol,this.now()));
      }
    }
    this.demoCommitHeadroom(all,minRemainingMs);
    return all;
  }
  private demoCommitHeadroom(prices:Map<string,PrivateMark>,minRemainingMs:number){
    const now=this.now();
    for(const q of prices.values())if([q.markProviderTimestamp,q.receivedAt,q.fetchedAt].some(t=>now-t>HISTORICAL_DEMO_CURRENT_MAX_AGE_MS-minRemainingMs))
      throw new PrivateMarketDataError('near_live_price_stale');
  }
  private demoCollateral(holdings:CollateralHolding[],prices:Map<string,PrivateMark>,row:NativeAccount){
    return valueCollateral(holdings,[...prices].map(([symbol,q])=>({asset:symbol.replace(/USDT$/,''),price:q.markPrice,source:'BYBIT_LINEAR_MARK',asOf:q.markProviderTimestamp})),
      'USDT',new Set(row.disabledCollateralAssets??[]));
  }
  /** Historical entry is an immutable selected price, then the account follows sampled current prices.
   * No historical OHLC catch-up, manufactured depth, live-book timeout exemption, or second math engine. */
  private async historicalDemoAttempt(actor:OwnerSession,row:NativeAccount,request:NativeCommand,hash:string,preparedHoldings?:CollateralHolding[],persist=false){
    if([...row.snapshot.positions.filter(p=>p.status==='OPEN'),...row.snapshot.orders.filter(o=>o.status==='OPEN'||o.status==='PARTIALLY_FILLED')]
      .some(p=>p.executionMode!=='HISTORICAL_DEMO'))throw new DemoEngineError('EXECUTION_MODE_MISMATCH');
    const holdings=preparedHoldings??await commandRead('repository.holdings',()=>this.repository.holdings(actor));
    const required=new Set(exposedSymbols(row.snapshot)),symbols=new Set(required);
    for(const h of holdings)if(h.asset!=='USDT'&&!row.disabledCollateralAssets?.includes(h.asset)&&new BigNumber(h.available).plus(h.locked??'0').gt(0))symbols.add(h.asset+'USDT');
    const seq=nextInstructionSeq(row.commands),id=`native-${randomUUID()}`;
    let draft:NativeInstruction|undefined;
    if(request.kind==='OPEN'){
      const symbol=request.symbol.replace(/[^A-Z0-9]/g,'');symbols.add(symbol);required.add(symbol);
      const target=request.reduceOnly?this.reduceTarget(row,{positionId:request.positionId!,symbol,side:request.side,quantity:request.quantity,marginType:request.marginType}):null;
      if(!target)this.admitNewRisk(row,symbol);
      if(!target&&request.type==='MARKET'&&!request.candle)throw new DemoEngineError('HISTORICAL_ENTRY_REQUIRED');
      const instrument=await commandRead('market.instrument',()=>this.market.instrument(symbol,commandSignal())),rules=contractRules(instrument),profile=simulationProfile(instrument);
      profile.riskModelVersion='NATIVE_MARGIN_V3:'+instrument.parameterVersion;
      const selected=request.candle&&!target?await commandRead('market.historical_entry',()=>this.market.resolveCandle({...request.candle!,symbol,signal:commandSignal()})):null;
      const sizePrice=selected?.price??request.price;
      const quantity=request.quantity??new BigNumber(request.margin!).times(request.leverage).div(sizePrice!).div(rules.qtyStep).integerValue(BigNumber.ROUND_FLOOR).times(rules.qtyStep).toFixed();
      // A SELECTED CANDLE IS THE EXECUTION. A new entry with a historical
      // candle is neither a market order against a book nor a limit order
      // waiting to be touched: it is a simulation entry, filled immediately
      // and in full at the selected historical price, whichever tab the
      // terminal submitted it from. The submitted limit price is not carried
      // onto the order — it used to leave a LONG whose limit sat below the
      // candle resting in the open orders instead of opening a position.
      // Without a candle (a reducing order, or a legacy resting LIMIT on a
      // historical account) the order keeps its own type and price.
      const point=selected?selected.price:undefined;
      draft={id,seq,kind:'OPEN',at:this.now(),executionMode:'HISTORICAL_DEMO',
        order:{id,symbol,side:request.side,type:selected?'MARKET':request.type,quantity,leverage:request.leverage,marginType:target?.marginType??request.marginType??'CROSS',
          historical:true,executionMode:'HISTORICAL_DEMO',...(selected?{entryTimestamp:selected.effectiveAt,historicalPrice:selected.price}:{}),
          ...(request.price&&!selected?{price:request.price}:{}),...(request.protection?{protection:request.protection}:{}),...(target?{reduceOnly:true,positionId:target.id}:{})},
        instrument:{rules,profile},mark:'',last:'',...(point!==undefined?{point}:{}),...(selected?{candle:request.candle}:{})};
    }else if(request.kind==='CLOSE'){
      const p=row.snapshot.positions.find(p=>p.id===request.positionId&&p.status==='OPEN');if(!p)throw new DemoEngineError('POSITION_NOT_OPEN');
      if(request.quantity&&new BigNumber(request.quantity).gt(p.quantity))throw new DemoEngineError('CLOSE_EXCEEDS_POSITION');
      if(request.quantity&&!new BigNumber(request.quantity).mod(row.snapshot.instruments[p.symbol].rules.qtyStep).isZero())throw new DemoEngineError('INVALID_QUANTITY_STEP');
      symbols.add(p.symbol);
      draft={id,seq,kind:'CLOSE',at:this.now(),executionMode:'HISTORICAL_DEMO',positionId:p.id,...(request.quantity?{quantity:request.quantity}:{}),price:''};
    }else if(request.kind==='CANCEL')draft={id,seq,kind:'CANCEL',at:this.now(),orderId:request.orderId};
    else if(request.kind==='PROTECTION')draft={id,seq,kind:'PROTECTION',at:this.now(),positionId:request.positionId,protection:request.protection};
    else if(request.kind==='LEVERAGE')draft={id,seq,kind:'LEVERAGE',at:this.now(),positionId:request.positionId,leverage:request.leverage};
    const prices=await this.demoCurrentPrices([...symbols],required,HISTORICAL_DEMO_COMMIT_HEADROOM_MS);
    const valuation=this.demoCollateral(holdings,prices,row),collateral=externalCollateral(valuation);
    // Preserve the engine's conservative collateral floor: unknown holdings
    // remain null/incomplete, cannot fund admission, and cannot trigger liquidation.
    const at=Math.max(this.now(),row.snapshot.time),marks=Object.fromEntries([...prices].filter(([s])=>symbols.has(s)).map(([s,q])=>[s,{mark:q.markPrice,last:q.lastPrice}]));
    const observedAt=Object.fromEntries([...prices].map(([s,q])=>[s,q.markProviderTimestamp]));
    if(draft){
      draft.at=at;draft.recordedAt=at;draft.executionMode='HISTORICAL_DEMO';draft.collateral=collateral;draft.context={marks,observedAt};
      if(draft.kind==='OPEN'){
        const q=prices.get(draft.order.symbol)!;draft.mark=q.markPrice;draft.last=q.lastPrice;
        if(draft.order.reduceOnly&&draft.order.type==='MARKET')draft.point=q.lastPrice;
      }else if(draft.kind==='CLOSE')draft.price=prices.get(row.snapshot.positions.find(p=>p.id===draft!.positionId)!.symbol)!.lastPrice;
    }
    const observation:NativeInstruction={id:`observe-${randomUUID()}`,seq:seq+(draft?1:0),at,recordedAt:at,kind:'OBSERVE',executionMode:'HISTORICAL_DEMO',marks,observedAt,collateral};
    const commands=[...row.commands,...(draft?[draft]:[]),observation];
    const guard=(stage:string)=>{
      const checkedAt=this.now();
      commandScope()?.trace('historical_demo.freshness',{stage,checkedAt,maxAgeMs:HISTORICAL_DEMO_CURRENT_MAX_AGE_MS,
        historicalEntryTimestamp:draft?.kind==='OPEN'?draft.order.entryTimestamp??null:null,
        inputs:[...prices].map(([symbol,q])=>({symbol,providerTimestamp:q.markProviderTimestamp,providerAgeMs:checkedAt-q.markProviderTimestamp,
          receivedAt:q.receivedAt,receivedAgeMs:checkedAt-q.receivedAt,fetchedAt:q.fetchedAt,fetchedAgeMs:checkedAt-q.fetchedAt}))});
      commandCheck();for(const [symbol,q]of prices)assertHistoricalDemoCurrentPrice(q,symbol,checkedAt);
    };
    guard('before_replay');
    let result:ReplayResult;
    try{result=await replayNativeDemoAsync({deposit:row.deposit,instructions:commands,asOf:at,checkpoint:row.checkpoint},r=>this.bars(r));}
    catch(e){
      if(!(e instanceof DemoEngineError&&e.code==='CHECKPOINT_MISMATCH'))throw e;
      const recovered=row.checkpoint&&recoverEmptyObservationCheckpoint(row.checkpoint,row.commands,row.snapshot);
      if(!recovered)throw e;
      result=await replayNativeDemoAsync({deposit:row.deposit,instructions:commands,asOf:at,checkpoint:recovered},r=>this.bars(r));
    }
    guard('after_replay');
    const next:NativeAccount={...row,executionMode:'HISTORICAL_DEMO',commands,snapshot:result.snapshot,checkpoint:result.checkpoint,
      executionSession:{...actor},executionPending:exposedSymbols(result.snapshot).size>0};
    // Flat polling changes no financial state and does not grow the journal.
    if(!draft&&!exposedSymbols(row.snapshot).size)return this.authoritative(actor,this.view({...next,revision:row.revision}),next,valuation);
    // A REFRESH that only moved the marks is ANSWERED, not journaled — the rule
    // the live path already had (NATIVE_REFRESH_PERSIST_MS). Journaling every
    // 10 s limit-pass observation grew an open account by 8 640 instructions a
    // day, each commit rewriting the whole journal into the account row and
    // an immutable revision, until commands timed out or met JOURNAL_LIMIT.
    // A fill, a trigger, a liquidation or a cancellation changes the outcome
    // and is journaled at once; otherwise one observation per 15 minutes is.
    if(!draft&&!persist){
      const stale=!row.checkpoint||at-row.checkpoint.time>=NATIVE_REFRESH_PERSIST_MS;
      const sessionChanged=!row.executionSession||row.executionSession.sessionId!==actor.sessionId||row.executionSession.expiresAt!==actor.expiresAt;
      if(!stale&&!sessionChanged&&outcome(result.snapshot)===outcome(row.snapshot))
        return this.authoritative(actor,this.view({...next,revision:row.revision}),next,valuation);
    }
    // Replay may consume the reserve. Refuse before starting any writes in that
    // case; never retry a financial command or bypass the final 60s rollback guard.
    this.demoCommitHeadroom(prices,HISTORICAL_DEMO_COMMIT_HEADROOM_MS);
    let checks=0;
    const committed=await this.repository.commit(actor,row.revision,next,request.idempotencyKey,hash,()=>guard(['pre_transaction','before_account_write','before_commit'][checks++]??'before_write'));
    return this.authoritative(actor,this.view(committed),committed,valuation);
  }
  /**
   * SUPERSEDED OBSERVATIONS LEAVE THE JOURNAL, AND ONLY IF NOTHING CHANGES.
   *
   * Until the rule above, every limit-pass REFRESH on an open historical
   * account appended an OBSERVE (8 640 a day). An OBSERVE that emitted no
   * event and is followed directly by another OBSERVE re-marking the same
   * contracts (and collateral) only set marks the next one overwrites, so the
   * account after the pair is the account after the second alone. Those are
   * dropped, the compacted journal is replayed IN FULL from the deposit, and
   * it is kept only if that replay reproduces the stored account exactly;
   * otherwise the row is used as it was. The row is not written here: the
   * command's own commit stores the shorter journal and its new checkpoint.
   */
  /** Journals whose compaction did not verify, by revision: not re-attempted until the account changes. */
  private compactionRefused=new Set<string>();
  private async compactHistoricalObservations(row:NativeAccount):Promise<NativeAccount>{
    const attempt=`${row.revision}:${row.commands.length}`;
    if(this.compactionRefused.has(attempt))return row;
    const drop=supersededObservations(row);
    if(drop.size<NATIVE_OBSERVE_COMPACT_MIN)return row;
    const commands=row.commands.filter(c=>!drop.has(c.id));
    // Its own budget and its own abort signal, never the command's: a slow
    // history read ends the compaction, not the command it runs in front of.
    const budgetMs=drop.size>=NATIVE_OBSERVE_COMPACT_LARGE_DROP_MIN?NATIVE_OBSERVE_COMPACT_LARGE_BUDGET_MS:NATIVE_OBSERVE_COMPACT_BUDGET_MS;
    const signal=AbortSignal.timeout(budgetMs),cache=nativeHistoryCache(this.market,this.now);
    try{
      commandScope()?.trace('historical_demo.compact',{before:row.commands.length,after:commands.length,budgetMs});
      const result=await replayNativeDemoAsync({deposit:row.deposit,instructions:commands,asOf:row.snapshot.time},r=>cache.load(r,signal));
      if(comparableState(result.snapshot)!==comparableState(row.snapshot))throw new Error('replay differs');
      return{...row,commands,checkpoint:result.checkpoint};
    }catch(e){
      console.warn('[native] observation compaction skipped',row.commands.length,commands.length,e instanceof Error?e.message:e);
      if(this.compactionRefused.size>1000)this.compactionRefused.clear();
      this.compactionRefused.add(attempt);
      return row;
    }
  }
  /**
   * THE ORDER IS ACCEPTED NOW; THE PRICE DECIDES THE FILL LATER. Only for what
   * `restsWithoutPrice` admits: a reduce-only LIMIT on a position the account
   * holds, or a CANCEL. No price is read, none is invented and nothing is
   * re-marked: the instruction carries no mark (''), no observation follows it,
   * so it cannot fill, trigger or value anything at an old price. Whether it
   * fills is decided by the next fresh OBSERVE (`applyHistoricalDemoPrices`,
   * from any REFRESH or the server's limit pass), at that observation's price.
   * The instrument is the one the position was opened with, already on the row.
   */
  private async historicalDemoRest(actor:OwnerSession,row:NativeAccount,request:NativeCommand,hash:string,preparedHoldings?:CollateralHolding[]){
    if([...row.snapshot.positions.filter(p=>p.status==='OPEN'),...row.snapshot.orders.filter(o=>o.status==='OPEN'||o.status==='PARTIALLY_FILLED')]
      .some(p=>p.executionMode!=='HISTORICAL_DEMO'))throw new DemoEngineError('EXECUTION_MODE_MISMATCH');
    const seq=nextInstructionSeq(row.commands),id=`native-${randomUUID()}`,at=Math.max(this.now(),row.snapshot.time);
    let draft:NativeInstruction;
    if(request.kind==='CANCEL')draft={id,seq,kind:'CANCEL',at,recordedAt:at,executionMode:'HISTORICAL_DEMO',orderId:request.orderId};
    else if(request.kind==='OPEN'){
      const symbol=request.symbol.replace(/[^A-Z0-9]/g,'');
      const target=this.reduceTarget(row,{positionId:request.positionId!,symbol,side:request.side,quantity:request.quantity,marginType:request.marginType});
      const known=row.snapshot.instruments[symbol];if(!known)throw new PrivateMarketDataError('near_live_price_unavailable');
      draft={id,seq,kind:'OPEN',at,recordedAt:at,executionMode:'HISTORICAL_DEMO',
        order:{id,symbol,side:request.side,type:'LIMIT',quantity:request.quantity!,leverage:request.leverage,marginType:target.marginType,
          historical:true,executionMode:'HISTORICAL_DEMO',price:request.price!,reduceOnly:true,positionId:target.id},
        instrument:known,mark:'',last:''};
    }else throw new DemoEngineError('INVALID_ORDER');
    const commands=[...row.commands,draft];
    let result:ReplayResult;
    try{result=await replayNativeDemoAsync({deposit:row.deposit,instructions:commands,asOf:at,checkpoint:row.checkpoint},r=>this.bars(r));}
    catch(e){
      if(!(e instanceof DemoEngineError&&e.code==='CHECKPOINT_MISMATCH'))throw e;
      const recovered=row.checkpoint&&recoverEmptyObservationCheckpoint(row.checkpoint,row.commands,row.snapshot);
      if(!recovered)throw e;
      result=await replayNativeDemoAsync({deposit:row.deposit,instructions:commands,asOf:at,checkpoint:recovered},r=>this.bars(r));
    }
    const next:NativeAccount={...row,executionMode:'HISTORICAL_DEMO',commands,snapshot:result.snapshot,checkpoint:result.checkpoint,
      executionSession:{...actor},executionPending:exposedSymbols(result.snapshot).size>0};
    const holdings=preparedHoldings??await commandRead('repository.holdings',()=>this.repository.holdings(actor));
    const committed=await this.repository.commit(actor,row.revision,next,request.idempotencyKey,hash,()=>commandCheck());
    // Collateral is valued on no price at all rather than an old one: unpriced
    // holdings stay unknown in this one response, as the engine already treats them.
    return this.authoritative(actor,this.view(committed),committed,this.demoCollateral(holdings,new Map(),committed));
  }
  private async replay(row:NativeAccount,commands:NativeInstruction[],checkpoint:NativeAccount['checkpoint']|null,collateral:ExternalCollateral,decision?:NativeInstruction['context']):Promise<ReplayResult&{projectionChanged:boolean;books:{symbol:string;book:NativeBook;at:number}[];latest:Record<string,{mark:string;last:string;time:number}>}>{
    const load=(r:BarRequest)=>this.bars(r),asOf=this.now();
    let result:ReplayResult;
    try{result=await replayNativeDemoAsync({deposit:row.deposit,instructions:commands,asOf,checkpoint},load);}
    catch(e){
      // A checkpoint that no longer matches (clock skew, legacy row) falls back to the full scenario.
      if(!(checkpoint&&e instanceof DemoEngineError&&e.code==='CHECKPOINT_MISMATCH'))throw e;
      const recovered=recoverEmptyObservationCheckpoint(checkpoint,row.commands,row.snapshot);
      commandScope()?.trace(recovered?'checkpoint.recovered_empty_observation':'checkpoint.full_replay');
      result=await replayNativeDemoAsync({deposit:row.deposit,instructions:commands,asOf,...(recovered?{checkpoint:recovered}:{})},load);
    }
    // Quotes are fetched only after the (possibly long) history pass, then checked for freshness again.
    const latest:Record<string,{mark:string;last:string;time:number}>={};
    // Resting LIVE limit orders need the market observed as much as positions
    // do: an account that holds only an open order has nothing else to value,
    // and whether that order fills is decided on an observed book, below.
    const resting=result.snapshot.orders.filter(o=>o.type==='LIMIT'&&!o.historical&&!!o.price&&(o.status==='OPEN'||o.status==='PARTIALLY_FILLED'));
    const symbols=[...new Set([...result.snapshot.positions.filter(p=>p.status==='OPEN').map(p=>p.symbol),...resting.map(o=>o.symbol)])].sort();
    // The contracts this command did not execute on need a mark, not a book: one read of the collector's
    // validated live frame serves them all. A contract the frame does not hold as current — or whose mark
    // would no longer pass the freshness check by the time it is applied — is quoted itself, below.
    const decisionFresh=(symbol:string)=>decision?.marks[symbol]&&this.now()-decision.observedAt[symbol]<=NATIVE_FRAME_MARK_MAX_AGE_MS;
    const frame=await this.frameMarks(symbols.filter(symbol=>!this.youngQuote(symbol)&&!decisionFresh(symbol)));
    const quoted:string[]=[];
    for(const symbol of symbols){
      const mark=frame.get(symbol);
      if(decisionFresh(symbol))latest[symbol]={...decision!.marks[symbol],time:decision!.observedAt[symbol]};
      else if(mark&&this.now()-mark.markProviderTimestamp<=NATIVE_FRAME_MARK_MAX_AGE_MS)latest[symbol]={mark:mark.markPrice,last:mark.lastPrice,time:mark.markProviderTimestamp};
      else quoted.push(symbol);
    }
    // Parallel batches keep every quote inside the freshness window without exceeding upstream concurrency;
    // a contract quoted within NATIVE_QUOTE_REUSE_MS (this command's own execution quote included) is not fetched again.
    for(let i=0;i<quoted.length;i+=NATIVE_QUOTE_BATCH){
      const quotes=await Promise.all(quoted.slice(i,i+NATIVE_QUOTE_BATCH).map(symbol=>this.valuationQuote(symbol)));
      for(const checked of quotes)latest[checked.symbol]={mark:checked.markPrice,last:checked.lastPrice,time:checked.markProviderTimestamp};
    }
    // WHAT THIS PASS NEEDS A BOOK FOR. A fresh last that crossed a resting
    // live limit order's price is the reason to LOOK at that contract's
    // book; so is a live position whose take-profit or stop-loss triggers at
    // these marks, and one still closing on a trigger from an earlier pass.
    // The book decides: the depth of the opposite side, at prices no worse
    // than a resting order's (its own price as maker) or at whatever levels
    // there are for a triggered close (as taker). The book is this
    // command's own checked observation (the executed contract's fresh
    // quote when it is the same contract), cut to what the working items
    // could take, executed after the marks and journaled as a BOOK
    // instruction whenever it changed anything — behind an OBSERVE that
    // carries the marks and the collateral it was decided on. The
    // consumption ledger is keyed by the provider snapshot, so a refresh
    // that meets the same snapshot again fills nothing more. Nothing here
    // waits on a bar.
    type Need={bids:{qty:BigNumber;limits:(string|null)[]};asks:{qty:BigNumber;limits:(string|null)[]}};
    const needs=new Map<string,Need>();
    const need=(symbol:string,side:'bids'|'asks',qty:string,limit:string|null)=>{
      const entry=needs.get(symbol)??{bids:{qty:new BigNumber(0),limits:[]},asks:{qty:new BigNumber(0),limits:[]}};
      entry[side].qty=entry[side].qty.plus(qty);entry[side].limits.push(limit);needs.set(symbol,entry);
    };
    for(const o of resting){
      const q=latest[o.symbol];if(!q)continue;
      if(o.side==='LONG'?new BigNumber(q.last).lte(o.price!):new BigNumber(q.last).gte(o.price!))need(o.symbol,o.side==='LONG'?'asks':'bids',o.remaining,o.price!);
    }
    for(const p of result.snapshot.positions.filter(p=>p.status==='OPEN'&&!p.historical)){
      const q=latest[p.symbol];if(!q)continue;
      const pending=p.pendingClose?BigNumber.minimum(p.pendingClose.quantity,p.quantity).toFixed():null;
      const triggered=p.pendingClose?null:protectionTrigger(p,q.mark,q.last);
      const quantity=pending??(triggered?(p.protection.quantity??p.quantity):null);
      if(quantity!==null)need(p.symbol,p.side==='LONG'?'bids':'asks',quantity,null);
    }
    const candidates:{symbol:string;book:NativeBook}[]=[];
    for(const symbol of [...needs.keys()].sort()){
      const q=await this.valuationQuote(symbol),entry=needs.get(symbol)!,book={bids:q.bids,asks:q.asks,timestamp:q.bookGeneratedAt};
      const bound=(limits:(string|null)[],pick:(...v:BigNumber[])=>BigNumber)=>limits.some(l=>l===null)?undefined:pick(...limits.map(l=>new BigNumber(l!))).toFixed();
      const asks=entry.asks.qty.gt(0)?truncateBook(book,'BUY',entry.asks.qty.toFixed(),bound(entry.asks.limits,BigNumber.maximum)).asks:[];
      const bids=entry.bids.qty.gt(0)?truncateBook(book,'SELL',entry.bids.qty.toFixed(),bound(entry.bids.limits,BigNumber.minimum)).bids:[];
      if(bids.length||asks.length)candidates.push({symbol,book:{bids,asks,timestamp:q.bookGeneratedAt}});
    }
    const at=Math.max(this.now(),result.snapshot.time);
    const projection=()=>JSON.stringify([result.snapshot.collateral,result.snapshot.marks,result.snapshot.positions.map(p=>[p.markPrice,p.lastPrice])]);
    const beforeProjection=projection();
    // The live risk pass values the account on THIS command's valuation and these marks; the books are executed after it.
    setDemoCollateral(result.snapshot,collateral);
    const observed=applyLatestQuotes(result.snapshot,latest,at);
    result.snapshot.time=at;
    const books:{symbol:string;book:NativeBook;at:number}[]=[];
    for(const c of candidates){
      // Even a no-fill observation may extend the snapshot identity ledger.
      // Persist that BOOK too; otherwise a conflicting reuse could be accepted after reload.
      const before=JSON.stringify(result.snapshot.bookConsumption);
      if(executeObservedBook(result.snapshot,c.symbol,c.book,at)>0||before!==JSON.stringify(result.snapshot.bookConsumption))books.push({...c,at});
    }
    return{...result,observed,books,latest,projectionChanged:beforeProjection!==projection()};
  }
  /** A live execution book that has left the freshness window by the time the command is about to commit. */
  private expiredAtDecision(instruction:NativeInstruction|undefined){
    if(!instruction||(instruction.kind!=='OPEN'&&instruction.kind!=='CLOSE')||!instruction.book)return false;
    return this.now()-instruction.book.timestamp>PRIVATE_QUOTE_MAX_AGE_MS
      ||Object.values(instruction.context?.observedAt??{}).some(at=>this.now()-at>PRIVATE_QUOTE_MAX_AGE_MS)
      ||(instruction.collateral?.asOf!=null&&this.now()-instruction.collateral.asOf>PRIVATE_QUOTE_MAX_AGE_MS);
  }
  private async decisionMarks(row:NativeAccount,instruction:Extract<NativeInstruction,{kind:'OPEN'|'CLOSE'}>):Promise<NonNullable<NativeInstruction['context']>>{
    const symbol=instruction.kind==='OPEN'?instruction.order.symbol:row.snapshot.positions.find(p=>p.id===instruction.positionId)!.symbol;
    const symbols=[...new Set([...exposedSymbols(row.snapshot),symbol])].sort();
    const frame=await this.frameMarks(symbols.filter(s=>!this.youngQuote(s)));
    const context:NonNullable<NativeInstruction['context']>={marks:{},observedAt:{}};
    for(let i=0;i<symbols.length;i+=NATIVE_QUOTE_BATCH){
      await Promise.all(symbols.slice(i,i+NATIVE_QUOTE_BATCH).map(async s=>{
        const mark=frame.get(s);
        if(mark&&this.now()-mark.markProviderTimestamp<=NATIVE_FRAME_MARK_MAX_AGE_MS){context.marks[s]={mark:mark.markPrice,last:mark.lastPrice};context.observedAt[s]=mark.markProviderTimestamp;}
        else{const q=await this.valuationQuote(s);context.marks[s]={mark:q.markPrice,last:q.lastPrice};context.observedAt[s]=q.markProviderTimestamp;}
      }));
    }
    return context;
  }
  private async instruction(row:NativeAccount,request:NativeCommand,seq:number,beforeLiveQuote?:()=>Promise<void>):Promise<NativeInstruction|undefined>{
    const id=`native-${randomUUID()}`;
    if(request.kind==='OPEN'){
      const symbol=request.symbol.replace(/[^A-Z0-9]/g,''),instrument=await commandRead('market.instrument',()=>this.market.instrument(symbol,commandSignal())),rules=contractRules(instrument),profile=simulationProfile(instrument);
      profile.riskModelVersion='NATIVE_MARGIN_V3:'+instrument.parameterVersion;
      profile.assumptions=['USDT-only demo, Cross or Isolated per order; gross hedge maintenance; not Bybit matching.','An isolated position is backed by its posted margin alone: its settlements are booked at their actual price and fee, and a loss beyond the post is a separate SHORTFALL line covered by the simulation insurance model, never by the shared wallet.','Custom demo funding -0.001 / +0.004 of position value per 8h UTC; not provider funding.','Historical assumed OHLC path, never a claim of actual past fills.'];
      const sizePrice=request.type==='LIMIT'?request.price:undefined;
      const size=(price:string)=>request.quantity??new BigNumber(request.margin!).times(request.leverage).div(price).div(rules.qtyStep).integerValue(BigNumber.ROUND_FLOOR).times(rules.qtyStep).toFixed();
      // The named position IS the identity of a reducing order. It is checked
      // here, against this account's own row, before any market data is
      // fetched: ownership (the row is the actor's), symbol, side and
      // remaining size all have to agree, and the risk bucket comes from the
      // position — a client cannot move a close into another bucket by
      // naming one, and the engine repeats every check on replay.
      const target=request.reduceOnly?this.reduceTarget(row,{positionId:request.positionId!,symbol,side:request.side,quantity:request.quantity,marginType:request.marginType}):null;
      if(!target)this.admitNewRisk(row,symbol);
      const marginType=target?target.marginType:request.marginType??'CROSS';
      const order=(quantity:string)=>({id,symbol,side:request.side,type:request.type,quantity,leverage:request.leverage,marginType,...(request.price?{price:request.price}:{}),...(request.protection?{protection:request.protection}:{}),
        // A reducing order keeps its type and its price; the engine checks
        // the side and the size against the named position itself.
        ...(target?{reduceOnly:true,positionId:target.id}:{}),historical:!!request.candle});
      if(request.candle){
        const selected=await commandRead('market.candle',()=>this.market.resolveCandle({...request.candle!,symbol,signal:commandSignal()})),candle=request.candle;
        if(request.type==='LIMIT'){
          // Owner rule on the SELECTED candle: Buy fills if Low <= limit, Sell if High >= limit.
          const touch=historicalLimitTouch(request.side,request.price!,selected.candle,selected.openTime,selected.intervalMs);
          const quantity=size(sizePrice!);
          if(touch){
            const mark=touch.at===selected.openTime?await this.markAt(symbol,touch.at,'START'):touch.price;
            return{id,seq,kind:'OPEN',at:touch.at,order:order(quantity),instrument:{rules,profile},mark,last:touch.price,point:touch.price,maker:touch.maker,candle:{...candle,pricePoint:'OPEN'}};
          }
          // Not reached inside the selected candle: the order rests from that candle's close.
          const at=selected.closeTime,mark=await this.markAt(symbol,at,'END');
          return{id,seq,kind:'OPEN',at,order:order(quantity),instrument:{rules,profile},mark,last:selected.candle.close,candle:{...candle,pricePoint:'CLOSE'}};
        }
        const at=selected.effectiveAt,mark=await this.markAt(symbol,at,request.candle.pricePoint==='OPEN'?'START':'END');
        return{id,seq,kind:'OPEN',at,order:order(size(selected.price)),instrument:{rules,profile},mark,last:selected.price,point:selected.price,candle};
      }
      // Keep the execution book's freshness window for replay and commit,
      // rather than spending it on unrelated collateral-provider waits.
      // Identity/admission checks above still precede these external reads.
      await beforeLiveQuote?.();
      const q=await this.quote(symbol,true);assertPrivateFreshQuote(q,symbol,this.now());
      const quantity=size(sizePrice??q.lastPrice);
      const book=truncateBook({bids:q.bids,asks:q.asks,timestamp:q.bookGeneratedAt},request.side==='LONG'?'BUY':'SELL',quantity,request.type==='LIMIT'?request.price:undefined);
      return{id,seq,kind:'OPEN',at:this.now(),order:order(quantity),instrument:{rules,profile},mark:q.markPrice,last:q.lastPrice,book};
    }
    if(request.kind==='CLOSE'){
      const p=row.snapshot.positions.find(p=>p.id===request.positionId&&p.status==='OPEN');if(!p)throw new DemoEngineError('POSITION_NOT_OPEN');
      if(request.quantity!==undefined&&new BigNumber(request.quantity).gt(p.quantity))throw new DemoEngineError('CLOSE_EXCEEDS_POSITION');
      if(request.candle){
        const c=await commandRead('market.candle',()=>this.market.resolveCandle({...request.candle!,symbol:p.symbol,signal:commandSignal()}));
        if(c.effectiveAt<=p.openedAt)throw new DemoEngineError('EXIT_BEFORE_ENTRY');
        return{id,seq,kind:'CLOSE',at:c.effectiveAt,positionId:p.id,...(request.quantity?{quantity:request.quantity}:{}),price:c.price,candle:request.candle};
      }
      await beforeLiveQuote?.();
      const q=await this.quote(p.symbol,true);assertPrivateFreshQuote(q,p.symbol,this.now());
      const book=truncateBook({bids:q.bids,asks:q.asks,timestamp:q.bookGeneratedAt},p.side==='LONG'?'SELL':'BUY',request.quantity??p.quantity);
      return{id,seq,kind:'CLOSE',at:this.now(),positionId:p.id,...(request.quantity?{quantity:request.quantity}:{}),price:p.side==='LONG'?q.bids[0].price:q.asks[0].price,book,mark:q.markPrice,last:q.lastPrice};
    }
    if(request.kind==='CANCEL')return{id,seq,kind:'CANCEL',at:this.now(),orderId:request.orderId};
    if(request.kind==='PROTECTION')return{id,seq,kind:'PROTECTION',at:this.now(),positionId:request.positionId,protection:request.protection};
    if(request.kind==='LEVERAGE')return{id,seq,kind:'LEVERAGE',at:this.now(),positionId:request.positionId,leverage:request.leverage};
    return undefined;
  }
  /**
   * The two admission caps, applied to NEW risk only (see `nativeAdmissionLimits`).
   * A reducing order, a close, a cancel or a refresh is never refused here.
   */
  private admitNewRisk(row:NativeAccount,symbol:string){
    const limits=nativeAdmissionLimits();
    const exposed=exposedSymbols(row.snapshot);
    if(!exposed.has(symbol)&&exposed.size>=limits.contracts)throw new DemoEngineError('CONTRACT_LIMIT');
    if(row.commands.length>=limits.commands)throw new DemoEngineError('COMMAND_LIMIT');
  }
  /**
   * The one open position a reducing order may touch, or a named refusal.
   * Quantity is never used to pick a position and no other candidate is
   * consulted: the ID is the identity, and it either fits or it does not.
   */
  private reduceTarget(row:NativeAccount,input:{positionId:string;symbol:string;side:'LONG'|'SHORT';quantity?:string;marginType?:DemoMarginType}){
    const p=row.snapshot.positions.find(p=>p.id===input.positionId&&p.status==='OPEN');
    if(!p)throw new DemoEngineError('POSITION_NOT_OPEN');
    if(p.symbol!==input.symbol)throw new DemoEngineError('INVALID_REDUCE_SYMBOL');
    if(p.side===input.side)throw new DemoEngineError('INVALID_REDUCE_SIDE');
    if(input.marginType!==undefined&&input.marginType!==p.marginType)throw new DemoEngineError('MARGIN_TYPE_MISMATCH');
    if(input.quantity!==undefined&&new BigNumber(input.quantity).gt(p.quantity))throw new DemoEngineError('CLOSE_EXCEEDS_POSITION');
    return p;
  }
  /** Card values come from ONE persisted revision; an open position is revalued and frozen first. */
  async card(actor:OwnerSession,positionId:string,revision?:number){
    let row=revision===undefined?await commandRead('repository.read',()=>this.repository.read(actor)):await this.repository.revision(actor,revision);if(!row)throw new DemoEngineError('ACCOUNT_MISSING');
    if(revision===undefined&&row.snapshot.positions.some(p=>p.id===positionId&&p.status==='OPEN')){
      await this.command(actor,{kind:'REFRESH',idempotencyKey:`card-${randomUUID()}`},{persist:true});
      row=await commandRead('repository.read',()=>this.repository.read(actor));if(!row)throw new DemoEngineError('ACCOUNT_MISSING');
    }
    const p=row.snapshot.positions.find(p=>p.id===positionId);if(!p)throw new DemoEngineError('POSITION_MISSING');const v=demoPositionView(row.snapshot,p);
    return{id:`native:${row.revision}:${p.id}`,symbol:p.symbol,side:p.side,leverage:p.leverage,mode:p.historical?'HISTORICAL_REPLAY':'DEMO_LIVE',status:p.status,
      netPnl:v.netPnl,unrealizedPnl:v.unrealizedPnl,pnl:p.status==='OPEN'?v.unrealizedPnl:v.netPnl,roiPercent:v.roiPercent,entryPrice:p.entryPrice,
      valuationPrice:p.status==='OPEN'?p.markPrice:(row.snapshot.events.filter(e=>e.positionId===p.id&&['CLOSE','TAKE_PROFIT','STOP_LOSS','LIQUIDATION'].includes(e.kind)).at(-1)?.price??null),
      usdPnl:null,asOf:new Date(row.snapshot.time).toISOString(),label:p.historical?'Historical Test':'Demo',revision:row.revision};
  }
}
