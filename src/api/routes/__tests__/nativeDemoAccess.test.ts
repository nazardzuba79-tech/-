import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { privateTradingRouter } from '../privateTrading';
import { assertOwner } from '../../../private-trading/access';
import { nativeCommandSchema } from '../../../private-trading/native/routes';
import { NATIVE_DEMO_MODEL } from '../../../private-trading/native/engine';

function fixture(){
 const config={enabled:true,ownerId:'owner'};
 const users:any={owner:{role:'ADMIN',blockedAt:null},otherAdmin:{role:'ADMIN',blockedAt:null},user:{role:'USER',blockedAt:null}};
 const sessions:any=Object.fromEntries(Object.keys(users).map(id=>['s-'+id,{id:'s-'+id,userId:id,revokedAt:null,lastSeenAt:new Date()}]));
 const touch=jest.fn(()=>{throw Error('Private persistence must not be reached');});
 const db:any={user:{findUnique:jest.fn(async({where}:any)=>users[where.id])},session:{findUnique:jest.fn(async({where}:any)=>sessions[where.id]),update:jest.fn(async()=>({}))},nativeDemoAccount:{findUnique:touch},nativeDemoRevision:{findUnique:touch},demoBalance:{findUnique:touch,updateMany:touch}};
 const market:any={instrument:touch,freshQuote:touch,history:touch};
 const service:any={store:{authorized:(actor:any)=>assertOwner(db,actor,()=>config)},market};
 const app=express();app.use(express.json());app.use('/api/v1',privateTradingRouter(db,service));
 const token=(id='owner',extra:any={},expiresIn:any='1h')=>jwt.sign({sub:id,sid:'s-'+id,...extra},process.env.JWT_SECRET!,{expiresIn});
 return{app,token,touch,config,sessions,users};
}
const open={kind:'OPEN',symbol:'BTCUSDT',side:'LONG',type:'MARKET',margin:'5000',leverage:'10',idempotencyKey:'native-test-key'};
const endpoints:[string,string,unknown][]=[['get','/state',{}],['post','/initialize',{idempotencyKey:'initialize-key',acceptedModel:NATIVE_DEMO_MODEL.version}],['post','/commands',open],['post','/cards',{positionId:'native-position'}],['get','/cards/1/native-position',{}]];
describe('native account server boundary',()=>{
 test.each(endpoints)('blocks every non-owner on %s %s before market/persistence',async(method,path,body)=>{const f=fixture();for(const id of ['otherAdmin','user']){const r=await(request(f.app) as any)[method]('/api/v1/private-trading/native'+path).auth(f.token(id),{type:'bearer'}).send(body);expect(r.status).toBe(403);expect(r.headers['cache-control']).toBe('private, no-store');}expect(f.touch).not.toHaveBeenCalled();});
 test('rejects missing, expired, 2FA-only and revoked sessions',async()=>{const f=fixture();expect((await request(f.app).get('/api/v1/private-trading/native/state')).status).toBe(401);for(const token of [f.token('owner',{},-1),f.token('owner',{purpose:'2fa'}),f.token('owner',{sid:undefined})])expect((await request(f.app).get('/api/v1/private-trading/native/state').auth(token,{type:'bearer'})).status).toBe(401);f.sessions['s-owner'].revokedAt=new Date();expect((await request(f.app).get('/api/v1/private-trading/native/state').auth(f.token(),{type:'bearer'})).status).toBe(401);expect(f.touch).not.toHaveBeenCalled();});
 test('owner flag and current ADMIN role are mandatory',async()=>{const f=fixture();f.config.enabled=false;expect((await request(f.app).get('/api/v1/private-trading/native/state').auth(f.token(),{type:'bearer'})).status).toBe(403);f.config.enabled=true;f.users.owner.role='USER';expect((await request(f.app).get('/api/v1/private-trading/native/state').auth(f.token(),{type:'bearer'})).status).toBe(403);expect(f.touch).not.toHaveBeenCalled();});
 test('schema rejects forged prices, capital, fees, funding and owner identity',()=>{expect(nativeCommandSchema.safeParse(open).success).toBe(true);for(const patch of [{ownerId:'owner'},{balance:'999999'},{fundingRate:'1'},{feeRate:'0'},{entryPrice:'1'},{effectiveOpenedAt:'2020-01-01'},{quantity:'1'}])expect(nativeCommandSchema.safeParse({...open,...patch}).success).toBe(false);});
 test('strict candle identity accepts no frontend financial snapshot',()=>{const candle={source:'BYBIT_LINEAR',interval:'1h',openTime:1789340400000,pricePoint:'CLOSE'};expect(nativeCommandSchema.safeParse({...open,candle}).success).toBe(true);for(const patch of [{price:'1'},{source:'BYBIT_TESTNET'},{pricePoint:'CUSTOM'}])expect(nativeCommandSchema.safeParse({...open,candle:{...candle,...patch}}).success).toBe(false);});
});
