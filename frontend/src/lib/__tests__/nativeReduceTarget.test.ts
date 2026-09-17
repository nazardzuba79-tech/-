import { resolveNativeReduceTarget } from '../useNativeFuturesExecution';
import type { NativePosition } from '../nativeDemoApi';

const protection={takeProfit:null,stopLoss:null,quantity:null,triggerBy:'MARK' as const};
function position(id:string,marginMode:'CROSS'|'ISOLATED',quantity:string):NativePosition{
  return {
    id,symbol:'BTCUSDT',side:'LONG',quantity,entryPrice:'50000',markPrice:'51000',lastPrice:'51000',leverage:'10',
    status:'OPEN',openedAt:1,closedAt:null,historical:false,unrealizedPnl:'0',realizedPnl:'0',netPnl:'0',roiPercent:'0',
    roiBasis:'1',closedRoiBasis:'0',fundingNet:'0',protection,liquidationPrice:null,liquidationStatus:'ACCOUNT_CROSS_ESTIMATE',
    marginMode,isolatedMargin:marginMode==='ISOLATED'?'5000':'0',
  };
}

const params=(marginType:'CROSS'|'ISOLATED',quantity='1')=>({symbol:'BTC/USDT',side:'SELL' as const,quantity,marginType});

describe('native reduce-only target resolution',()=>{
  test('explicit chart exit id always wins',()=>{
    const cross=position('cross','CROSS','1'),isolated=position('isolated','ISOLATED','1');
    expect(resolveNativeReduceTarget([cross,isolated],params('CROSS'),'isolated')?.id).toBe('isolated');
  });

  test('same symbol and side are separated by margin bucket',()=>{
    const cross=position('cross','CROSS','1'),isolated=position('isolated','ISOLATED','2');
    expect(resolveNativeReduceTarget([cross,isolated],params('ISOLATED','2'),null)?.id).toBe('isolated');
    expect(resolveNativeReduceTarget([cross,isolated],params('CROSS','1'),null)?.id).toBe('cross');
  });

  test('full-size match can disambiguate when the form bucket is stale',()=>{
    const cross=position('cross','CROSS','3'),isolated=position('isolated','ISOLATED','7');
    expect(resolveNativeReduceTarget([cross,isolated],params('CROSS','7'),null)?.id).toBe('cross');
    // The selected bucket has one candidate, so it remains authoritative.
    expect(resolveNativeReduceTarget([cross,isolated],params('ISOLATED','3'),null)?.id).toBe('isolated');
  });

  test('ambiguous candidates are refused instead of closing the first row',()=>{
    const a=position('a','CROSS','1'),b=position('b','CROSS','1');
    expect(resolveNativeReduceTarget([a,b],params('CROSS','0.5'),null)).toBeUndefined();
  });

  test('wrong side and closed positions are never candidates',()=>{
    const short={...position('short','CROSS','1'),side:'SHORT' as const};
    const closed={...position('closed','CROSS','1'),status:'CLOSED' as const};
    expect(resolveNativeReduceTarget([short,closed],params('CROSS','1'),null)).toBeUndefined();
  });
});
