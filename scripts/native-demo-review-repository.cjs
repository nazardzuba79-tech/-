/** Isolated review persistence adapter. No Prisma client or production database. */
const {emptyDemoState,demoPositionView,migrateDemoState}=require('../dist/private-trading/native/engine');
const {commandHash}=require('../dist/private-trading/native/store');
const {deriveNativeLiveProjection}=require('../dist/private-trading/native/liveProjection');
const {historyQuery}=require('../dist/private-trading/native/historyPage');
const {PrivateTradingError}=require('../dist/private-trading/serviceTypes');
const {z}=require('zod');
const cursorSchema=z.object({revision:z.number().int(),kind:historyQuery.shape.kind,symbol:z.string(),time:z.number().finite(),ordinal:z.number().int().positive()});
/** Same keyset/cursor contract as PostgreSQL, over this fixture's immutable revision. */
function reviewHistoryPage(row,input,{positionViews=false}={}){
  const query=historyQuery.parse(input);
  if(!row||row.revision!==query.revision)throw new PrivateTradingError('history_revision_missing','Обновите историю',404);
  let cursor=null;
  try{if(query.cursor)cursor=cursorSchema.parse(JSON.parse(Buffer.from(query.cursor,'base64url').toString()));}
  catch{throw new PrivateTradingError('invalid_history_cursor','Обновите историю',400);}
  if(cursor&&(cursor.revision!==query.revision||cursor.kind!==query.kind||cursor.symbol!==(query.symbol??'')))throw new PrivateTradingError('invalid_history_cursor','Обновите историю',400);
  const values=query.kind==='entries'?row.commands:row.snapshot[query.kind];
  const entries=(values??[]).map((value,i)=>({value,ordinal:i+1,time:Number(query.kind==='positions'?(value.closedAt??value.openedAt):query.kind==='orders'?value.createdAt:query.kind==='entries'?value.at:value.time)}))
    .filter(({value})=>query.kind==='positions'?value.status!=='OPEN':query.kind==='orders'?!['OPEN','PARTIALLY_FILLED'].includes(value.status):query.kind==='entries'?value.kind==='OPEN':true)
    .filter(({value})=>!query.symbol||(query.kind==='entries'?value.order.symbol:value.symbol)===query.symbol)
    .filter(item=>!cursor||item.time<cursor.time||(item.time===cursor.time&&item.ordinal<cursor.ordinal))
    .sort((a,b)=>b.time-a.time||b.ordinal-a.ordinal);
  const page=entries.slice(0,query.limit),last=page.at(-1);
  const items=page.map(({value})=>{
    if(query.kind==='entries')return{positionId:value.order.id,candle:value.candle??null};
    if(query.kind!=='positions'||positionViews)return value;
    const state=migrateDemoState({...emptyDemoState('0',0),version:1,positions:[value]});return demoPositionView(state,state.positions[0]);
  });
  return structuredClone({revision:query.revision,kind:query.kind,items,nextCursor:entries.length>query.limit&&last?Buffer.from(JSON.stringify({revision:query.revision,kind:query.kind,symbol:query.symbol??'',time:last.time,ordinal:last.ordinal})).toString('base64url'):null});
}
class ReviewRepository{
  constructor({session,save,now,walletBtc}){this.session=session;this.save=save;this.now=now;this.walletBtc=walletBtc;}
  account(actor){const s=this.session(actor.sessionId);if(!s||s.userId!==actor.userId)throw new Error('Denied');return s;}
  async read(actor){return structuredClone(this.account(actor).row);}
  async live(actor){const row=this.account(actor).row;return row?deriveNativeLiveProjection(row):null;}
  async activate(actor){const s=this.account(actor);if(s.row){s.executionSession=structuredClone(actor);this.save(actor.sessionId,s);}}
  async history(actor,query){const s=this.account(actor);return reviewHistoryPage(s.revisions[query.revision],query);}
  async available(actor){return this.account(actor).row?'0':'10000000';}
  /** EVERY asset this preview session holds, exactly as the production repository
   *  reports the owner's DemoBalance rows — the settle row, which initialization
   *  DEBITS into the simulation ledger, plus a non-settle holding so the Cross
   *  collateral valuation is genuinely exercised here. Its price comes from the
   *  SAME market-data path the positions are priced on; nothing is valued by a
   *  number written into this file. */
  async holdings(actor){const s=this.account(actor);return[
    {asset:'USDT',available:s.row?'0':'10000000',locked:'0'},
    {asset:'BTC',available:this.walletBtc,locked:'0'},
  ];}
  async revision(actor,revision){return structuredClone(this.account(actor).revisions[revision]??null);}
  async prior(actor,key,hash){const entry=this.account(actor).commands[key];if(!entry)return null;if(entry.hash!==hash)throw new Error('IDEMPOTENCY_CONFLICT');return structuredClone(entry.row);}
  async initialize(actor,key){const s=this.account(actor);if(s.row)return structuredClone(s.row);const t=this.now(),row={revision:1,deposit:'10000000',commands:[],snapshot:emptyDemoState('10000000',t),createdAt:t,source:'PREVIEW_FIXTURE'};s.row=row;s.revisions[1]=row;s.commands[key]={hash:commandHash({kind:'INITIALIZE'}),row};this.save(actor.sessionId,s);return structuredClone(row);}
  async commit(actor,expected,next,key,hash){const s=this.account(actor),prior=await this.prior(actor,key,hash);if(prior)return prior;if(s.row?.revision!==expected)throw new Error('ACCOUNT_CHANGED');const row=structuredClone({...next,revision:expected+1});s.row=row;s.revisions[row.revision]=row;s.commands[key]={hash,row};this.save(actor.sessionId,s);return structuredClone(row);}
}

module.exports={ReviewRepository,reviewHistoryPage};
