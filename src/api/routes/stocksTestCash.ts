import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { timingSafeEqual, createPublicKey, createSecretKey } from 'crypto';
import { resolve } from 'path';
import { requireAuth, AuthedRequest } from '../middleware/auth';

interface Config { enabled?: boolean; issuer?: string; principals?: Array<{issuer:string;subject:string}>; gatewayKey?: string; secret?: string }
interface Actor { issuer:string;subject:string;userId:string;sessionId:string;expiresAt:number }
interface Authority { execute(actor:Actor,type:string,input?:unknown,options?:{signal?:AbortSignal;occurrenceId?:string}):Promise<any>; metrics():unknown }
export function stocksTestCashRouter(prisma: PrismaClient, config: Config = {}, injected?: Authority): Router {
  const router = Router(), enabled = config.enabled ?? process.env.STOCKS_TEST_CASH_ENABLED === 'true';
  if (!enabled) return router;
  const issuer = config.issuer ?? process.env.STOCKS_IDENTITY_ISSUER;
  const gatewayKey = config.gatewayKey ?? process.env.STOCKS_TEST_CASH_GATEWAY_KEY;
  const secret = config.secret ?? process.env.JWT_SECRET;
  const principals = config.principals ?? JSON.parse(process.env.STOCKS_TRADE_PRINCIPALS ?? 'null');
  if (!issuer || !secret || !gatewayKey || gatewayKey.length < 32 || !Array.isArray(principals) || principals.length !== 2) throw Error('STOCKS_AUTHORITY_CONFIG_INVALID');
  // Node24 is the pinned local integration runtime (native require(ESM)).
  // This lazy load is never reached by the default, disabled API surface.
  const authority: Authority = injected ?? require(resolve(__dirname, '../../../services/stocks-global/postgres-authority.mjs')).openPostgresAuthority(prisma, { issuer, tradePrincipals: principals });
  // Normalize the immutable key once; signature/expiry checks still run on every request.
  const verificationKey = (() => { try { return createPublicKey(secret); } catch { return createSecretKey(Buffer.from(secret)); } })();
  const auth = requireAuth(prisma);
  const actor = (req: AuthedRequest): Actor => {
    if (!req.userId || !req.sessionId) throw Object.assign(Error('AUTH_REQUIRED'), { code: 'AUTH_REQUIRED' });
    const payload = jwt.verify(req.headers.authorization!.slice(7), verificationKey) as jwt.JwtPayload;
    if (payload.sub !== req.userId || payload.sid !== req.sessionId || !Number.isSafeInteger(payload.exp)) throw Object.assign(Error('AUTH_REQUIRED'), { code: 'AUTH_REQUIRED' });
    return { issuer, subject: req.userId, userId: req.userId, sessionId: req.sessionId, expiresAt: payload.exp! * 1000 };
  };
  const failure = (res: any, error: any) => {
    const code = typeof error?.code === 'string' ? error.code : 'ACCOUNT_OUTCOME_UNKNOWN';
    const status = code.startsWith('AUTH_') ? 401 : code === 'ACCOUNT_NOT_BOUND' ? 403 : code === 'IDEMPOTENCY_CONFLICT' ? 409 : ['ACCOUNT_BUSY','ACCOUNT_UNAVAILABLE','ACCOUNT_STORAGE_ERROR','ACCOUNT_OUTCOME_UNKNOWN'].includes(code) ? 503 : 422;
    res.status(status).json({ error: code });
  };
  router.get('/stocks-test-cash/identity', auth, (req: AuthedRequest, res) => { try { const value = actor(req); res.set('Cache-Control','no-store').json({ issuer: value.issuer, subject: value.subject }); } catch (error) { failure(res,error); } });
  // This is a read of the same authority, available only to the two bindings.
  // No role promotion or change to Funding/real Wallet routes is involved.
  router.get('/stocks-test-cash/wallet', auth, async (req: AuthedRequest, res) => { try { const value=await authority.execute(actor(req),'readView'); res.set('Cache-Control','no-store').json({ asset:'USDT',...value.wallets.USDT,authorityCash:value.authorityCash }); } catch (error) { failure(res,error); } });
  router.post('/stocks-test-cash/command', auth, async (req: AuthedRequest, res) => {
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
      let result;
      try{
        const value=actor(req);
        result=cancellable||observation
          ? await authority.execute(value,body.type,body.input,{...(cancellable?{signal:controller.signal}:{}),...(body.occurrenceId?{occurrenceId:body.occurrenceId}:{})})
          : await authority.execute(value,body.type,body.input);
      }
      finally{req.off('aborted',disconnected);res.off('close',disconnected);}
      if(res.destroyed)return;
      res.set('Cache-Control','no-store').json({ value:result,metrics:authority.metrics() });
    } catch(error) { if(!res.destroyed)failure(res,error); }
  });
  return router;
}
