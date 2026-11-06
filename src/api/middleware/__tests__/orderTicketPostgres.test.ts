/** Disposable PostgreSQL 18.6 (PGlite WASM), not production or native Prisma/TLS
 * validation. Actual SQL verifies session admission and unchanged financial
 * fixture rows. Services are tripwires: a rejected request must never call them. */
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { requireAuth } from '../auth';
import { requireOrderTicketTrader } from '../orderTicketAccess';

const enabled = !!process.env.QA_PGLITE_MODULE;
(enabled ? describe : describe.skip)('PostgreSQL isolated viewer mutation boundary', () => {
  let pg: any;
  let previous: NodeJS.ProcessEnv;
  const owner = '20000000-0000-4000-8000-000000000001';
  const tester = '20000000-0000-4000-8000-000000000002';
  const viewer = '20000000-0000-4000-8000-000000000003';
  const secret = process.env.JWT_SECRET!;
  beforeAll(async () => {
    previous = { ...process.env };
    Object.assign(process.env, { PRIVATE_TRADING_ENABLED: 'true', PRIVATE_TRADING_OWNER_ID: owner, PRIVATE_TRADING_TEST_USER_IDS: tester });
    const { PGlite } = require(process.env.QA_PGLITE_MODULE!);
    pg = new PGlite();
    await pg.exec(`CREATE TABLE "User" (id text PRIMARY KEY, role text, "blockedAt" timestamptz);
      CREATE TABLE "Session" (id text PRIMARY KEY, "userId" text, "revokedAt" timestamptz, "lastSeenAt" timestamptz);
      CREATE TABLE "Balance" ("userId" text, asset text, available numeric(36,18), locked numeric(36,18));
      CREATE TABLE "DemoBalance" (LIKE "Balance");
      CREATE TABLE "Order" (id text, "userId" text, quantity numeric, status text);
      CREATE TABLE "DemoOrder" (LIKE "Order");
      CREATE TABLE "FuturesOrder" (LIKE "Order");
      CREATE TABLE "Trade" (id text, "userId" text, quantity numeric);
      CREATE TABLE "DemoTrade" (LIKE "Trade");`);
    for (const id of [owner,tester,viewer]) {
      await pg.query('INSERT INTO "User" VALUES ($1,$2,NULL)', [id,id===owner?'ADMIN':'USER']);
      await pg.query('INSERT INTO "Session" VALUES ($1,$2,NULL,now())', [`s:${id}`,id]);
      for (const table of ['Balance','DemoBalance']) await pg.query(`INSERT INTO "${table}" VALUES ($1,'USDT',1000,0)`,[id]);
    }
  },30000);
  afterAll(async () => { await pg?.close(); process.env=previous; });
  const snapshot=async()=>{
    const rows: any={};
    for(const table of ['Balance','DemoBalance','Order','DemoOrder','FuturesOrder','Trade','DemoTrade']) rows[table]=(await pg.query(`SELECT * FROM "${table}" ORDER BY "userId"`)).rows;
    return rows;
  };
  test('viewer/forgery/revocation fail without changing any financial row; two identities pass the gate',async()=>{
    const version=(await pg.query('select version()')).rows[0].version;
    expect(version).toContain('PostgreSQL 18.6');
    const db={
      session:{findUnique:async({where}:any)=>(await pg.query('SELECT *,false AS remembered FROM "Session" WHERE id=$1',[where.id])).rows[0]},
      $queryRaw:async(strings:TemplateStringsArray,...values:unknown[])=>(await pg.query(strings.reduce((sql,part,i)=>sql+(i?'$'+i:'')+part,''),values)).rows,
    } as any;
    const app=express(), executed=jest.fn((_req,res)=>res.json({allowed:true}));
    app.use(express.json(),requireAuth(db),requireOrderTicketTrader(db));
    app.post('/execution',executed);
    const bearer=(id:string,sid=`s:${id}`)=>`Bearer ${jwt.sign({sub:id,sid},secret,{expiresIn:3600})}`;
    const before=await snapshot();
    for(let i=0;i<5;i++) expect((await request(app).post('/execution').set('Authorization',bearer(viewer)).send({userId:owner,quantity:'100',admitted:true})).status).toBe(403);
    expect((await request(app).post('/execution').set('Authorization',bearer(viewer,`s:${owner}`))).status).toBe(401);
    expect(executed).not.toHaveBeenCalled();
    for(const id of [owner,tester]) expect((await request(app).post('/execution').set('Authorization',bearer(id))).status).toBe(200);
    expect(executed).toHaveBeenCalledTimes(2);
    await pg.query('UPDATE "Session" SET "revokedAt"=now() WHERE id=$1',[`s:${tester}`]);
    expect((await request(app).post('/execution').set('Authorization',bearer(tester))).status).toBe(401);
    expect(executed).toHaveBeenCalledTimes(2);
    expect(await snapshot()).toEqual(before);
  });
});
