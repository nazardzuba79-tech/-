import BigNumber from 'bignumber.js';
import { DepositService } from '../DepositService';
import { createVerifier } from '../deposit-verifiers';
jest.mock('../deposit-verifiers', () => ({ ...jest.requireActual('../deposit-verifiers'), createVerifier: jest.fn() }));

function claim(asset: string, amount: string, ticker: unknown) {
  (createVerifier as jest.Mock).mockReturnValue({ verify: jest.fn(async () => ({ amount:new BigNumber(amount), confirmations:19 })) });
  const balanceUpdate=jest.fn(),reward=jest.fn();
  const prisma:any={ deposit:{findUnique:jest.fn(async()=>null)},$transaction:async(fn:any)=>fn({
    deposit:{create:jest.fn(async()=>({id:'deposit'}))},balance:{upsert:jest.fn(async()=>({available:'0'})),update:balanceUpdate},
    user:{findUnique:jest.fn(async()=>({referredById:'referrer'}))},referralReward:{create:reward},auditLog:{create:jest.fn()},
  })};
  const price={getTicker:jest.fn(async()=>{if(ticker instanceof Error)throw ticker;return ticker as any;})};
  const service=new DepositService(prisma,{chain:'test',type:'evm',nativeAsset:asset,tokens:{},treasuryAddress:'fixture',minConfirmations:19},price);
  return {promise:service.claimDeposit({userId:'user',txHash:'fixture',asset}),price,balanceUpdate,reward};
}
describe.each(['USDT','USDC','USD','DAI'])('%s threshold',asset=>{
  test.each(['299.99','300','300.01'])('%s units uses the USD peg and exact minimum',async amount=>{
    const s=claim(asset,amount,null);const result=await s.promise;
    expect(result.status).toBe(amount==='299.99'?'BELOW_MINIMUM':'CREDITED');
    expect(s.price.getTicker).not.toHaveBeenCalled(); expect(s.reward).toHaveBeenCalledTimes(amount==='299.99'?0:1);
  });
});
describe.each([['BTC','50000'],['ETH','1000']])('%s real price conversion', (asset,lastPrice)=>{
  test.each(['299.99','300','300.01'])('%s USD equivalent enforces the same boundary',async usd=>{
    const s=claim(asset,new BigNumber(usd).div(lastPrice).toString(),{lastPrice});const result=await s.promise;
    expect(result.status).toBe(usd==='299.99'?'BELOW_MINIMUM':'CREDITED');
    expect(s.price.getTicker).toHaveBeenCalledWith(`${asset}/USDT`);
  });
});
test.each([null,{lastPrice:'0'},{lastPrice:'NaN'},{lastPrice:'-1'},new Error('unavailable')])('unavailable price %p never falsely marks below minimum',async ticker=>{
  const s=claim('BTC','0.0001',ticker);expect((await s.promise).status).toBe('CREDITED');
});
