// Loopback only. Actual production auth router/limiters; deliberately invalid
// form so no user lookup, password work, session creation or storage is allowed.
process.env.JWT_SECRET = 'ru-ip-chain-synthetic-only';
require('ts-node/register/transpile-only');
const express = require('express');
const { authRouter } = require('../../src/api/routes/auth');
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
const forbidden = new Proxy({}, { get() { throw Error('No storage allowed in IP-chain test'); } });
app.use('/api/v1', authRouter(forbidden, {countryDetection:{detect:async()=>null}}));
app.get('/api/v1/kyc/me', (req, res) => res.json({ip:req.ip,xff:req.get('x-forwarded-for')}));
const server = app.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
