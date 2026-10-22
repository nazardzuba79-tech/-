// A separate process is essential: an Express 4 rejection can terminate Node.
// No database, provider or production account is contacted by this fixture.
const fs = require('fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'route-failure-fixture-only';
process.env.EMAIL_VERIFICATION_SECRET = 'route-failure-email-fixture-only';
process.env.API_KEY_ENCRYPTION_SECRET = '0'.repeat(64);
global.fetch = () => { throw new Error('External network forbidden in route fixture'); };
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const scenario = JSON.parse(process.argv[2]);
if (scenario.configuredTreasury) process.env.BITCOIN_NATIVE_ASSET = 'BTC';
const failure = new Error('fixture dependency unavailable: private diagnostic');
let attempts = 0;
const reject = async () => { attempts++; throw failure; };
const service = new Proxy({}, { get: (_, key) => key === 'liveReference' ? null : reject });
const db = new Proxy({}, { get: (_, model) => {
  if (model === '$transaction') return reject;
  return new Proxy({}, { get: (_, operation) => async (args) => {
    if (scenario.configuredTreasury && model === 'treasuryWallet') return operation === 'findMany'
      ? [{ chain: 'bitcoin', address: 'fixture-address' }] : { address: 'fixture-address' };
    if (model === 'session' && operation === 'findUnique') return {
      id: 'fixture-session', userId: 'fixture-owner', revokedAt: null, lastSeenAt: new Date(),
    };
    if (!scenario.adminFailure && model === 'user' && operation === 'findUnique'
      && JSON.stringify(args.select) === '{"role":true}') return { role: 'ADMIN' };
    return reject();
  } });
} });
const factories = {
  marketData: () => require('../../marketData').marketDataRouter(db, service),
  cfd: () => require('../../cfd').cfdRouter(db, service, service, null),
  demoTrading: () => require('../../demoTrading').demoTradingRouter(db, service),
  portfolio: () => require('../../portfolio').portfolioRouter(db, service),
  adminUsers: () => require('../../adminUsers').adminUsersRouter(db, service),
  card: () => require('../../card').cardRouter(db, service),
  deposits: () => require('../../deposits').depositsRouter(db, service),
  adminDeposits: () => require('../../adminDeposits').adminDepositsRouter(db, service),
  kyc: () => require('../../kyc').kycRouter(db, { configured: reject, verify: scenario.edgeFailure ? reject : async () => 'ok' }),
};
const app = express();
app.use(express.json());
app.use('/api/v1', factories[scenario.router]?.() ?? require('../../' + scenario.router)[scenario.router + 'Router'](db));
let forwarded = 0;
app.use((err, _req, res, _next) => {
  if (err !== failure) { console.error(err); process.exitCode = 2; }
  forwarded++;
  res.status(500).json({ error: 'Internal server error' });
});
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
(async () => {
  let req = request(app)[scenario.method || 'get']('/api/v1' + scenario.path)
    .set('Authorization', 'Bearer ' + jwt.sign({ sub: 'fixture-owner', sid: 'fixture-session' }, process.env.JWT_SECRET))
    .timeout({ deadline: 3000 });
  if (scenario.apiKey) req = req.set('X-API-KEY', 'fixture-key').set('X-API-TIMESTAMP', String(Date.now())).set('X-API-SIGNATURE', '00');
  if (scenario.edgeFailure) req = req.set('Content-Type', 'application/vnd.voltex.kyc-edge+json').send('{}');
  else if (scenario.pending2fa) req = req.send({ code: '123456', pendingToken: jwt.sign({ sub: 'fixture-owner', purpose: 'pending_2fa' }, process.env.JWT_SECRET) });
  else if (scenario.body) req = req.send(scenario.body);
  const response = await req;
  const health = await request(app).get('/health').timeout({ deadline: 1000 });
  console.log(JSON.stringify({ status: response.status, body: response.body, forwarded, attempts, health: health.body }));
})().catch(error => { console.error(error); process.exitCode = 3; });
