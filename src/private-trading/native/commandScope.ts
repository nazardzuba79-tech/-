import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { PrivateTradingError } from '../serviceTypes';

export const NATIVE_COMMAND_DEADLINE_MS=30_000;
const local=new AsyncLocalStorage<CommandScope>();
/** Wall-clock budget, independent of the replay's historical clock. Never race a financial commit. */
export class CommandScope {
  readonly id=randomUUID();
  readonly controller=new AbortController();
  readonly started=Date.now();
  private end:number;
  constructor(readonly kind:string,budget=NATIVE_COMMAND_DEADLINE_MS){this.end=this.started+budget;}
  trace(stage:string,extra:Record<string,unknown>={}){
    console.info('[native-command]',JSON.stringify({requestId:this.id,kind:this.kind,stage,elapsedMs:Date.now()-this.started,...extra}));
  }
  check(){
    if(Date.now()>=this.end||this.controller.signal.aborted){
      this.controller.abort();
      throw new PrivateTradingError('native_command_timeout','Операция не выполнена: время ожидания истекло. Обновите состояние счёта.',503);
    }
  }
  async read<T>(stage:string,task:()=>Promise<T>):Promise<T>{
    this.check();this.trace(stage);
    const started=Date.now();
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      const timeout=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{
        this.controller.abort();
        reject(new PrivateTradingError('native_command_timeout','Операция не выполнена: время ожидания истекло. Обновите состояние счёта.',503));
      },Math.max(1,this.end-Date.now()));});
      const result=await Promise.race([Promise.resolve().then(task),timeout]);
      this.check();return result;
    }finally{if(timer)clearTimeout(timer);this.trace(stage+'.end',{durationMs:Date.now()-started,expired:this.controller.signal.aborted});}
  }
  run<T>(task:()=>Promise<T>){return local.run(this,task);}
}
export const commandScope=()=>local.getStore();
export const commandCheck=()=>local.getStore()?.check();
export const commandSignal=()=>local.getStore()?.controller.signal;
export const commandRead=<T>(stage:string,task:()=>Promise<T>):Promise<T>=>local.getStore()?.read(stage,task)??task();
