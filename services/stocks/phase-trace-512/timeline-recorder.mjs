// Client process only; no server or worker import.
const enabled=process.env.STOCKS_TIMELINE_512==='1'&&process.env.STOCKS_TIMELINE_512_FIXTURE==='isolated-issue505';
export const MAX_ROWS=2048;
const rows=[];
let begun=0,ended=0,dropped=0;
const operations=new Map([['state',1],['chart',2],['history-page',3]]);
const failures=new Set(['DEADLINE_3000MS','ECONNRESET','ECONNREFUSED','ECONNABORTED','EPIPE','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','UND_ERR_SOCKET','ABORT_ERR','IDENTITY_MISMATCH','TIMEFRAME_MISMATCH','INVALID_CANDLES','SyntaxError','Error']);
const publicCodes=new Set(['SOURCE_BUSY','SOURCE_UNAVAILABLE','SOURCE_DNS_UNAVAILABLE','SOURCE_FORBIDDEN','RATE_LIMIT','RESPONSE_TOO_LARGE','INVALID_CANDLES','INVALID_DATA','INVALID_PAIR','INVALID_RANGE','UNSUPPORTED_TIMEFRAME','INSTRUMENT_UNVERIFIED','MARKET_CLOSED','QUOTE_UNAVAILABLE','FX_STALE','FX_UNAVAILABLE','MOEX_UNVERIFIED','AUTH_REQUIRED','AUTH_UNAVAILABLE','ACCOUNT_CAPACITY','ACCOUNT_NOT_FOUND','ACCOUNT_SELECTOR_FORBIDDEN','ACCOUNT_BUSY','ACCOUNT_QUEUE_FULL','ACCOUNT_QUEUE_TIMEOUT','ACCOUNT_UNAVAILABLE','ACCOUNT_WORKER_UNAVAILABLE','ACCOUNT_WORKER_TIMEOUT','ACCOUNT_STORAGE_ERROR','ACCOUNT_OUTCOME_UNKNOWN','ACCOUNT_COMMAND_INVALID','ACCOUNT_CONFIG_INVALID','HOST_FORBIDDEN','ORIGIN_FORBIDDEN','METHOD_NOT_ALLOWED','TOKEN_REQUIRED','JSON_REQUIRED','BODY_TOO_LARGE','INVALID_JSON','ROUTE_NOT_FOUND','LOCAL_SERVICE_ERROR','UNRECORDED']);
// [attempt,startMs,endMs,route,status,outcome,transportCode,publicCode,cancel,responseComplete]
// No headers, user/account/instrument identity, URL, response body or arbitrary error text.
export function begin(operation,relativeStart){
 if(!enabled)return null;
 const sequence=++begun;
 if(rows.length>=MAX_ROWS){dropped++;return null;}
 const row=[sequence,relativeStart,null,operations.get(operation)??0,0,0,null,null,0,0];rows.push(row);return row;
}
export function headers(row,status){if(row&&Number.isInteger(status)&&status>=100&&status<=599)row[4]=status;}
export function responseComplete(row){if(row)row[9]=1;}
export function publicError(row,code){if(row)row[7]=publicCodes.has(code)?code:'UNRECORDED';}
export function failure(row,error){if(!row)return;row[5]=2;const code=error?.code??error?.name;row[6]=failures.has(code)||typeof code==='string'&&/^HTTP_[1-5][0-9]{2}$/.test(code)?code:'UNRECORDED';}
export function cancellation(row,reason){if(row)row[8]=reason==='deadline'?1:reason==='response-bound'?2:3;}
export function finish(row,duration){if(!enabled)return;ended++;if(!row)return;row[2]=row[1]+duration;if(!row[5])row[5]=1;}
export function snapshot(){return {enabled,format:1,clock:'milliseconds relative to this reader run start; original performance.now samples',columns:['attempt','startMs','endMs','route','httpStatus','outcome','transportCode','publicCode','clientCancellation','responseComplete'],routes:{0:'other',1:'state',2:'chart',3:'history-page'},outcomes:{0:'incomplete',1:'success',2:'failure'},cancellations:{0:'none-observed',1:'client-deadline',2:'client-response-bound',3:'other-client-cancellation'},maxRows:MAX_ROWS,begun,ended,dropped,complete:enabled&&dropped===0&&begun===ended&&rows.every(row=>row[2]!==null),rows,notes:['Cancellation is only observed local req.destroy; it does not prove server-side cancellation.','Actual HTTP headers can precede a body timeout. responseComplete distinguishes existing summary status counts.','Client capture runs outside the service cgroup and its overhead remains unmeasured until validated.','Unknown transport/public error text is redacted; no request or response content is exported.']};}
