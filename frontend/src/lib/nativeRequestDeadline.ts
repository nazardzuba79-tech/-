import { PrivateTradingError } from './privateTradingError';

// Allows the server's 30s pre-commit budget + bounded 12s transaction envelope.
export const NATIVE_REQUEST_TIMEOUT_MS=45_000;
/** Covers both headers and body. A lost response is UNKNOWN, never a refusal
 * or permission to submit again with a new key. Does not retry any request. */
export async function nativeRequestDeadline<T>(task:(signal:AbortSignal)=>Promise<T>,parent?:AbortSignal,timeout=NATIVE_REQUEST_TIMEOUT_MS):Promise<T>{
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  let cancel:()=>void=()=>{};
  const ended=new Promise<never>((_resolve,reject)=>{
    cancel=()=>{controller.abort();reject(new PrivateTradingError('Запрос прерван. Проверьте состояние счёта перед повторной отправкой.',499,'native_confirmation_unknown'));};
    if(parent?.aborted){cancel();return;}
    parent?.addEventListener('abort',cancel,{once:true});
    timer=setTimeout(()=>{
      controller.abort();
      reject(new PrivateTradingError('Сервер не подтвердил результат вовремя. Проверьте позиции и ордера перед повторной отправкой.',504,'native_confirmation_unknown'));
    },timeout);
  });
  try{if(parent?.aborted)return await ended;return await Promise.race([task(controller.signal),ended]);}
  finally{if(timer)clearTimeout(timer);parent?.removeEventListener('abort',cancel);}
}
