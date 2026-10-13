'use strict';
const net = require('node:net');
exports.installLoopbackDbGuard = function () {
  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    let a = args[0]; if (Array.isArray(a)) a = a[0];
    const host = typeof a === 'object' ? a.host : args[1], port = typeof a === 'object' ? a.port : a;
    if (!['127.0.0.1', 'localhost'].includes(host) || Number(port) !== 15432) throw Error('EXTERNAL_NETWORK_FORBIDDEN');
    return originalConnect.apply(this, args);
  };
  return () => { net.Socket.prototype.connect = originalConnect; };
};
