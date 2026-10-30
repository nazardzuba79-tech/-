import { PrismaClient } from '@prisma/client';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { copyStrategySocialsRouter } from '../copyStrategySocials';
import { resolveStrategyOwner } from '../../../services/copyTrading/strategyOwner';

const url = process.env.COPY_SOCIAL_TEST_URL;
const suite = /^postgresql:\/\/postgres@127\.0\.0\.1:\d+\/voltex_copy_social_test$/.test(url ?? '') ? describe : describe.skip;
suite('strategy social ownership on disposable PostgreSQL', () => {
  const db = new PrismaClient({ datasources: { db: { url: url || 'postgresql://unused' } } });
  const app = express(); app.use(express.json()); app.use(copyStrategySocialsRouter(db));
  let users: string[], sessions: string[], tokens: string[];
  let financialBefore: unknown;
  const financialState = async () => Promise.all(['Balance','DemoBalance','Order','Trade','CopyPerformanceScenario'].map(table => db.$queryRawUnsafe(`SELECT * FROM "${table}" ORDER BY "id"`)));
  const patch = (id: string, who: number, data: unknown) => request(app).patch('/copy-trading/socials/' + id).set('Authorization', 'Bearer ' + tokens[who]).send(data as object);
  beforeAll(async () => {
    users=[]; sessions=[]; tokens=[];
    for (let i=0;i<5;i++) {
      const user=await db.user.create({data:{email:`social-${randomUUID()}@example.invalid`,passwordHash:'fixture-only',referralCode:randomUUID(),role:i===4?'ADMIN':'USER'}});
      const session=await db.session.create({data:{userId:user.id}});
      users.push(user.id);sessions.push(session.id);tokens.push(jwt.sign({sub:user.id,sid:session.id},process.env.JWT_SECRET!,{expiresIn:'10m'}));
    }
    await db.balance.create({data:{userId:users[0],asset:'USDT',available:'123.456789',locked:'7.25'}});
    financialBefore=await financialState();
    for (const [i,id] of ['VX-001','VX-KSENIA','VX-VIP-3','VX-VIP-4'].entries()) await db.copyStrategyOwner.upsert({where:{traderId:id},create:{traderId:id,publicName:'Fixture',ownerUserId:users[i],premium:true},update:{ownerUserId:users[i],premium:true}});
  });
  afterAll(async () => { try { expect(await financialState()).toEqual(financialBefore); } finally { await db.$disconnect(); } });
  test('owners update/clear independently; repeated and concurrent writes do not create duplicates', async () => {
    for (const [i,id] of ['VX-001','VX-KSENIA'].entries()) {
      const reply=await patch(id,i,{xUrl:'twitter.com/Owner',telegramUrl:'@owner_test'}).expect(200);
      expect(reply.body).toEqual({traderId:id,xUrl:'https://x.com/owner',telegramUrl:'https://t.me/owner_test'});
      await patch(id,i,{xUrl:'twitter.com/Owner'}).expect(200);
      await patch(id,i,{xUrl:null}).expect(200);
      expect((await resolveStrategyOwner(db,id))?.telegramUrl).toBe('https://t.me/owner_test');
      await Promise.all([patch(id,i,{xUrl:'@updated'}).expect(200),patch(id,i,{telegramUrl:''}).expect(200)]);
      const saved=await db.copyStrategyOwner.findUniqueOrThrow({where:{traderId:id}});
      expect(saved.xUrl).toBe('https://x.com/updated');expect(saved.telegramUrl).toBeNull();
      expect(saved.ownerUserId).toBe(users[i]);expect(saved.premium).toBe(true);
    }
    expect(await db.copyStrategyOwner.count()).toBe(4);
  });
  test('stranger, other owner, extra VIP, ADMIN, missing binding and traderId tampering fail closed',async()=>{
    for (const who of [1,2,3,4]) await patch('VX-001',who,{xUrl:'@attacker'}).expect(403);
    for (const who of [0,2,3,4]) await patch('VX-KSENIA',who,{xUrl:'@attacker'}).expect(403);
    for (const [who,id] of [[2,'VX-VIP-3'],[3,'VX-VIP-4']] as const) {await patch(id,who,{xUrl:'@attacker'}).expect(403);expect(await resolveStrategyOwner(db,id)).toBeNull();}
    await patch('VX-001%20',0,{xUrl:'@attacker'}).expect(403);
    await db.copyStrategyOwner.update({where:{traderId:'VX-001'},data:{ownerUserId:null}});
    await patch('VX-001',0,{xUrl:'@attacker'}).expect(403);
    expect((await resolveStrategyOwner(db,'VX-001'))?.xUrl).toBeNull();
    await db.copyStrategyOwner.update({where:{traderId:'VX-001'},data:{ownerUserId:users[0]}});
  });
  test('rejects injected fields/URLs and does not alter financial tables',async()=>{
    const tables=['Balance','DemoBalance','Order','Trade','CopyPerformanceScenario'];
    const counts=async()=>Promise.all(tables.map(async table=>{return await db.$queryRawUnsafe(`SELECT * FROM "${table}" ORDER BY "id"`);}));
    const before=await counts();
    for (const value of ['javascript:alert(1)','data:text/html,x','tg://resolve','http://x.com/owner','https://x.com:443/owner','https://user@x.com/owner','https://t.me/+invite','https://evil.invalid/owner','https://t.me/joinchat','https://x.com/owner?next=evil']) await patch('VX-001',0,{xUrl:value}).expect(400);
    await patch('VX-001',0,{xUrl:'@owner',ownerUserId:users[4],premium:false}).expect(400);
    await patch('VX-001',0,{traderId:'VX-KSENIA'}).expect(400);
    expect(await counts()).toEqual(before);
    const publicIdentity=await resolveStrategyOwner(db,'VX-001');
    expect(Object.keys(publicIdentity!).sort()).toEqual(['traderId','displayName','avatarUrl','avatarVersion','verified','premium','xUrl','telegramUrl'].sort());
    expect(JSON.stringify(publicIdentity)).not.toContain(users[0]);
  });
  test('binding reassignment never publishes the previous owner links',async()=>{
    await db.copyStrategyOwner.update({where:{traderId:'VX-001'},data:{ownerUserId:users[2]}});
    expect((await resolveStrategyOwner(db,'VX-001'))?.xUrl).toBeNull();
    await patch('VX-001',0,{xUrl:'@owner'}).expect(403);
    await db.copyStrategyOwner.update({where:{traderId:'VX-001'},data:{ownerUserId:users[0]}});
  });
  test('logout/revocation, missing session, expired and no-exp tokens cannot edit',async()=>{
    await request(app).patch('/copy-trading/socials/VX-001').send({xUrl:'@owner'}).expect(401);
    for(const payload of [{sub:users[0]},{sub:users[0],sid:sessions[0]},{sub:users[0],sid:'missing',exp:Math.floor(Date.now()/1000)+100},{sub:users[0],sid:sessions[0],exp:1}]){
      await request(app).patch('/copy-trading/socials/VX-001').set('Authorization','Bearer '+jwt.sign(payload,process.env.JWT_SECRET!)).send({xUrl:'@owner'}).expect(401);
    }
    await db.session.update({where:{id:sessions[0]},data:{revokedAt:new Date()}});
    await patch('VX-001',0,{xUrl:'@owner'}).expect(401);
    await request(app).get('/copy-trading/socials/VX-001').set('Authorization','Bearer '+tokens[0]).expect(401);
  });
});
