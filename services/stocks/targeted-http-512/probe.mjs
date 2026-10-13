// Runs in the authority cgroup; shares only the service's network=none namespace.
import http from 'node:http';
const port=Number(process.argv[2]),path=process.argv[3];
if (!Number.isInteger(port) || port<1024 || port>65535 || !['/metrics','/trace','/ledger-proof'].includes(path)) throw Error('PROBE_NOT_ALLOWED');
let bytes=0,body='';
const req=http.get({hostname:'127.0.0.1',port,path,agent:false,headers:{'X-Fixture-Control':process.env.TARGETED_NONCE}},res=>{
  res.on('data',chunk=>{bytes+=chunk.length;if(bytes>8*1024*1024)req.destroy(Error('PROBE_RESPONSE_BUDGET'));else body+=chunk.toString();});
  res.once('end',()=>{clearTimeout(timer);if(res.statusCode!==200)throw Error('PROBE_HTTP_'+res.statusCode);JSON.parse(body);process.stdout.write(body);});
  res.once('error',error=>{throw error;});
});
const timer=setTimeout(()=>req.destroy(Error('PROBE_DEADLINE')),4000);
req.once('error',error=>{clearTimeout(timer);throw error;});
