import { randomUUID } from 'crypto';
import BigNumber from 'bignumber.js';
import { PrivateTradingMarketData, PrivateChartInterval, PrivateMark, PrivateMarketDataError, PRIVATE_QUOTE_MAX_AGE_MS, assertPrivateFreshQuote } from '../marketData';
import { OwnerSession, PrivateTradingError } from '../serviceTypes';
import { contractRules, simulationProfile } from '../service';
import { NativeAccount, NativeRepository, commandHash } from './store';
import { demoAccount, demoPositionView, DemoEngineError, DemoMarginType, DemoProtection, DemoState, ExternalCollateral, executeRestingDemoOrders, migrateDemoState, NATIVE_DEMO_MODEL, setDemoCollateral } from './engine';
import { valueCollateral, CollateralPrice, CollateralValuation } from './collateral';
import { crossAccount, CrossAccount } from './accountModel';
import { unifiedWalletRows, UnifiedWalletRow } from './walletRows';
import { accountLedger, AccountLedger } from './ledger';
import { applyLatestQuotes, BarRequest, exposedSymbols, historicalLimitTouch, nativeAdmissionLimits, NativeBook, NativeInstruction, nextInstructionSeq, ReplayBar, ReplayResult, replayNativeDemoAsync } from './replay';
import type { PrivateFreshQuote } from '../marketData';
export interface NativeCandle {source:'BYBIT_LINEAR';interval:PrivateChartInterval;openTime:number;pricePoint:'OPEN'|'CLOSE'}
export type NativeCommand = {idempotencyKey:string} & (
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
interface CommandLane{chain:Promise<unknown>;depth:number;/** The most recently queued plain REFRESH, while nothing was queued after it. */tailRefresh:Promise<unknown>|null}
/** The three fields of a valuation the engine acts on. */
export const externalCollateral=(v:CollateralValuation):ExternalCollateral=>({priced:v.priced,complete:v.complete,asOf:v.asOf});
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
  private lanes=new Map<string,CommandLane>();
  private quotes=new Map<string,{at:number;quote:PrivateFreshQuote}>();
  constructor(readonly repository:NativeRepository,private readonly market:PrivateTradingMarketData,private readonly now:()=>number=Date.now){}
  /** A reused snapshot that no longer passes the freshness check is replaced by a fresh fetch, not reported as stale. */
  private async valuationQuote(symbol:string):Promise<PrivateFreshQuote>{
    const cached=await this.quote(symbol);
    try{return assertPrivateFreshQuote(cached,symbol,this.now());}
    catch{const fresh=await this.quote(symbol,true);return assertPrivateFreshQuote(fresh,symbol,this.now());}
  }
  /**
   * Marks of the contracts an account holds but is NOT executing on, from the
   * collector's live frame in one call (`PrivateTradingMarketData.marks`).
   * A market source without the method (fixtures, older collectors) or a
   * failed call answers with no marks, and every contract is then quoted
   * itself as before; nothing stale is ever used in place of a quote.
   */
  private async frameMarks(symbols:string[]):Promise<Map<string,PrivateMark>>{
    if(!symbols.length||typeof this.market.marks!=='function')return new Map();
    try{return await this.market.marks(symbols);}catch{return new Map();}
  }
  private youngQuote(symbol:string){const c=this.quotes.get(symbol);return !!c&&this.now()-c.at<NATIVE_QUOTE_REUSE_MS;}
  /** A quote for valuation may be a recent one; a quote to execute on is always fetched now. */
  private async quote(symbol:string,fresh=false):Promise<PrivateFreshQuote>{
    const cached=this.quotes.get(symbol);
    if(!fresh&&cached&&this.now()-cached.at<NATIVE_QUOTE_REUSE_MS)return cached.quote;
    const quote=await this.market.freshQuote(symbol);
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
    const positions=row.snapshot.positions.map(p=>demoPositionView(row.snapshot,p));
    return{...empty,initialized:true,revision:row.revision,positions:positions.filter(p=>p.status==='OPEN'),history:positions.filter(p=>p.status!=='OPEN'),
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
  async collateral(actor:OwnerSession,options:{reuse?:boolean}={}):Promise<CollateralValuation>{
    const holdings=await this.repository.holdings(actor);
    const settle='USDT';
    const priced=holdings.filter(h=>h.asset!==settle);
    // One frame read for every asset that has no quote of this command's own; a mark is all a valuation needs.
    const frame=await this.frameMarks(priced.map(h=>`${h.asset}${settle}`).filter(symbol=>!(options.reuse&&this.youngQuote(symbol))));
    const priceOne=async(h:{asset:string},fresh:boolean):Promise<CollateralPrice>=>{
      try{
        const mark=fresh?undefined:frame.get(`${h.asset}${settle}`);
        if(mark&&this.now()-mark.markProviderTimestamp<=NATIVE_FRAME_MARK_MAX_AGE_MS)return{asset:h.asset,price:mark.markPrice,source:'BYBIT_LINEAR_MARK',asOf:mark.markProviderTimestamp};
        // Inside a command the valuation may share the command's own fresh
        // quotes (the same observation, once). A plain read always prices
        // the wallet now: a reader asking for the account gets the market
        // as it is, not a two-second-old snapshot. EITHER WAY the quote is
        // checked for freshness at the moment it is used — a snapshot that
        // was 4.5 s old when it was taken is 6 s old 1.5 s later, and the
        // service's own reuse window says nothing about the provider's
        // timestamp — and a quote that fails is fetched again, then
        // refused as unpriced rather than used. A new order is admitted
        // only on a valuation that passed this check; what the terminal
        // keeps on screen from an earlier reading is its own display.
        const symbol=`${h.asset}${settle}`;
        const quote=options.reuse&&!fresh?await this.valuationQuote(symbol):assertPrivateFreshQuote(await this.quote(symbol,true),symbol,this.now());
        // Mark, not last: the collateral is valued the way the positions
        // it backs are valued, so the two cannot drift apart.
        return{asset:h.asset,price:quote.markPrice,source:'BYBIT_LINEAR_MARK',asOf:quote.markProviderTimestamp??quote.fetchedAt};
      }catch{
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
    return valueCollateral(holdings,prices,settle);
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
    const valuation=valued??await this.collateral(actor);
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
    const row=await this.repository.read(actor);
    if(!row)return null;
    const view=await this.authoritative(actor,this.view(row),row);
    return{account:view.account as CrossAccount,ledger:view.ledger as AccountLedger};
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
  async wallet(actor:OwnerSession):Promise<{account:CrossAccount;ledger:AccountLedger;collateral:CollateralValuation;rows:UnifiedWalletRow[]}|null>{
    const row=await this.repository.read(actor);
    if(!row)return null;
    const valuation=await this.collateral(actor);
    const view=await this.authoritative(actor,this.view(row),row,valuation);
    const account=view.account as CrossAccount;
    // Projected from the account and the valuation above — the same two
    // objects, so a row can never disagree with the header it sits under.
    return{account,ledger:view.ledger as AccountLedger,collateral:valuation,rows:unifiedWalletRows(account,valuation)};
  }
  async state(actor:OwnerSession){
    const row=await this.repository.read(actor);
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
  async contract(actor:OwnerSession,symbol:string){
    void actor;
    const instrument=await this.market.instrument(symbol);
    return{...contractRules(instrument),riskTiers:simulationProfile(instrument).riskTiers,
      takerFeeRate:simulationProfile(instrument).takerFeeRate,makerFeeRate:simulationProfile(instrument).makerFeeRate};
  }
  async initialize(actor:OwnerSession,key:string){const row=await this.repository.initialize(actor,key);return this.authoritative(actor,this.view(row),row);}
  private async bars(request:BarRequest):Promise<ReplayBar[]>{
    const history=await this.market.history({symbol:request.symbol,startTime:request.start,endTime:request.end,intervalMinutes:(request.intervalMs/MINUTE) as 1|15|60,omitProviderFunding:true});
    if(!history.complete)throw new DemoEngineError('HISTORY_GAP');
    const marks=new Map(history.markCandles.map(c=>[c.timestamp,c]));
    return history.tradeCandles.map(c=>{const mark=marks.get(c.timestamp);if(!mark)throw new DemoEngineError('MARK_HISTORY_GAP');return{time:c.timestamp,intervalMs:request.intervalMs,trade:c,mark};});
  }
  /** Mark price at a minute boundary: the open of the minute starting there, or the close of the minute ending there. */
  private async markAt(symbol:string,time:number,edge:'START'|'END'):Promise<string>{
    if(time%MINUTE!==0)throw new DemoEngineError('ENTRY_MARK_UNAVAILABLE');
    const start=edge==='START'?time:time-MINUTE,bars=await this.bars({symbol,start,end:start+MINUTE,intervalMs:MINUTE});
    const bar=bars.find(b=>b.time===start);if(!bar)throw new DemoEngineError('ENTRY_MARK_UNAVAILABLE');
    return edge==='START'?bar.mark.open:bar.mark.close;
  }
  command(actor:OwnerSession,request:NativeCommand,options:{persist?:boolean}={}){
    // The lane is entered SYNCHRONOUSLY, so arrival order is call order and
    // not the order in which two idempotency lookups happened to return.
    return this.serialized(actor.userId,request,options,()=>this.execute(actor,request,commandHash(request),options));
  }
  /** How many commands this account has running or waiting right now. */
  queued(userId:string){return this.lanes.get(userId)?.depth??0;}
  private serialized<T>(userId:string,request:NativeCommand,options:{persist?:boolean},task:()=>Promise<T>):Promise<T>{
    const lane=this.lanes.get(userId)??{chain:Promise.resolve(),depth:0,tailRefresh:null};
    const plainRefresh=request.kind==='REFRESH'&&!options.persist;
    // A refresh queued behind a refresh would read the same state twice.
    // Only the TAIL is shared: a refresh queued after a CLOSE must observe it.
    if(plainRefresh&&lane.tailRefresh)return lane.tailRefresh as Promise<T>;
    if(lane.depth>=NATIVE_COMMAND_QUEUE_LIMIT)return Promise.reject(new PrivateTradingError('native_queue_full','Слишком много операций в очереди. Повторите через секунду',429));
    lane.depth+=1;this.lanes.set(userId,lane);
    const run=lane.chain.then(task,task);
    lane.chain=run.catch(()=>undefined);
    lane.tailRefresh=plainRefresh?run:null;
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
        this.conflicts+=1;
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
      const prior=await this.repository.prior(actor,request.idempotencyKey,hash);if(prior)return this.authoritative(actor,this.view(prior),prior);
      const row=await this.repository.read(actor);if(!row)throw new PrivateTradingError('initialize_demo','Сначала подключите демо-баланс',409);
      // A monotonic per-account sequence orders instructions journaled in the
      // same millisecond. A burst drained from the lane, or a clock that does
      // not advance, must never replay a reduce before the position it names.
      const seq=nextInstructionSeq(row.commands);
      // The instruction first: its row-based checks (a reduce order that
      // names a position that does not fit) refuse before any upstream read.
      let instruction=await this.instruction(row,request,seq);
      let valuation:CollateralValuation,collateral:ExternalCollateral,commands:NativeInstruction[],result:Awaited<ReturnType<NativeDemoService['replay']>>;
      // THE DECISION IS TAKEN ON WHAT IS FRESH WHEN IT IS TAKEN. The execution
      // book was observed before the wallet valuation and the history pass,
      // either of which can wait on a slow source. If the book has left the
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
        valuation=await this.collateral(actor,{reuse:true});collateral=externalCollateral(valuation);
        if(instruction)instruction.collateral=collateral;
        // A shallow copy: the row is this command's own read and the replay
        // never mutates an instruction. Cloning the whole journal here was the
        // single largest share of a command's compute.
        commands=instruction?[...row.commands,instruction]:[...row.commands];
        if(!commands.length&&!options.persist)return this.authoritative(actor,this.view(row),row,valuation);
        // Backdated trades re-simulate the scenario from the beginning; everything else continues the
        // canonical checkpoint, so outcomes already shown are never recomputed away.
        const incremental=row.checkpoint&&(!instruction||instruction.at>=row.checkpoint.time)?row.checkpoint:null;
        result=await this.replay(row,commands,incremental,collateral);
        if(!this.expiredAtDecision(instruction))break;
        if(round>=1)throw new PrivateMarketDataError('quote_stale');
        this.expiredDecisions+=1;
        instruction=await this.instruction(row,request,seq);
      }
      let seqNext=instruction?seq+1:seq;
      if(result.observed){
        // Same effect as the quotes just applied to the projected snapshot; never undone by a later replay.
        commands.push({id:`observe-${randomUUID()}`,kind:'OBSERVE',at:result.snapshot.time,seq:seqNext++,collateral,marks:result.observed});
      }
      // The books that filled resting live orders: journaled so a later replay fills exactly the same.
      for(const b of result.books)commands.push({id:`book-${randomUUID()}`,kind:'BOOK',at:b.at,seq:seqNext++,symbol:b.symbol,book:b.book});
      const next:NativeAccount={...row,commands,snapshot:result.snapshot,checkpoint:result.checkpoint};
      const changed=!!instruction||!!result.observed||outcome(result.snapshot)!==outcome(row.snapshot);
      const stale=!row.checkpoint||result.checkpoint.time-row.checkpoint.time>=NATIVE_REFRESH_PERSIST_MS;
      if(request.kind==='REFRESH'&&!options.persist&&!changed&&!stale){const unchanged={...next,revision:row.revision};return this.authoritative(actor,this.view(unchanged),unchanged,valuation);}
      const committed=await this.repository.commit(actor,row.revision,next,request.idempotencyKey,hash);
      return this.authoritative(actor,this.view(committed),committed,valuation);
    }
  }
  private async replay(row:NativeAccount,commands:NativeInstruction[],checkpoint:NativeAccount['checkpoint']|null,collateral:ExternalCollateral):Promise<ReplayResult&{books:{symbol:string;book:NativeBook;at:number}[]}>{
    const load=(r:BarRequest)=>this.bars(r),asOf=this.now();
    let result:ReplayResult;
    try{result=await replayNativeDemoAsync({deposit:row.deposit,instructions:commands,asOf,checkpoint},load);}
    catch(e){
      // A checkpoint that no longer matches (clock skew, legacy row) falls back to the full scenario.
      if(!(checkpoint&&e instanceof DemoEngineError&&e.code==='CHECKPOINT_MISMATCH'))throw e;
      result=await replayNativeDemoAsync({deposit:row.deposit,instructions:commands,asOf},load);
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
    const frame=await this.frameMarks(symbols.filter(symbol=>!this.youngQuote(symbol)));
    const quoted:string[]=[];
    for(const symbol of symbols){
      const mark=frame.get(symbol);
      if(mark&&this.now()-mark.markProviderTimestamp<=NATIVE_FRAME_MARK_MAX_AGE_MS)latest[symbol]={mark:mark.markPrice,last:mark.lastPrice,time:mark.markProviderTimestamp};
      else quoted.push(symbol);
    }
    // Parallel batches keep every quote inside the freshness window without exceeding upstream concurrency;
    // a contract quoted within NATIVE_QUOTE_REUSE_MS (this command's own execution quote included) is not fetched again.
    for(let i=0;i<quoted.length;i+=NATIVE_QUOTE_BATCH){
      const quotes=await Promise.all(quoted.slice(i,i+NATIVE_QUOTE_BATCH).map(symbol=>this.valuationQuote(symbol)));
      for(const checked of quotes)latest[checked.symbol]={mark:checked.markPrice,last:checked.lastPrice,time:checked.markProviderTimestamp};
    }
    // A RESTING LIVE LIMIT ORDER FILLS ON AN OBSERVED BOOK, INSIDE THE MINUTE.
    // The fresh last crossing the order's price is the reason to LOOK; the
    // book is what decides: the opposite side's depth at prices no worse
    // than the order's, for as much as it has, at the order's own price as
    // maker. The book is this command's own checked observation (the
    // executed contract's fresh quote when it is the same contract), cut to
    // what the resting orders could take, and journaled as a BOOK
    // instruction only if it filled something. The consumption ledger is
    // keyed by the provider snapshot, so a refresh that meets the same
    // snapshot again fills nothing more. Nothing here waits on a bar.
    const crossed=new Set<string>();
    for(const o of resting){const q=latest[o.symbol];if(q&&(o.side==='LONG'?new BigNumber(q.last).lte(o.price!):new BigNumber(q.last).gte(o.price!)))crossed.add(o.symbol);}
    const candidates:{symbol:string;book:NativeBook}[]=[];
    for(const symbol of [...crossed].sort()){
      const q=await this.valuationQuote(symbol);
      const longs=resting.filter(o=>o.symbol===symbol&&o.side==='LONG'),shorts=resting.filter(o=>o.symbol===symbol&&o.side==='SHORT');
      const sum=(os:typeof resting)=>os.reduce((v,o)=>v.plus(o.remaining),new BigNumber(0)).toFixed();
      const asks=longs.length?truncateBook({bids:q.bids,asks:q.asks,timestamp:q.bookGeneratedAt},'BUY',sum(longs),BigNumber.maximum(...longs.map(o=>o.price!)).toFixed()).asks:[];
      const bids=shorts.length?truncateBook({bids:q.bids,asks:q.asks,timestamp:q.bookGeneratedAt},'SELL',sum(shorts),BigNumber.minimum(...shorts.map(o=>o.price!)).toFixed()).bids:[];
      candidates.push({symbol,book:{bids,asks,timestamp:q.bookGeneratedAt}});
    }
    const at=Math.max(this.now(),result.snapshot.time);
    // The live risk pass values the account on THIS command's valuation.
    setDemoCollateral(result.snapshot,collateral);
    const observed=applyLatestQuotes(result.snapshot,latest,at);
    const books:{symbol:string;book:NativeBook;at:number}[]=[];
    for(const c of candidates)if(executeRestingDemoOrders(result.snapshot,c.symbol,c.book,at)>0)books.push({...c,at});
    return{...result,observed,books};
  }
  /** A live execution book that has left the freshness window by the time the command is about to commit. */
  private expiredAtDecision(instruction:NativeInstruction|undefined){
    if(!instruction||(instruction.kind!=='OPEN'&&instruction.kind!=='CLOSE')||!instruction.book)return false;
    return this.now()-instruction.book.timestamp>PRIVATE_QUOTE_MAX_AGE_MS;
  }
  private async instruction(row:NativeAccount,request:NativeCommand,seq:number):Promise<NativeInstruction|undefined>{
    const id=`native-${randomUUID()}`;
    if(request.kind==='OPEN'){
      const symbol=request.symbol.replace(/[^A-Z0-9]/g,''),instrument=await this.market.instrument(symbol),rules=contractRules(instrument),profile=simulationProfile(instrument);
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
        const selected=await this.market.resolveCandle({...request.candle,symbol}),candle=request.candle;
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
      const q=await this.quote(symbol,true);assertPrivateFreshQuote(q,symbol,this.now());
      const quantity=size(sizePrice??q.lastPrice);
      const book=truncateBook({bids:q.bids,asks:q.asks,timestamp:q.bookGeneratedAt},request.side==='LONG'?'BUY':'SELL',quantity,request.type==='LIMIT'?request.price:undefined);
      return{id,seq,kind:'OPEN',at:this.now(),order:order(quantity),instrument:{rules,profile},mark:q.markPrice,last:q.lastPrice,book};
    }
    if(request.kind==='CLOSE'){
      const p=row.snapshot.positions.find(p=>p.id===request.positionId&&p.status==='OPEN');if(!p)throw new DemoEngineError('POSITION_NOT_OPEN');
      if(request.quantity!==undefined&&new BigNumber(request.quantity).gt(p.quantity))throw new DemoEngineError('CLOSE_EXCEEDS_POSITION');
      if(request.candle){
        const c=await this.market.resolveCandle({...request.candle,symbol:p.symbol});
        if(c.effectiveAt<=p.openedAt)throw new DemoEngineError('EXIT_BEFORE_ENTRY');
        return{id,seq,kind:'CLOSE',at:c.effectiveAt,positionId:p.id,...(request.quantity?{quantity:request.quantity}:{}),price:c.price,candle:request.candle};
      }
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
    let row=revision===undefined?await this.repository.read(actor):await this.repository.revision(actor,revision);if(!row)throw new DemoEngineError('ACCOUNT_MISSING');
    if(revision===undefined&&row.snapshot.positions.some(p=>p.id===positionId&&p.status==='OPEN')){
      await this.command(actor,{kind:'REFRESH',idempotencyKey:`card-${randomUUID()}`},{persist:true});
      row=await this.repository.read(actor);if(!row)throw new DemoEngineError('ACCOUNT_MISSING');
    }
    const p=row.snapshot.positions.find(p=>p.id===positionId);if(!p)throw new DemoEngineError('POSITION_MISSING');const v=demoPositionView(row.snapshot,p);
    return{id:`native:${row.revision}:${p.id}`,symbol:p.symbol,side:p.side,leverage:p.leverage,mode:p.historical?'HISTORICAL_REPLAY':'DEMO_LIVE',status:p.status,
      netPnl:v.netPnl,unrealizedPnl:v.unrealizedPnl,pnl:p.status==='OPEN'?v.unrealizedPnl:v.netPnl,roiPercent:v.roiPercent,entryPrice:p.entryPrice,
      valuationPrice:p.status==='OPEN'?p.markPrice:(row.snapshot.events.filter(e=>e.positionId===p.id&&['CLOSE','TAKE_PROFIT','STOP_LOSS','LIQUIDATION'].includes(e.kind)).at(-1)?.price??null),
      usdPnl:null,asOf:new Date(row.snapshot.time).toISOString(),label:p.historical?'Historical Test':'Demo',revision:row.revision};
  }
}
