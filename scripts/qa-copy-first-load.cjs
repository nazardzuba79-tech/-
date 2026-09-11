/** Local first-load measurements. Real compiled router/service/auth, isolated
 * in-memory persistence. No production credentials, DB or financial writes.
 * Build backend + frontend first. node scripts/qa-copy-first-load.cjs [dist] [port]
 * Open /copy-trading?run=name&delay=4000&chunkDelay=800. delay is an explicit
 * transport hold, not a claimed backend latency. /__qa/report/name exports it.
 */
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { Worker } = require('node:worker_threads');
const express = require('express');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = randomBytes(32).toString('hex');
delete process.env.DATABASE_URL;
delete process.env.DIRECT_URL;
const { copyPerformanceRouter } = require('../dist/api/routes/copyPerformance');
const root = path.resolve(__dirname, '..');
const dist = path.resolve(process.argv[2] || path.join(root, 'frontend/dist'));
const port = Number(process.argv[3] || 4197);
const runs = new Map();
const worker = new Worker(path.join(__dirname,'qa-copy-service-worker.cjs'));
let taskId = 0;
const pending = new Map();
worker.on('message',message => {
  const task=pending.get(message.id);pending.delete(message.id);
  if(message.error)task.reject(new Error(message.error));
  else {task.run.sections.push({name:task.strategy,ms:message.ms});task.resolve(message.data);}
});
const session = { id: 'local-first-load', userId: 'local-viewer', revokedAt: null, lastSeenAt: new Date() };
const db = {
  // No catalogue artwork impersonates an owner. Initials are the fixture.
  copyStrategyOwner: {async findUnique({where}) { return {publicName: where.traderId === 'VX-001' ? 'Nazar' : 'Ksenia', ownerUserId: null, premium: true}; }},
  user: {async findUnique() { return null; }},
  session: {async findUnique() { return session; }, async update() { return session; }},
};
const token = jwt.sign({sub: session.userId, sid: session.id}, process.env.JWT_SECRET, {expiresIn:'4h'});
const app = express();
app.use(express.json({limit:'1mb'}));
app.use((req, res, next) => {
  if (req.query.run) {
    const name = String(req.query.run).replace(/[^a-z0-9_-]/gi, '');
    if (!runs.has(name)) runs.set(name, {name, delay:Number(req.query.delay || 0), chunkDelay:Number(req.query.chunkDelay || 0), fail:req.query.fail === '1', requests:[], sections:[], browser:null});
    res.cookie('copy_qa_run', name); req.qaRun = runs.get(name);
  } else req.qaRun = runs.get((req.headers.cookie || '').match(/copy_qa_run=([^;]+)/)?.[1]);
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.get('/__qa/report/:name', (req,res) => res.json(runs.get(req.params.name) || {}));
app.post('/__qa/report/:name', (req,res) => {
  const run = runs.get(req.params.name); if (run) run.browser = req.body;
  res.sendStatus(204);
});
app.use('/api/v1', (req,res,next) => {
  if (req.method !== 'GET') return res.sendStatus(405);
  const run = req.qaRun;
  const entry = {path:req.path, start:performance.now()};
  run?.requests.push(entry);
  if (req.path !== '/copy-trading/marketplace') return next();
  // Fresh service per run: cold projection followed by warm refreshes.
  if (!run.router) {
    const service = {get:strategy => new Promise((resolve,reject) => {
      const id=++taskId;pending.set(id,{run,strategy,resolve,reject});worker.postMessage({id,run:run.name,strategy});
    })};
    run.router = copyPerformanceRouter(db, service);
  }
  const send = res.json.bind(res);
  res.json = body => {
    entry.backendMs = performance.now() - entry.start;
    entry.bytes = Buffer.byteLength(JSON.stringify(body));
    // JSON serializable report, with no router or auth material.
    setTimeout(() => { if (!res.destroyed) { if(run.fail) res.status(503); send(run.fail ? {error:'QA forced failure'} : body); } }, run.delay);
    return res;
  };
  run.router(req,res,next);
});
app.get('/api/v1/me', (_req,res) => res.json({id:session.userId, displayName:'Local QA', email:'qa@example.invalid', kycStatus:'NOT_STARTED', isAdmin:false, avatarUrl:null}));
app.get('/api/v1/wallet/portfolio-history', (_req,res) => res.json({points:[]}));
app.get(['/api/v1/balances','/api/v1/futures/balances'], (_req,res) => res.json([]));
app.get('/api/v1/support/conversations/mine', (_req,res) => res.json({conversation:null}));
app.get('/api/v1/market/external/tickers', (_req,res) => res.json({tickers:[]}));
app.get('/api/v1/*', (_req,res) => res.json([]));
app.get('/__qa/preload.js', (_req,res) => res.type('js').send(`localStorage.setItem('exchange_token',${JSON.stringify(token)});localStorage.setItem('exchange_lang','ru');\n` + fs.readFileSync(path.join(__dirname,'qa-copy-first-load-preload.js'),'utf8')));
app.use((req,res,next) => {
  if (/CopyTradingPage.*\.js$/.test(req.path) && req.qaRun?.chunkDelay) return setTimeout(next, req.qaRun.chunkDelay);
  next();
});
app.use(express.static(dist, {index:false}));
app.get('*', (_req,res) => res.type('html').send(fs.readFileSync(path.join(dist,'index.html'),'utf8').replace('<head>', '<head><script src="/__qa/preload.js"></script>')));
// Omit the Express router, which is neither measurement nor serializable data.
app.set('json replacer', (key,value) => key === 'router' ? undefined : value);
app.listen(port,'127.0.0.1',() => console.log(`Copy first-load QA: http://127.0.0.1:${port}/copy-trading?run=baseline&delay=4000&chunkDelay=800`));
