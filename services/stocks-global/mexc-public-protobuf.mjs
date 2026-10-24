// Bounded public-only decoder, derived from the vendored Apache-2.0 schemas.
// mexcdevelop/websocket-proto@0c9c4f35dd0fadc3a46a350e909a93379d81e811
// Unknown public fields are skipped by protobuf wire type; private oneofs are
// never interpreted. No JSON fallback for a binary frame.
const MAX=256*1024;
function fields(input) {
  const b=Buffer.from(input); if(b.length>MAX)throw Error('FRAME_TOO_LARGE');
  let p=0,count=0; const out=new Map();
  const integer=()=>{let n=0n;for(let k=0;k<10;k++){if(p>=b.length)throw Error('PROTO_TRUNCATED');const v=b[p++];n|=BigInt(v&127)<<BigInt(k*7);if(!(v&128))return n;}throw Error('PROTO_VARINT');};
  while(p<b.length){if(++count>128)throw Error('PROTO_FIELDS');const tag=integer(),id=Number(tag>>3n),wire=Number(tag&7n);if(!id)throw Error('PROTO_TAG');let value;
    if(wire===0)value=integer();else if(wire===2){const n=Number(integer());if(!Number.isSafeInteger(n)||n<0||p+n>b.length)throw Error('PROTO_LENGTH');value=b.subarray(p,p+n);p+=n;}
    else if(wire===1||wire===5){p+=wire===1?8:4;if(p>b.length)throw Error('PROTO_TRUNCATED');continue;}else throw Error('PROTO_WIRE');
    if(out.has(id))throw Error('PROTO_DUPLICATE_FIELD');out.set(id,value);
  }return out;
}
const text=(m,k)=>Buffer.isBuffer(m.get(k))?m.get(k).toString('utf8'):undefined;
const number=(m,k)=>{const v=m.get(k);if(v===undefined)return undefined;const n=Number(v);if(!Number.isSafeInteger(n))throw Error('PROTO_INTEGER');return n;};
export function decodeMexcPublic(input) {
  const m=fields(input),channel=text(m,1),symbol=text(m,3),timestamp=number(m,6)??number(m,5);
  if([304,306,307].some(k=>m.has(k)))throw Error('PROTO_PRIVATE_BODY');
  const allowed=[305,308,309,315].filter(k=>m.has(k));if(allowed.length!==1)throw Error('PROTO_PUBLIC_BODY');
  const kind=allowed[0],d=fields(m.get(kind));let data;
  if(kind===305||kind===315)data={bid:text(d,1),bidSize:text(d,2),ask:text(d,3),askSize:text(d,4),sequence:kind===315?text(d,5):undefined};
  if(kind===309)data={symbol:text(d,1),last:text(d,2),change24h:Number(text(d,4))*100,volume:text(d,8)};
  if(kind===308)data={interval:text(d,1),time:number(d,2),open:text(d,3),close:text(d,4),high:text(d,5),low:text(d,6),volume:text(d,7)};
  return {channel,symbol,timestamp,kind,data};
}
