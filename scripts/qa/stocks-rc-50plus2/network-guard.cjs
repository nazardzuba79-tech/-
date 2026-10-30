'use strict';
// Test-process-only egress fence, never loaded by application startup.
const net=require('node:net'),path=require('node:path');
global.__rc50Network={blocked:0};
const realConnect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
 const normalized=Array.isArray(args[0])?args[0]:args,a=normalized[0];
 const host=typeof a==='object'?a.host??a.hostname:typeof normalized[1]==='string'?normalized[1]:'localhost';
 const socketPath=typeof a==='object'?a.path:typeof a==='string'?a:null;
 if(socketPath){
  const root=process.env.RC50_RUN_ROOT;
  if(!root||!path.resolve(socketPath).startsWith(path.resolve(root)+path.sep)){global.__rc50Network.blocked++;throw Error('RC50_EXTERNAL_OR_UNOWNED_SOCKET_DENIED');}
 }else if(!['127.0.0.1','localhost','::1'].includes(host)){global.__rc50Network.blocked++;throw Error('RC50_EXTERNAL_NETWORK_DENIED');}
 return realConnect.apply(this,args);
};
const realFetch=global.fetch;
global.fetch=function(input,options){
 const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.username||u.password){global.__rc50Network.blocked++;throw Error('RC50_EXTERNAL_FETCH_DENIED');}
 return realFetch(input,options);
};
