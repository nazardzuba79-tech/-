import { nativeRequestDeadline } from '../nativeRequestDeadline';
import { NativeCommandLane } from '../nativeCommandLane';

describe('native request deadlines without duplicate submission',()=>{
  test.each(['headers','body'])('stalled %s releases pending with UNKNOWN, no automatic retry',async stage=>{
    let signal:AbortSignal|undefined,calls=0,pending=true;
    const request=nativeRequestDeadline(async s=>{signal=s;calls++;if(stage==='body')await Promise.resolve();return new Promise<never>(()=>{});},undefined,15).finally(()=>pending=false);
    await expect(request).rejects.toMatchObject({code:'native_confirmation_unknown',status:504});
    expect(pending).toBe(false);expect(signal!.aborted).toBe(true);expect(calls).toBe(1);
  });
  test('confirmed refusal stays a refusal; success waits for actual server result',async()=>{
    const refusal={code:'native_command_timeout',status:503};
    await expect(nativeRequestDeadline(()=>Promise.reject(refusal))).rejects.toBe(refusal);
    await expect(nativeRequestDeadline(async()=>({revision:8}))).resolves.toEqual({revision:8});
  });
  test('a queued order expires without sending; later work still waits for the active request',async()=>{
    const lane=new NativeCommandLane(8,15);let release!:(s:string)=>void;
    const first=lane.enqueue(true,()=>new Promise<string>(r=>release=r));const send=jest.fn(async()=>true);
    await expect(lane.enqueue(false,send)).rejects.toMatchObject({code:'native_queue_timeout'});
    expect(send).not.toHaveBeenCalled();
    const last=lane.enqueue(false,send);await Promise.resolve();expect(send).not.toHaveBeenCalled();
    release('confirmed');await first;await last;expect(send).toHaveBeenCalledTimes(1);expect(lane.pending).toBe(0);
  });
});
