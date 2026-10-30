// Test instrumentation only, loaded with --require into a spawned test process: records every
// HTTP request that process serves (time, method, path, final status) and prints the list on
// SIGUSR2. It never reads a body or a header value and changes no response.
const http = require('node:http');
const seen = [], emit = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, req, res) {
  if (event === 'request') {
    const entry = [Date.now(), req.method, String(req.url).split('?')[0], 0];
    seen.push(entry); res.once('finish', () => { entry[3] = res.statusCode; });
  }
  return emit.apply(this, arguments);
};
process.on('SIGUSR2', () => process.stdout.write('REQUEST_LOG ' + JSON.stringify(seen) + '\n'));
