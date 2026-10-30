import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { timingSafeEqual, createPublicKey, createSecretKey } from 'crypto';
import { resolve } from 'path';
import { requireAuth, requireAuthBatch, verifiedBearerAtUse, AuthedRequest } from '../middleware/auth';

/** One identity batch: the gateway's own bound (authority-adapter.mjs) and the bearer form it sends. */
export const IDENTITY_BATCH_MAX = 64, IDENTITY_BATCH_BYTES = 64 * 1024;
const BEARER = /^[A-Za-z0-9._~-]{16,4096}$/;
interface Config { catalogueEnabled?: boolean; enabled?: boolean; orderExecutionEnabled?: boolean; issuer?: string; principals?: Array<{issuer:string;subject:string}>; gatewayKey?: string; secret?: string }
interface Actor { issuer:string;subject:string;userId:string;sessionId:string;expiresAt:number }
interface Authority { execute(actor:Actor,type:string,input?:unknown,options?:{signal?:AbortSignal;occurrenceId?:string}):Promise<any>; metrics():unknown }
export function stocksTestCashRouter(prisma: PrismaClient, config: Config = {}, injected?: Authority): Router {
  const router = Router(), enabled = config.enabled ?? process.env.STOCKS_TEST_CASH_ENABLED === 'true';
  const catalogueEnabled = config.catalogueEnabled ?? process.env.STOCKS_CATALOGUE_ENABLED === 'true';
  // Visibility and wallet reads never grant stock order execution. Owner-approved trading
  // requires a second explicit server gate, independent of the catalogue gate (default OFF).
  const orderExecutionEnabled = config.orderExecutionEnabled ?? process.env.STOCKS_ORDER_EXECUTION_ENABLED === 'true';
  if (!enabled && !catalogueEnabled) return router;
  const issuer = config.issuer ?? process.env.STOCKS_IDENTITY_ISSUER;
  const gatewayKey = config.gatewayKey ?? process.env.STOCKS_TEST_CASH_GATEWAY_KEY;
  const secret = config.secret ?? process.env.JWT_SECRET;
  const principals = config.principals ?? JSON.parse(process.env.STOCKS_TRADE_PRINCIPALS ?? 'null');
  if (!issuer || !secret || !gatewayKey || gatewayKey.length < 32 || !Array.isArray(principals) || principals.length !== 2) throw Error('STOCKS_AUTHORITY_CONFIG_INVALID');
  // Node 22.23.3 supports this synchronous require(ESM) path.
  // This lazy load is never reached by the default, disabled API surface.
  const authority: Authority = injected ?? require(resolve(__dirname, '../../../services/stocks-global/postgres-authority.mjs')).openPostgresAuthority(prisma, { issuer, tradePrincipals: principals });
  // A release readiness assertion is offered only by the real PostgreSQL path.
  // No account creation, balance read/write, session decision or cached grant.
  if (!injected) {
    const { releasePrincipals, principalsDigest } = require(resolve(__dirname, '../../../services/stocks-global/release-config.mjs'));
    const bindings = releasePrincipals(issuer, principals);
    router.get('/stocks-test-cash/readiness', async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const provided = Buffer.from(String(req.headers['x-stocks-authority-key'] ?? ''));
      const expected = Buffer.from(gatewayKey);
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
        res.status(401).json({ error: 'AUTH_REQUIRED' }); return;
      }
      try {
        const users = await prisma.user.findMany({ where: { id: { in: bindings.map((p: {subject:string}) => p.subject) }, blockedAt: null }, select: { id: true } });
        if (users.length !== 2) throw Error('BINDINGS_UNVERIFIED');
        // Catalogue-only identity uses the existing User/Session authority and
        // never reads financial accounts. Do not require trading DDL or cash
        // merely to view the terminal. Wallet/command authority still requires
        // all three tables, even while its separate execution gate is OFF.
        if (enabled) {
          await prisma.$queryRawUnsafe('SELECT "principalHash" FROM "StocksTestAccount" WHERE false');
          await prisma.$queryRawUnsafe('SELECT "principalHash" FROM "StocksTestReceipt" WHERE false');
          await prisma.$queryRawUnsafe('SELECT "principalHash" FROM "StocksTestAudit" WHERE false');
        }
        // «Trading» means order execution: the gateway grants canTrade from this alone, so test-cash
        // wallets without the second gate leave every account a silent viewer (owner policy, #558).
        res.json({ version: 1, authority: 'postgres', tradingEnabled: enabled && orderExecutionEnabled, issuer, principalsDigest: principalsDigest(bindings) });
      } catch { res.status(503).json({ error: 'STOCKS_AUTHORITY_UNREADY' }); }
    });
  }
  // Normalize the immutable key once; signature/expiry checks still run on every request.
  const verificationKey = (() => { try { return createPublicKey(secret); } catch { return createSecretKey(Buffer.from(secret)); } })();
  // Every gateway request (viewer polls included) re-validates the session here,
  // so the session, owner and contact-block checks are read in one query.
  const auth = requireAuth(prisma, { prepareVerificationKey: true, singleSessionRead: true });
  const authBatch = requireAuthBatch(prisma);
  const actor = (req: AuthedRequest): Actor => {
    if (!req.userId || !req.sessionId) throw Object.assign(Error('AUTH_REQUIRED'), { code: 'AUTH_REQUIRED' });
    // Judged at use: the bearer requireAuth verified in this request is re-checked now
    // (not-before/expiry, then the binding below). Only its signature is not verified
    // again, and only for the same token text and key; anything else is verified in full.
    const payload = verifiedBearerAtUse(req, secret) ?? jwt.verify(req.headers.authorization!.slice(7), verificationKey) as jwt.JwtPayload;
    if (payload.sub !== req.userId || payload.sid !== req.sessionId || !Number.isSafeInteger(payload.exp)) throw Object.assign(Error('AUTH_REQUIRED'), { code: 'AUTH_REQUIRED' });
    return { issuer, subject: req.userId, userId: req.userId, sessionId: req.sessionId, expiresAt: payload.exp! * 1000 };
  };
  const failure = (res: any, error: any) => {
    const code = typeof error?.code === 'string' ? error.code : 'ACCOUNT_OUTCOME_UNKNOWN';
    const status = code.startsWith('AUTH_') ? 401 : code === 'ACCOUNT_NOT_BOUND' ? 403 : code === 'IDEMPOTENCY_CONFLICT' ? 409 : ['ACCOUNT_BUSY','ACCOUNT_UNAVAILABLE','ACCOUNT_STORAGE_ERROR','ACCOUNT_OUTCOME_UNKNOWN'].includes(code) ? 503 : 422;
    res.status(status).json({ error: code });
  };
  router.get('/stocks-test-cash/identity', auth, (req: AuthedRequest, res) => { try { const value = actor(req); res.set('Cache-Control','no-store').json({ issuer: value.issuer, subject: value.subject }); } catch (error) { failure(res,error); } });
  // The identity checks of several concurrent gateway requests in ONE private request
  // (multiplexing, not caching): every bearer gets the very same requireAuth judgement and
  // actor binding as GET identity above, after its browser request arrived; the sessions of the
  // batch are read in one query (requireAuthBatch). Nothing is kept between bearers or requests.
  // Gateway capability only; no user bearer here.
  router.post('/stocks-test-cash/identities', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const supplied = req.headers['x-stocks-authority-key'];
    if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(gatewayKey) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(gatewayKey))) return void res.status(403).json({ error: 'AUTH_REQUIRED' });
    const tokens = req.body?.tokens;
    if (!req.body || typeof req.body !== 'object' || Object.keys(req.body).length !== 1 || !Array.isArray(tokens) || tokens.length < 1 || tokens.length > IDENTITY_BATCH_MAX
      || tokens.some((token: unknown) => typeof token !== 'string' || !BEARER.test(token)) || new Set(tokens).size !== tokens.length || Buffer.byteLength(JSON.stringify(tokens)) > IDENTITY_BATCH_BYTES)
      return void res.status(422).json({ error: 'IDENTITY_BATCH_INVALID' });
    try {
      const results = [];
      for (const one of await authBatch(tokens as string[])) {
        if ('status' in one && typeof one.status === 'number') { results.push({ error: one.status === 503 ? 'AUTH_UNAVAILABLE' : 'AUTH_REQUIRED' }); continue; }
        try { const value = actor(one as AuthedRequest); results.push({ issuer: value.issuer, subject: value.subject }); }
        catch (error: any) { results.push({ error: typeof error?.code === 'string' && error.code.startsWith('AUTH_') ? error.code : 'AUTH_REQUIRED' }); }
      }
      res.json({ results });
    } catch {
      // Fail closed for the whole batch; the gateway answers every waiting request AUTH_UNAVAILABLE.
      if (!res.headersSent) res.status(503).json({ error: 'AUTH_UNAVAILABLE' });
    }
  });
  // Catalogue/identity access never grants a financial capability. Off means no
  // wallet or command route, even for an allowed principal or forged gateway call.
  if (!enabled) {
    router.all(['/stocks-test-cash/wallet','/stocks-test-cash/command'], auth, (_req, res) => { res.status(403).json({ error: 'STOCKS_TRADING_DISABLED' }); });
    return router;
  }
  // This is a read of the same authority, available only to the two bindings.
  // No role promotion or change to Funding/real Wallet routes is involved.
  router.get('/stocks-test-cash/wallet', auth, async (req: AuthedRequest, res) => { try { const value=await authority.execute(actor(req),'readView'); res.set('Cache-Control','no-store').json({ asset:'USDT',...value.wallets.USDT,authorityCash:value.authorityCash }); } catch (error) { failure(res,error); } });
  router.post('/stocks-test-cash/command', auth, async (req: AuthedRequest, res) => {
    if (!orderExecutionEnabled) return res.status(403).json({ error: 'ACCOUNT_TRADING_DISABLED' });
    try {
      const supplied = req.headers['x-stocks-authority-key'];
      if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(gatewayKey) || !timingSafeEqual(Buffer.from(supplied),Buffer.from(gatewayKey))) return res.status(403).json({error:'AUTH_REQUIRED'});
      const body=req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key=>!['type','input','occurrenceId'].includes(key)) || typeof body.type !== 'string' || Buffer.byteLength(JSON.stringify(body))>8192) return res.status(422).json({error:'ACCOUNT_COMMAND_INVALID'});
      const observation=['observe','observeFailed','observeBackground','observeFailedBackground'].includes(body.type);
      if(body.occurrenceId!==undefined&&(!observation||typeof body.occurrenceId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(body.occurrenceId)))return res.status(422).json({error:'ACCOUNT_COMMAND_INVALID'});
      const cancellable=['readView','portfolioView','observe'].includes(body.type),controller=new AbortController();
      const disconnected=()=>{if(!res.writableFinished)controller.abort();};
      if(cancellable){req.once('aborted',disconnected);res.once('close',disconnected);if(req.aborted||res.destroyed)controller.abort();}
      let result,bound:Actor;
      try{
        const value=bound=actor(req);
        result=cancellable||observation
          ? await authority.execute(value,body.type,body.input,{...(cancellable?{signal:controller.signal}:{}),...(body.occurrenceId?{occurrenceId:body.occurrenceId}:{})})
          : await authority.execute(value,body.type,body.input);
      }
      finally{req.off('aborted',disconnected);res.off('close',disconnected);}
      if(res.destroyed)return;
      // The actor this command was bound to (the same issuer/subject as GET identity): the gateway
      // confirms with it that the request it served belongs to that principal (authority-adapter.mjs).
      res.set('Cache-Control','no-store').json({ value:result,metrics:authority.metrics(),actor:{ issuer:bound.issuer,subject:bound.subject } });
    } catch(error) { if(!res.destroyed)failure(res,error); }
  });
  return router;
}
