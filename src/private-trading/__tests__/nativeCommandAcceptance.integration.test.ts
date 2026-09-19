/** HTTP routes + market adapter + Prisma/CAS/reload on disposable loopback PostgreSQL. */
import express from 'express';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
import BigNumber from 'bignumber.js';
import { NativeDemoService, NativeCommand } from '../native/service';
import { nativeDemoRoutes } from '../native/routes';
import { PrismaNativeRepository } from '../native/store';
import { PrivateTradingMarketData } from '../marketData';
import { PrivateTradingError } from '../serviceTypes';
import { instrument } from '../native/testing/liveFixture';

const enabled=process.env.PRIVATE_TRADING_DB_TESTS==='1';
if(enabled&&!['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL??'http://invalid').hostname))throw Error('Disposable loopback DB required');
const suite=enabled?describe:describe.skip;
const n=(v:string|number)=>new BigNumber(v),rate='0.00055';
const report:{test:string;input:unknown;server:unknown;expected:unknown;status:string;ms:number}[]=[];
suite('native HTTP acceptance with independent fill arithmetic',()=>{
  let db:PrismaClient;
  beforeAll(()=>{db=new PrismaClient();jest.spyOn(console,'info').mockImplementation(()=>{});});
  afterAll(async()=>{await db?.$disconnect();jest.restoreAllMocks();if(process.env.NATIVE_ACCEPTANCE_REPORT)writeFileSync(process.env.NATIVE_ACCEPTANCE_REPORT,JSON.stringify(report,null,2));});
  test('hybrid HTTP LONG and SHORT: historical source, current mark/exit, persisted reload, exact reconciliation',async()=>{
    const user=await db.user.create({data:{email:`hybrid-${randomUUID()}@example.test`,passwordHash:'NO_LOGIN',role:'ADMIN',referralCode:randomUUID()}});
    const session=await db.session.create({data:{userId:user.id}}),actor={userId:user.id,sessionId:session.id,expiresAt:Date.now()+3600000};
    await db.demoBalance.create({data:{userId:user.id,asset:'USDT',available:'1000'}});
    const repo=new PrismaNativeRepository(db,()=>({enabled:true,ownerId:user.id}));
    let entry='60000',current='81000',bookCalls=0;
    const selected=Math.floor(Date.now()/3600000)*3600000-86400000;
    const market=new PrivateTradingMarketData({collector:{url:'http://127.0.0.1',token:'LOCAL_FIXTURE_ONLY'},request:(async(url)=>{
      const u=new URL(String(url)),symbol=u.pathname.split('/').at(-1)!,t=Date.now();let data:unknown;
      if(u.pathname.includes('/instruments/'))data={...instrument(symbol),fetchedAt:t};
      else if(u.pathname.endsWith('/marks'))data={status:'live',fetchedAt:t,marks:u.searchParams.get('symbols')!.split(',').map(symbol=>({symbol,markPrice:current,lastPrice:current,markProviderTimestamp:t-15000,receivedAt:t-15000,fetchedAt:t}))};
      else if(u.pathname.includes('/chart-candles/'))data={source:'BYBIT_LINEAR',symbol:'BTCUSDT',interval:'1h',fetchedAt:t,providerTimestamp:t,candles:[{timestamp:selected,open:entry,high:entry,low:entry,close:entry,volume:'10'}]};
      else {if(u.pathname.includes('/quote/'))bookCalls++;throw Error('Unexpected source '+u.pathname);}
      return new Response(JSON.stringify(data),{status:200});
    }) as typeof fetch});
    const app=express();app.use(express.json());
    app.use('/native',(req,res,next)=>nativeDemoRoutes(new NativeDemoService(repo,market),()=>actor)(req,res,next));
    app.use((e:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(e.status??500).json({error:e.message,code:e.code}));
    await new NativeDemoService(repo,market).initialize(actor,randomUUID());
    let wallet=n(1000);
    for(const side of ['LONG','SHORT'] as const){
      entry='60000';current='81000';
      const input={kind:'OPEN',symbol:'BTCUSDT',side,type:'MARKET',quantity:'0.001',leverage:'10',marginType:'CROSS',...(side==='SHORT'?{executionMode:'HISTORICAL_DEMO'}:{}),
        candle:{source:'BYBIT_LINEAR',interval:'1h',openTime:selected,pricePoint:'OPEN'},idempotencyKey:randomUUID()};
      const opened=await request(app).post('/native/commands').send(input);
      expect({status:opened.status,error:opened.body.error}).toEqual({status:200,error:undefined});
      const p=opened.body.positions[0],fee=n(entry).times('.001').times(rate);
      expect(p.entryPrice).toBe(entry);expect(p.openedAt).toBe(selected);expect(p.markPrice).toBe(current);
      expect(p.unrealizedPnl).toBe(n(current).minus(entry).times('.001').times(side==='LONG'?1:-1).toFixed());
      wallet=wallet.minus(fee);expect(opened.body.account.settleBalance).toBe(wallet.toFixed());
      const duplicate=await request(app).post('/native/commands').send(input);
      expect(duplicate.status).toBe(200);expect(duplicate.body.revision).toBe(opened.body.revision);
      const reload=await request(app).get('/native/state');expect(reload.body.positions[0].entryPrice).toBe(entry);
      current='81500';const marked=await request(app).post('/native/commands').send({kind:'REFRESH',idempotencyKey:randomUUID()});
      expect(marked.status).toBe(200);expect(marked.body.positions[0].markPrice).toBe(current);
      const closed=await request(app).post('/native/commands').send({kind:'CLOSE',positionId:p.id,idempotencyKey:randomUUID(),candle:input.candle});
      expect(closed.status).toBe(200);const exit=closed.body.events.filter((e:any)=>e.kind==='CLOSE').at(-1);
      expect(exit.price).toBe(current);expect(exit.pricing).toBe('NEAR_LIVE_DEMO');
      const pnl=n(current).minus(entry).times('.001').times(side==='LONG'?1:-1),closeFee=n(current).times('.001').times(rate);
      wallet=wallet.plus(pnl).minus(closeFee);
      expect(exit.cashflow).toBe(pnl.minus(closeFee).toFixed());expect(exit.fee).toBe(closeFee.toFixed());
      expect(closed.body.account.settleBalance).toBe(wallet.toFixed());expect(closed.body.ledger.reconciled).toBe(true);
      expect(closed.body.positions).toHaveLength(0);expect(closed.body.orders.filter((o:any)=>['OPEN','PARTIALLY_FILLED'].includes(o.status))).toHaveLength(0);
      report.push({test:`HISTORICAL_DEMO ${side}`,input,server:{entry:p.entryPrice,exit:exit.price,wallet:closed.body.account.settleBalance},expected:{wallet:wallet.toFixed(),pnl:pnl.toFixed(),fees:fee.plus(closeFee).toFixed()},status:'PASS',ms:0});
    }
    expect(bookCalls).toBe(0);
  },30000);
  test('LONG, SHORT, reload, closes, LIMIT, reduce-only, both margin modes, TP/SL and refusal',async()=>{
    const user=await db.user.create({data:{email:`acceptance-${randomUUID()}@example.test`,passwordHash:'NO_LOGIN',role:'ADMIN',referralCode:randomUUID()}});
    const session=await db.session.create({data:{userId:user.id}});
    const actor={userId:user.id,sessionId:session.id,expiresAt:Date.now()+3600000};
    await db.demoBalance.create({data:{userId:user.id,asset:'USDT',available:'1000'}});
    await db.demoBalance.create({data:{userId:user.id,asset:'ETH',available:'0.01'}});
    const repo=new PrismaNativeRepository(db,()=>({enabled:true,ownerId:user.id}));
    let price='50000',bookCalls=0;
    const market=new PrivateTradingMarketData({collector:{url:'http://127.0.0.1',token:'LOCAL_FIXTURE_ONLY'},request:(async(url)=>{
      const u=new URL(String(url)),symbol=u.pathname.split('/').at(-1)!,t=Date.now();let data:unknown;
      if(u.pathname.includes('/instruments/'))data={...instrument(symbol),fetchedAt:t};
      else if(u.pathname.includes('/quote/')){bookCalls++;data={provider:'bybit',symbol,bids:[{price:n(price).minus('.1').toFixed(),quantity:'10'}],asks:[{price:n(price).plus('.1').toFixed(),quantity:'10'}],markPrice:price,lastPrice:price,fundingRate:'0',nextFundingTime:t+3600000,providerTimestamp:t,bookGeneratedAt:t,markProviderTimestamp:t,fetchedAt:t};}
      else if(u.pathname.endsWith('/marks'))data={status:'live',marks:u.searchParams.get('symbols')!.split(',').map(symbol=>({symbol,markPrice:symbol==='ETHUSDT'?'2000':price,lastPrice:symbol==='ETHUSDT'?'2000':price,markProviderTimestamp:t,receivedAt:t,fetchedAt:t})),fetchedAt:t};
      else throw Error('Unexpected history read '+u.pathname);
      return new Response(JSON.stringify(data),{status:200});
    }) as typeof fetch});
    const app=express();app.use(express.json());
    // Fresh service per HTTP request models process restart and denies reliance on instance state.
    app.use('/private-trading/native',(req,res,next)=>nativeDemoRoutes(new NativeDemoService(repo,market),()=>actor)(req,res,next));
    app.use((e:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(e instanceof PrivateTradingError?e.status:500).json({error:e instanceof Error?e.message:String(e),code:(e as any).code}));
    let expectedWallet=n(1000),expectedGross=n(0),expectedFees=n(0);const seen=new Set<string>();
    const lots=new Map<string,{qty:BigNumber;entry:BigNumber;side:string;openedNotional:BigNumber}>();
    function audit(v:any){
      for(const e of v.events){if(seen.has(e.id))continue;seen.add(e.id);
        if(e.kind==='OPEN'){
          const o=v.orders.find((o:any)=>o.id===e.orderId),old=lots.get(e.positionId),qty=n(e.quantity),fill=n(e.price);
          const expectedPrice=o.type==='LIMIT'?n(o.price):n(price).plus(o.side==='LONG'?'.1':'-.1');
          expect(fill.toFixed()).toBe(expectedPrice.toFixed());
          const fee=qty.times(fill).times(e.pricing==='MAKER_MODEL'?'.0002':rate);
          expect(n(e.fee).toFixed()).toBe(fee.toFixed());expectedFees=expectedFees.plus(fee);expectedWallet=expectedWallet.minus(fee);
          const total=(old?.qty??n(0)).plus(qty),entry=(old?.qty.times(old.entry)??n(0)).plus(qty.times(fill)).div(total);
          lots.set(e.positionId,{qty:total,entry,side:o.side,openedNotional:(old?.openedNotional??n(0)).plus(qty.times(fill))});
        }else if(['CLOSE','TAKE_PROFIT','STOP_LOSS'].includes(e.kind)){
          const lot=lots.get(e.positionId)!;expect(lot).toBeDefined();
          const pnl=n(e.price).minus(lot.entry).times(e.quantity).times(lot.side==='LONG'?1:-1);
          const fee=n(e.quantity).times(e.price).times(e.pricing==='MAKER_MODEL'?'.0002':rate);
          expect(n(e.cashflow).toFixed()).toBe(pnl.minus(fee).toFixed());expect(n(e.fee).toFixed()).toBe(fee.toFixed());
          expectedFees=expectedFees.plus(fee);expectedGross=expectedGross.plus(pnl);expectedWallet=expectedWallet.plus(pnl).minus(fee);lot.qty=lot.qty.minus(e.quantity);
        }else if(['CANCEL','TRIGGER'].includes(e.kind)){expect(n(e.fee).isZero()).toBe(true);expect(n(e.cashflow).isZero()).toBe(true);}
        else throw Error('Unexpected financial event '+e.kind);
      }
      let initial=n(0),upl=n(0);const positions:Record<string,unknown>[]=[];
      for(const p of v.positions){const lot=lots.get(p.id)!;expect(n(p.quantity).toFixed()).toBe(lot.qty.toFixed());expect(n(p.entryPrice).toFixed()).toBe(lot.entry.toFixed());
        expect(p.leverage).toBe('3');expect(p.marginMode).toBe(p.side==='LONG'?'CROSS':'ISOLATED');
        expect(n(p.markPrice).toFixed()).toBe(n(price).toFixed());expect(n(p.entryNotional).toFixed()).toBe(lot.openedNotional.toFixed());
        const un=n(p.markPrice).minus(lot.entry).times(lot.qty).times(p.side==='LONG'?1:-1);expect(n(p.unrealizedPnl).toFixed()).toBe(un.toFixed());upl=upl.plus(un);
        const im=lot.qty.times(p.marginMode==='ISOLATED'?lot.entry:n(p.markPrice)).div(p.leverage);
        let liquidationPrice:string|null=null;
        if(p.marginMode==='ISOLATED'){expect(n(p.isolatedMargin).minus(im).abs().lt('.00000001')).toBe(true);initial=initial.plus(im);
          const signed=p.side==='LONG'?1:-1;const liq=lot.entry.times(lot.qty).times(signed).minus(im).div(lot.qty.times(n(signed).minus(n('.005').plus(rate))));
          const rounded=liq.div('.1').integerValue(p.side==='LONG'?BigNumber.ROUND_CEIL:BigNumber.ROUND_FLOOR).times('.1');
          expect(n(p.liquidationPrice).toFixed()).toBe(rounded.toFixed());
          liquidationPrice=rounded.toFixed();
        }else {initial=initial.plus(im).plus(lot.qty.times(p.markPrice).times(rate));expect(p.liquidationPrice).toBeNull();}
        positions.push({side:lot.side,remainingSize:lot.qty.toFixed(),entry:lot.entry.toFixed(),entryNotional:lot.openedNotional.toFixed(),leverage:'3',marginMode:p.side==='LONG'?'CROSS':'ISOLATED',unrealizedPnl:un.toFixed(),liquidationPrice});
      }
      expect(n(v.account.settleBalance).minus(expectedWallet).abs().lt('.00000002')).toBe(true);
      expect(n(v.account.initialMargin).minus(initial).abs().lt('.00000002')).toBe(true);
      expect(n(v.account.unrealizedPnl).minus(upl).abs().lt('.00000002')).toBe(true);
      expect(n(v.ledger.totals.fees).abs().minus(expectedFees).abs().lt('.00000002')).toBe(true);
      expect(n(v.account.collateral).minus(expectedWallet.plus(20)).abs().lt('.00000002')).toBe(true);
      expect(n(v.ledger.totals.realizedPnl).minus(expectedGross).abs().lt('.00000002')).toBe(true);
      expect(v.ledger.reconciled).toBe(true);
      return {wallet:expectedWallet.toFixed(),fees:expectedFees.toFixed(),realizedGross:expectedGross.toFixed(),initialMargin:initial.toFixed(),unrealizedPnl:upl.toFixed(),collateral:expectedWallet.plus(20).toFixed(),positions};
    }
    const command=async(test:string,input:Omit<NativeCommand,'idempotencyKey'>|Record<string,unknown>,status=200)=>{
      const before=Date.now(),r=await request(app).post('/private-trading/native/commands').send({...input,idempotencyKey:randomUUID()});
      report.push({test,input,server:r.body,expected:{status},status:'FAIL',ms:Date.now()-before});
      expect(r.status).toBe(status);expect(r.headers['x-native-request-id']).toBeTruthy();
      if(status===200)report.at(-1)!.expected=audit(r.body);
      report.at(-1)!.status='PASS';return r.body;
    };
    const open=(side:string,marginType='CROSS',extra:Record<string,unknown>={})=>({kind:'OPEN',symbol:'BTCUSDT',side,type:'MARKET',quantity:'0.002',leverage:'3',marginType,...extra});
    await new NativeDemoService(repo,market).initialize(actor,randomUUID());
    const holdingsBefore=await db.demoBalance.findMany({where:{userId:user.id}});
    for(const enabled of [false,true]){
      const r=await request(app).post('/private-trading/native/collateral-preference').send({asset:'ETH',enabled,idempotencyKey:randomUUID()});
      expect(r.status).toBe(200);expect(n(r.body.account.collateral).toFixed()).toBe(enabled?'1020':'1000');
      expect(await db.demoBalance.findMany({where:{userId:user.id}})).toEqual(holdingsBefore);
      report.push({test:'Wallet collateral '+(enabled?'ON':'OFF'),input:{asset:'ETH',quantity:'0.01',mark:'2000'},server:{collateral:r.body.account.collateral},expected:{collateral:enabled?'1020':'1000',walletHoldingsUnchanged:true},status:'PASS',ms:0});
    }

    let v=await command('MARKET LONG Cross',open('LONG'));const long=v.positions[0].id;expect(bookCalls).toBeGreaterThan(0);
    v=await command('MARKET SHORT Isolated',open('SHORT','ISOLATED'));const short=v.positions.find((p:any)=>p.side==='SHORT').id;
    const reloaded=await request(app).get('/private-trading/native/state');expect(reloaded.status).toBe(200);audit(reloaded.body);
    expect(reloaded.body.positions).toEqual(v.positions);report.push({test:'reload/server restart',input:null,server:{revision:v.revision,positions:2},expected:{revision:v.revision,positions:2},status:'PASS',ms:0});
    price='50100';v=await command('partial MARKET close',{kind:'CLOSE',positionId:long,quantity:'0.001'});expect(v.positions.find((p:any)=>p.id===short).quantity).toBe('0.002');
    await command('full MARKET close',{kind:'CLOSE',positionId:long});await command('close isolated SHORT',{kind:'CLOSE',positionId:short});
    v=await command('LIMIT rests',open('LONG','CROSS',{type:'LIMIT',price:'49000'}));const limit=v.orders.at(-1).id;expect(v.orders.at(-1).status).toBe('OPEN');
    await command('LIMIT cancel',{kind:'CANCEL',orderId:limit});
    v=await command('target position',open('LONG'));const target=v.positions[0].id;
    await command('reduce-only LIMIT rests',open('SHORT','CROSS',{type:'LIMIT',price:'50200',reduceOnly:true,positionId:target,quantity:'0.001'}));
    price='50201';v=await command('reduce-only maker fill',{kind:'REFRESH'});expect(v.positions.find((p:any)=>p.id===target).quantity).toBe('0.001');
    await command('close remainder',{kind:'CLOSE',positionId:target});
    price='50000';await command('LONG with TP',open('LONG','CROSS',{protection:{takeProfit:'50100',triggerBy:'MARK'}}));
    price='50101';v=await command('TP trigger and observed book fill',{kind:'REFRESH'});expect(v.positions).toHaveLength(0);expect(v.events.at(-1).kind).toBe('TAKE_PROFIT');
    price='50000';await command('SHORT with SL',open('SHORT','ISOLATED',{protection:{stopLoss:'50100',triggerBy:'MARK'}}));
    price='50101';v=await command('SL trigger and observed book fill',{kind:'REFRESH'});expect(v.positions).toHaveLength(0);expect(v.events.at(-1).kind).toBe('STOP_LOSS');
    const before=await repo.read(actor);await command('insufficient funds',open('LONG','CROSS',{quantity:'1'}),409);expect(await repo.read(actor)).toEqual(before);
    const final=await request(app).get('/private-trading/native/state');audit(final.body);
    expect(final.body.positions).toHaveLength(0);expect(final.body.orders.filter((o:any)=>['OPEN','PARTIALLY_FILLED'].includes(o.status))).toHaveLength(0);
    report.push({test:'cleanup',input:{startBalance:'1000'},server:{endBalance:final.body.account.settleBalance,openPositions:0,openOrders:0},expected:{endBalance:expectedWallet.toFixed(),openPositions:0,openOrders:0},status:'PASS',ms:0});
  },30000);
});
