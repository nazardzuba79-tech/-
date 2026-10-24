import WebSocket from 'ws';
// One bounded public instrument snapshot per shared catalogue refresh. The
// full instrument channel is larger than a ticker; its separate 2 MiB bound
// does not relax the 256 KiB quote/decompression bound. Close after metadata.
export function krakenInstrumentSnapshot({WebSocketImpl=WebSocket,signal}={}) {
  return new Promise((resolve,reject)=>{
    const ws=new WebSocketImpl('wss://ws.kraken.com/v2',{maxPayload:2*1048576,perMessageDeflate:false,handshakeTimeout:5000});let done=false;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);ws.removeAllListeners();ws.on('error',()=>{});ws.terminate();error?reject(error):resolve(value);};
    const abort=()=>finish(Error('SOURCE_CANCELLED')),timer=setTimeout(()=>finish(Error('INSTRUMENT_TIMEOUT')),6500);timer.unref?.();
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
    ws.on('open',()=>ws.send(JSON.stringify({method:'subscribe',params:{channel:'instrument',include_tokenized_assets:true}})));
    ws.on('message',b=>{try{if(b.length>2*1048576)throw Error('INSTRUMENT_SIZE');const j=JSON.parse(b.toString());if(j.channel==='instrument'){if(!Array.isArray(j.data?.pairs)||j.data.pairs.length>15000)throw Error('INSTRUMENT_INVALID');finish(null,j.data.pairs.filter(p=>/^[A-Z0-9]{1,24}x\/USD$/.test(p.symbol)&&p.base===p.symbol.split('/')[0]&&p.quote==='USD'&&p.status==='online'));}else if(j.success===false)throw Error('INSTRUMENT_REJECTED');}catch(e){finish(e);}});
    ws.on('error',()=>finish(Error('INSTRUMENT_TRANSPORT')));ws.on('close',()=>finish(Error('INSTRUMENT_CLOSED')));
  });
}
