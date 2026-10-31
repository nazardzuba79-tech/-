/** Private/offline modeled review, never a published listing or future-apply proposal. */
import { parseListingConfig, listingSimulationConfig, type ListingConfig } from './listingConfig';
import { TestMarketSimulation, aggregateCandles, SIM_INTERVALS, type SimCandle } from '../testMarkets/testMarketSimulation';
import { buildQvtrProgram, QVTR_PEAK_AT } from './qvtrIsolatedCandidate';
import { aggregateIsolatedMinutes, scenarioSourceFingerprint, type ScenarioPrincipal } from './isolatedScenarioJournal';

export interface QvtrObservation {
  serverTime: number; lastPrice: number; listingId: string; version: number;
  source: 'simulation'; isTradable: false;
}
export interface QvtrNowReview {
  scope: 'OBSERVED_NOW_REVIEW_ONLY'; promotionAllowed: false;
  startAt: number; admittedAt: number; author: string; observation: QvtrObservation;
  sourceConfig: ListingConfig; sourceConfigSha256: string;
  candidate: ReturnType<typeof buildQvtrProgram>;
}
export function admitQvtrNowReview(source: ListingConfig, observation: QvtrObservation, principal: ScenarioPrincipal, now: number): QvtrNowReview {
  if(principal.role!=='ADMIN'||!principal.id.trim())throw Error('ADMIN_REQUIRED');
  if(!Number.isSafeInteger(now)||Math.max(now,observation.serverTime)>=QVTR_PEAK_AT)throw Error('TARGET_EXPIRED');
  if(observation.source!=='simulation'||observation.isTradable!==false||observation.listingId!=='qvtr-19568743'||observation.version!==1
      ||!Number.isSafeInteger(observation.serverTime)||observation.serverTime-now>2000||now-observation.serverTime>5000)throw Error('FRESH_OBSERVATION_REQUIRED');
  const canonical=parseListingConfig(JSON.parse(JSON.stringify(source)));
  const actual=new TestMarketSimulation(listingSimulationConfig(canonical));
  if(actual.priceAt(observation.serverTime)!==observation.lastPrice)throw Error('OBSERVATION_CHANGED_RETRY');
  // Source time is authoritative for this quote; retain local receipt time
  // separately and bound clock skew. Never invent a later scheduled start.
  const candidate=buildQvtrProgram(canonical,observation.serverTime);
  if(candidate.anchor!==observation.lastPrice)throw Error('ANCHOR_MISMATCH');
  return {scope:'OBSERVED_NOW_REVIEW_ONLY',promotionAllowed:false,startAt:observation.serverTime,admittedAt:now,author:principal.id,
    observation:JSON.parse(JSON.stringify(observation)),sourceConfig:canonical,sourceConfigSha256:scenarioSourceFingerprint(canonical),candidate};
}
export function reviewQvtrNow(record: QvtrNowReview, now: number, from: number, interval: '1m'|'5m'|'15m'|'1h') {
  if(record.scope!=='OBSERVED_NOW_REVIEW_ONLY'||record.promotionAllowed!==false||record.startAt!==record.observation.serverTime)throw Error('REVIEW_NOT_PROMOTABLE');
  const replay=admitQvtrNowReview(record.sourceConfig,record.observation,{id:record.author,role:'ADMIN'},record.admittedAt);
  if(record.sourceConfigSha256!==replay.sourceConfigSha256||JSON.stringify(record.candidate)!==JSON.stringify(replay.candidate))throw Error('REVIEW_TAMPERED');
  if(!Number.isSafeInteger(now)||!Number.isSafeInteger(from)||from>now||now-from>32*86400000||!['1m','5m','15m','1h'].includes(interval))throw Error('INVALID_PREVIEW_WINDOW');
  const base=new TestMarketSimulation(listingSimulationConfig(record.sourceConfig));
  const intervalMs=SIM_INTERVALS[interval],first=Math.max(base.asset.listingAt,Math.floor(from/intervalMs)*intervalMs);
  const original=(at:number)=>interval==='1m'?base.candles1m(at,first):aggregateCandles(base.candles5m(at,first),intervalMs);
  if(now<=record.startAt)return {source:record.scope,promotionAllowed:false,candles:original(now)};
  const boundary=Math.floor(record.startAt/60000)*60000;
  const proposed=new TestMarketSimulation(listingSimulationConfig({...record.sourceConfig,simulationProgram:record.candidate.program}));
  const old=first<boundary?base.candles1m(boundary,first).filter(c=>c.openTime<boundary):[];
  const next=proposed.candles1m(now,Math.max(first,boundary));
  if(first<=boundary){
    const hour=Math.floor((boundary-base.asset.listingAt)/3600000),offset=(boundary-base.asset.listingAt-hour*3600000)/10000;
    const a=base.hourPlan(hour).cycleTicks,b=proposed.hourPlan(hour).cycleTicks;
    if(!a||!b)throw Error('CANONICAL_TICKS_REQUIRED');
    const ticks=Array.from({length:Math.min(6,Math.floor((now-boundary)/10000))},(_,i)=>boundary+(i+1)*10000<=record.startAt?a[offset+i]:b[offset+i]);
    const open=base.priceAt(boundary)!;let high=open,low=open,volume=0,quoteVolume=0;
    for(const t of ticks){high=Math.max(high,t.high);low=Math.min(low,t.low);volume+=t.volume;quoteVolume+=t.quoteVolume;}
    const format=(n:number)=>Math.min(.88858,Number(n.toFixed(10)));
    const mixed:SimCandle={openTime:boundary,open,high:format(high),low:format(low),close:format(ticks.length?ticks[ticks.length-1].price:open),volume:Number(volume.toFixed(4)),quoteVolume:Number(quoteVolume.toFixed(2))};
    next[0]=mixed;
  }
  const untouched=new Map(original(record.startAt).filter(c=>c.openTime+intervalMs<=record.startAt).map(c=>[c.openTime,c]));
  return {source:record.scope,promotionAllowed:false,candles:aggregateIsolatedMinutes([...old,...next],intervalMs).map(c=>untouched.get(c.openTime)??c)};
}
