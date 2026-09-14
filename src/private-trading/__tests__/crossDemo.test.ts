import { crossDemoAccountSnapshot, crossDemoFundingCashflow, crossDemoLiquidationPrice, historicalLimitFillPrice } from '../crossDemo';
import type { ModelProfile } from '../types';

const profile:ModelProfile={
  pricingModelVersion:'test',feeModelVersion:'test',riskModelVersion:'test',
  takerFeeRate:'0.00055',makerFeeRate:'0.0002',liquidationFeeRate:'0',slippageBps:'0',
  riskTiers:[{maxNotional:'1000000000',maintenanceRate:'0.005',deduction:'0',maxLeverage:'100'}],assumptions:[],
};
const long={id:'long',side:'LONG' as const,quantity:'1',entryPrice:'70000',markPrice:'71000',leverage:'10',profile};

describe('private cross demo account math',()=>{
  test('whole demo wallet collateral can make liquidation unreachable',()=>{
    const snapshot=crossDemoAccountSnapshot('10000000',[long]);
    expect(snapshot.totalUnrealizedPnl).toBe('1000');
    expect(snapshot.liquidatable).toBe(false);
    expect(crossDemoLiquidationPrice('10000000',[long],'long')).toBeNull();
  });

  test('cross liquidation moves closer as shared wallet collateral falls',()=>{
    const price=crossDemoLiquidationPrice('1000',[long],'long');
    expect(price).not.toBeNull();
    expect(Number(price)).toBeGreaterThan(68000);
    expect(Number(price)).toBeLessThan(70000);
  });

  test('owner fixed demo funding is negative for long and positive for short',()=>{
    expect(crossDemoFundingCashflow('LONG','2','50000')).toBe('-10');
    expect(crossDemoFundingCashflow('SHORT','2','50000')).toBe('100');
  });

  test('historical buy limit fills on low wick and uses a better gap-open price',()=>{
    const wick={timestamp:0,open:'25000',high:'26000',low:'19000',close:'24000'};
    expect(historicalLimitFillPrice('LONG','20000',wick)).toBe('20000');
    const gap={timestamp:0,open:'19500',high:'21000',low:'19000',close:'20500'};
    expect(historicalLimitFillPrice('LONG','20000',gap)).toBe('19500');
    expect(historicalLimitFillPrice('LONG','18000',wick)).toBeNull();
  });

  test('historical sell limit fills on high wick and uses a better gap-open price',()=>{
    const wick={timestamp:0,open:'70000',high:'80000',low:'69000',close:'75000'};
    expect(historicalLimitFillPrice('SHORT','78000',wick)).toBe('78000');
    const gap={timestamp:0,open:'79000',high:'81000',low:'77000',close:'80000'};
    expect(historicalLimitFillPrice('SHORT','78000',gap)).toBe('79000');
    expect(historicalLimitFillPrice('SHORT','82000',wick)).toBeNull();
  });
});
