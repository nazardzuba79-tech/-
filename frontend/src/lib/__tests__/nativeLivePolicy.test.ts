import { shouldPollNativeLive,NATIVE_LIVE_POLL_MS,compactNativeUiState } from '../nativeLivePolicy';
import type { NativeState } from '../nativeDemoApi';
const state=(positions:unknown[]=[],orders:unknown[]=[])=>({initialized:true,revision:1,positions,orders,history:[],events:[],ledger:null}) as unknown as NativeState;
describe('native live polling policy',()=>{
  test('30 seconds preserved; empty accounts never poll',()=>{
    expect(NATIVE_LIVE_POLL_MS).toBe(30_000);
    expect(shouldPollNativeLive(state(),false,0)).toBe(false);
    expect(shouldPollNativeLive(null,false,0)).toBe(false);
  });
  test('hidden document and command in flight never poll',()=>{
    const s=state([{status:'OPEN'}]);
    expect(shouldPollNativeLive(s,true,0)).toBe(false);
    expect(shouldPollNativeLive(s,false,1)).toBe(false);
    expect(shouldPollNativeLive(s,false,0)).toBe(true);
  });
  test.each(['OPEN','PARTIALLY_FILLED'])('active %s order polls without positions',status=>{
    expect(shouldPollNativeLive(state([],[{status}]),false,0)).toBe(true);
  });
  test('pending closes poll; closed/cancelled rows do not',()=>{
    expect(shouldPollNativeLive(state([{pendingClose:{quantity:'1'}}]),false,0)).toBe(true);
    expect(shouldPollNativeLive(state([{status:'CLOSED'}],[{status:'CANCELLED'}]),false,0)).toBe(false);
  });
  test('mutation history cannot reenter browser warm live state',()=>{
    const s=state([],[{status:'FILLED'},{status:'OPEN'}]);s.events=[{} as never];s.history=[{} as never];
    const compact=compactNativeUiState(s);
    expect(compact.history).toEqual([]);expect(compact.events).toEqual([]);expect(compact.orders).toHaveLength(1);
    expect(s.history).toHaveLength(1);
  });
});
