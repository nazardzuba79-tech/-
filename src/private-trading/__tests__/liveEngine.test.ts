import BigNumber from 'bignumber.js';
import { applyPrivateFunding, availablePrivateBook, cancelPrivateOrder, closePrivatePosition, fillPrivateOrder, updatePosition } from '../liveEngine';
import { AccountTx } from '../store';
import { emptyState, PrivateOrder } from '../serviceTypes';
import { ModelProfile } from '../types';
import { PrivateFreshQuote } from '../marketData';
import { quoteOrderCost } from '../math';

const NOW = 1_800_000_000_000;
const profile: ModelProfile = { pricingModelVersion:'test-price',feeModelVersion:'test-fees',riskModelVersion:'test-risk',takerFeeRate:'0',makerFeeRate:'0',liquidationFeeRate:'0',slippageBps:'0',riskTiers:[{maxNotional:'1000000000',maintenanceRate:'0.005',deduction:'0',maxLeverage:'100'}],assumptions:['TEST_ONLY'] };
type Journal = {kind:string; amount:string; suffix:string; effectiveAt?:number; metadata?:unknown};
function account() {
  const journal: Journal[] = [];
  const tx:AccountTx={db:{} as any,state:emptyState(),available:new BigNumber(1000),reserved:new BigNumber(0),principal:new BigNumber(1000),realized:new BigNumber(0),entry:async(kind,amount,suffix,effectiveAt,_scenarioId,metadata)=>{ if(journal.some(j=>j.suffix===suffix)) throw new Error('DUPLICATE_ENTRY'); journal.push({kind,amount,suffix,effectiveAt,metadata}); }};
  return {tx,journal};
}
function quote(bid='99',ask='100',size='100'):PrivateFreshQuote {
  const t=Date.now();return {provider:'bybit',symbol:'XYZUSDT',bids:[{price:bid,quantity:size}],asks:[{price:ask,quantity:size}],markPrice:ask,lastPrice:ask,fundingRate:'0.001',nextFundingTime:t+3600000,providerTimestamp:t,bookGeneratedAt:t,markProviderTimestamp:t,fetchedAt:t};
}
function order(tx:AccountTx,id='order',quantity='10',type:'MARKET'|'LIMIT'='MARKET', p=profile) {
  const reserved=quoteOrderCost({side:'LONG',quantity,price:'100',leverage:'10',profile:p}).totalCost;
  const o:PrivateOrder={id,symbol:'XYZUSDT',side:'LONG',type,quantity,remainingQuantity:quantity,filledQuantity:'0',limitPrice:type==='LIMIT'?'100':null,status:'OPEN',positionId:`p-${id}`,createdAt:new Date().toISOString(),reserved,leverage:'10',takeProfit:null,stopLoss:null,profile:p,lastBookTimestamp:0};
  tx.available=tx.available.minus(reserved);tx.reserved=tx.reserved.plus(reserved);tx.state.orders.push(o);return o;
}
function expectCashIdentity(tx:AccountTx) {expect(tx.available.plus(tx.reserved).minus(tx.principal.plus(tx.realized).plus(tx.state.isolatedDeficit??'0')).abs().lt('0.000000000000001')).toBe(true);}
describe('private live account engine',()=>{
  beforeEach(()=>{jest.useFakeTimers();jest.setSystemTime(NOW);});afterEach(()=>jest.useRealTimers());
  test('open, partial and full close retain exact fees, realized PnL and account identity',async()=>{
    const {tx,journal}=account();const p={...profile,takerFeeRate:'0.001'};const o=order(tx,'first','10','MARKET',p);
    await fillPrivateOrder(tx,o,quote());expect(o.status).toBe('FILLED');const position=tx.state.positions[0];expect(position.quantity).toBe('10');expect(position.openingFees).toBe('1.000000000000000000');expectCashIdentity(tx);
    jest.setSystemTime(NOW+1000);await closePrivatePosition(tx,position,'4',quote('110','111'));
    expect(position.quantity).toBe('6');expect(position.realizedGross).toBe('40.000000000000000000');expect(position.closingFees).toBe('0.440000000000000000');expectCashIdentity(tx);
    jest.setSystemTime(NOW+2000);await closePrivatePosition(tx,position,'6',quote('120','121'));
    expect(position.status).toBe('CLOSED');expect(position.realizedGross).toBe('160.000000000000000000');expect(position.netPnl).toBe('157.840000000000000000');expect(tx.reserved.toFixed()).toBe('0');expectCashIdentity(tx);
    expect(journal.filter(j=>j.kind==='OPEN_FEE')).toHaveLength(1);expect(journal.filter(j=>j.kind==='CLOSE_FEE')).toHaveLength(2);
  });
  test('partial market fill cancels remainder and releases unused reserve',async()=>{
    const {tx}=account();const o=order(tx);await fillPrivateOrder(tx,o,quote('99','100','3'));
    expect(o).toMatchObject({status:'CANCELLED',filledQuantity:'3',remainingQuantity:'7',reserved:'0.000000000000000000'});expect(tx.state.positions[0].quantity).toBe('3');expect(tx.reserved.toFixed()).toBe('30');expectCashIdentity(tx);
  });
  test('partial limit fill keeps the remaining reserve, then cancellation releases only that part',async()=>{
    const {tx}=account();const o=order(tx,'limit','10','LIMIT');await fillPrivateOrder(tx,o,quote('99','100','3'));
    expect(o.status).toBe('PARTIALLY_FILLED');expect(new BigNumber(o.reserved).toFixed()).toBe('70');expect(tx.reserved.toFixed()).toBe('100');
    await cancelPrivateOrder(tx,o,'cancel');expect(tx.reserved.toFixed()).toBe('30');expect(tx.available.toFixed()).toBe('970');expectCashIdentity(tx);
  });
  test('a non-crossing limit does not pretend to fill',async()=>{
    const {tx,journal}=account();const o=order(tx,'limit','10','LIMIT');await fillPrivateOrder(tx,o,quote('100','101'));
    expect(o.status).toBe('OPEN');expect(tx.state.positions).toHaveLength(0);expect(journal).toHaveLength(0);expectCashIdentity(tx);
  });
  test('same actual depth cannot fund two different orders at the same timestamp',async()=>{
    const {tx}=account();const first=order(tx,'a','5'),second=order(tx,'b','5');const q=quote('99','100','5');
    await fillPrivateOrder(tx,first,q);await fillPrivateOrder(tx,second,q);
    expect(first.status).toBe('FILLED');expect(second.status).toBe('CANCELLED');expect(tx.state.positions).toHaveLength(1);expect(tx.state.positions[0].quantity).toBe('5');expectCashIdentity(tx);
  });
  test('same close snapshot cannot repeatedly consume exhausted bids',async()=>{
    const {tx}=account();await fillPrivateOrder(tx,order(tx),quote());jest.setSystemTime(NOW+1000);const q=quote('110','111','3'),p=tx.state.positions[0];
    await closePrivatePosition(tx,p,'10',q);expect(p.quantity).toBe('7');
    await expect(closePrivatePosition(tx,p,'7',q)).rejects.toThrow('Исполнение временно');expect(p.quantity).toBe('7');expectCashIdentity(tx);
  });
  test('newer depth snapshot can fill remaining resting quantity once',async()=>{
    const {tx}=account();const o=order(tx,'a','10','LIMIT');await fillPrivateOrder(tx,o,quote('99','100','3'));await fillPrivateOrder(tx,o,quote('99','100','3'));expect(o.filledQuantity).toBe('3');
    jest.setSystemTime(NOW+1000);await fillPrivateOrder(tx,o,quote('99','100','7'));expect(o.status).toBe('FILLED');expect(tx.state.positions[0].quantity).toBe('10');expectCashIdentity(tx);
  });
  test('a new response timestamp without a new matching-engine book does not replenish depth',async()=>{
    const {tx}=account();const first=order(tx,'a','5');const original=quote('99','100','5');await fillPrivateOrder(tx,first,original);
    jest.setSystemTime(NOW+1000);const second=order(tx,'b','5');await fillPrivateOrder(tx,second,{...quote('99','100','5'),bookGeneratedAt:original.bookGeneratedAt});
    expect(second.status).toBe('CANCELLED');expect(tx.state.positions).toHaveLength(1);expectCashIdentity(tx);
  });
  test('preview and execution share the same remaining depth without changing persisted preview state',async()=>{
    const {tx}=account();const q=quote('99','100','5');await fillPrivateOrder(tx,order(tx,'a','2'),q);
    const before=JSON.stringify(tx.state);const previewState=JSON.parse(before);
    expect(availablePrivateBook(previewState,q).asks).toEqual([{price:'100',quantity:'3'}]);
    expect(JSON.stringify(tx.state)).toBe(before);
  });
  test('successive short limit fills cannot bypass aggregate position leverage tier',async()=>{
    const {tx,journal}=account();const tiers={...profile,riskTiers:[{maxNotional:'1000',maintenanceRate:'0.005',deduction:'0',maxLeverage:'10'},{maxNotional:'10000',maintenanceRate:'0.01',deduction:'5',maxLeverage:'5'}]};
    const o=order(tx,'tier','8','LIMIT',tiers);o.side='SHORT';
    // User explicitly reserved the currently crossed cost and resting remainder.
    tx.available=tx.available.minus('40');tx.reserved=tx.reserved.plus('40');o.reserved='120';
    await fillPrivateOrder(tx,o,quote('200','201','4'));expect(tx.state.positions[0].quantity).toBe('4');
    const before={available:tx.available.toFixed(),reserved:tx.reserved.toFixed(),position:JSON.stringify(tx.state.positions[0]),journal:journal.length};
    jest.setSystemTime(NOW+1000);await expect(fillPrivateOrder(tx,o,quote('200','201','4'))).rejects.toThrow('TIER_LEVERAGE_EXCEEDED');
    expect({available:tx.available.toFixed(),reserved:tx.reserved.toFixed(),position:JSON.stringify(tx.state.positions[0]),journal:journal.length}).toEqual(before);expectCashIdentity(tx);
  });
  test('new fills enforce the mark-value tier as well as the entry-value tier',async()=>{
    const {tx,journal}=account();const tiers={...profile,riskTiers:[{maxNotional:'1000',maintenanceRate:'0.005',deduction:'0',maxLeverage:'10'},{maxNotional:'10000',maintenanceRate:'0.01',deduction:'5',maxLeverage:'5'}]};
    const o=order(tx,'mark-tier','10','MARKET',tiers);const q={...quote('98','99'),markPrice:'101'};
    await expect(fillPrivateOrder(tx,o,q)).rejects.toMatchObject({code:'tier_leverage_exceeded'});expect(journal).toHaveLength(0);expect(tx.state.positions).toHaveLength(0);expectCashIdentity(tx);
  });
  test('a resting short limit cannot borrow extra free capital when its fill notional rises',async()=>{
    const {tx,journal}=account();const o=order(tx,'short-budget','10','LIMIT');o.side='SHORT';
    const before={available:tx.available.toFixed(),reserved:tx.reserved.toFixed(),orderReserve:o.reserved};
    await fillPrivateOrder(tx,o,quote('200','201'));
    expect(tx.state.positions).toHaveLength(0);expect(journal).toHaveLength(0);expect(o.status).toBe('OPEN');
    expect({available:tx.available.toFixed(),reserved:tx.reserved.toFixed(),orderReserve:o.reserved}).toEqual(before);expectCashIdentity(tx);
  });
  test('changed body under the same snapshot id is rejected',async()=>{
    const {tx}=account();await fillPrivateOrder(tx,order(tx,'a','1'),quote('99','100','2'));const next=order(tx,'b','1');
    await expect(fillPrivateOrder(tx,next,quote('99','100','3'))).rejects.toThrow('Котировка обновляется');
  });
  test('closing cancels any entry remainder so it cannot recreate a position',async()=>{
    const {tx}=account();const o=order(tx,'a','10','LIMIT');await fillPrivateOrder(tx,o,quote('99','100','3'));jest.setSystemTime(NOW+1000);
    await closePrivatePosition(tx,tx.state.positions[0],'3',quote('110','111'));expect(o.status).toBe('CANCELLED');
    jest.setSystemTime(NOW+2000);await fillPrivateOrder(tx,o,quote());expect(tx.state.positions[0].status).toBe('CLOSED');expectCashIdentity(tx);
  });
  test('gross loss never disguises isolated deficit as profit or consumes unrelated free capital',async()=>{
    const {tx,journal}=account();await fillPrivateOrder(tx,order(tx),quote());jest.setSystemTime(NOW+1000);const p=tx.state.positions[0];
    await closePrivatePosition(tx,p,'10',quote('1','2'),'LIQUIDATION');
    expect(p.realizedGross).toBe('-990.000000000000000000');expect(p.netPnl).toBe('-990.000000000000000000');expect(p.isolatedDeficit).toBe('890.000000000000000000');expect(tx.available.toFixed()).toBe('900');expect(tx.realized.toFixed()).toBe('-990');expectCashIdentity(tx);
    expect(journal.find(j=>j.kind==='ISOLATED_DEFICIT')?.amount).toBe('890.000000000000000000');
  });
  test('funding cash pays from free balance, reserve is not debited twice',async()=>{
    const {tx,journal}=account();await fillPrivateOrder(tx,order(tx),quote());const p=tx.state.positions[0];jest.setSystemTime(NOW+2000);
    await applyPrivateFunding(tx,p,{timestamp:NOW+1000,rate:'0.001',markPrice:'100'});
    expect(tx.available.toFixed()).toBe('899');expect(tx.reserved.toFixed()).toBe('100');expect(p.fundingNet).toBe('-1.000000000000000000');expectCashIdentity(tx);
    await applyPrivateFunding(tx,p,{timestamp:NOW+1000,rate:'0.001',markPrice:'100'});expect(journal.filter(j=>j.kind==='FUNDING')).toHaveLength(1);
    await applyPrivateFunding(tx,p,{timestamp:NOW+1500,rate:'-0.002',markPrice:'100'});expect(tx.available.toFixed()).toBe('901');expect(p.fundingNet).toBe('1.000000000000000000');expectCashIdentity(tx);
  });
  test('funding historical boundary uses quantity held then, including before partial close',async()=>{
    const {tx}=account();await fillPrivateOrder(tx,order(tx),quote());const p=tx.state.positions[0];jest.setSystemTime(NOW+2000);await closePrivatePosition(tx,p,'5',quote('100','101'));
    jest.setSystemTime(NOW+3000);await applyPrivateFunding(tx,p,{timestamp:NOW+1000,rate:'0.001',markPrice:'100'});expect(p.fundingNet).toBe('-1.000000000000000000');
    await applyPrivateFunding(tx,p,{timestamp:NOW+2500,rate:'0.001',markPrice:'100'});expect(p.fundingNet).toBe('-1.500000000000000000');expectCashIdentity(tx);
  });
  test('no funding on entry boundary or after close',async()=>{
    const {tx,journal}=account();await fillPrivateOrder(tx,order(tx),quote());const p=tx.state.positions[0];await applyPrivateFunding(tx,p,{timestamp:NOW,rate:'0.001',markPrice:'100'});
    jest.setSystemTime(NOW+1000);await closePrivatePosition(tx,p,'10',quote('100','101'));jest.setSystemTime(NOW+2000);await applyPrivateFunding(tx,p,{timestamp:NOW+1500,rate:'0.001',markPrice:'100'});
    expect(journal.filter(j=>j.kind==='FUNDING')).toHaveLength(0);
  });
  test('funding insufficient free cash debits only its isolated margin once',async()=>{
    const {tx}=account();await fillPrivateOrder(tx,order(tx),quote());const p=tx.state.positions[0];
    // Reserve all other free money in a second independent open order.
    const other=order(tx,'other','90','LIMIT');expect(tx.available.toFixed()).toBe('0');jest.setSystemTime(NOW+1000);
    await applyPrivateFunding(tx,p,{timestamp:NOW+500,rate:'0.001',markPrice:'100'});
    expect(new BigNumber(p.allocatedMargin).toFixed()).toBe('99');expect(new BigNumber(other.reserved).toFixed()).toBe('900');expect(tx.reserved.toFixed()).toBe('999');expectCashIdentity(tx);
  });
  test('funding exhaustion records a distinct deficit and allows risk evaluation to proceed',async()=>{
    const {tx,journal}=account();await fillPrivateOrder(tx,order(tx),quote());const p=tx.state.positions[0];order(tx,'other','90','LIMIT');jest.setSystemTime(NOW+1000);
    await applyPrivateFunding(tx,p,{timestamp:NOW+500,rate:'0.2',markPrice:'100'});
    expect(new BigNumber(p.allocatedMargin).toFixed()).toBe('0');expect(p.fundingNet).toBe('-200.000000000000000000');expect(p.isolatedDeficit).toBe('100.000000000000000000');expect(updatePosition(p,quote())?.liquidatable).toBe(true);expectCashIdentity(tx);
    expect(journal.filter(j=>j.kind==='ISOLATED_FUNDING_DEFICIT')).toHaveLength(1);
  });
  test('stale and mismatched quotes fail before mutations',async()=>{
    const {tx,journal}=account();const o=order(tx),q=quote();jest.setSystemTime(NOW+6000);
    await expect(fillPrivateOrder(tx,o,q)).rejects.toThrow('quote_stale');expect(tx.state.positions).toHaveLength(0);expect(journal).toHaveLength(0);
    await expect(fillPrivateOrder(tx,o,{...quote(),symbol:'BTCUSDT'})).rejects.toThrow('market_data_invalid');expect(tx.state.positions).toHaveLength(0);
  });
  test('mark valuation does not alter position quantities or realized results',async()=>{
    const {tx}=account();await fillPrivateOrder(tx,order(tx),quote());jest.setSystemTime(NOW+1000);const p=tx.state.positions[0];updatePosition(p,quote('109','110'));
    expect(p.quantity).toBe('10');expect(p.unrealizedPnl).toBe('100');expect(p.realizedGross).toBe('0');expect(p.roiPercent).toBe('100');expectCashIdentity(tx);
  });
});
