'use strict';
// Local process liveness only. Never an authority/readiness or cached user grant.
const http = require('node:http');
function healthcheck(port = Number(process.env.STOCKS_GLOBAL_PORT || 4437)) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return Promise.reject(Error('INVALID_PORT'));
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: '/__stocks_global/health', agent: false }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; if (body.length > 4096) req.destroy(Error('HEALTH_TOO_LARGE')); });
      res.on('error', reject);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (res.statusCode !== 200 || data.ok !== true || data.version !== 2 || data.accounts !== true) throw Error('UNHEALTHY');
          resolve();
        } catch (error) { reject(error); }
      });
    });
    const deadline = setTimeout(() => req.destroy(Error('HEALTH_TIMEOUT')), 1500);
    req.once('close', () => clearTimeout(deadline));
    req.once('error', reject);
  });
}
module.exports = { healthcheck };
if (require.main === module) healthcheck().catch(() => { process.exitCode = 1; });
