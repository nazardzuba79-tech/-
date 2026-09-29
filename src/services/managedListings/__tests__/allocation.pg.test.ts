import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { allocateManagedListing } from '../allocation';
import type { ManagedListing } from '../schema';
const url=process.env.VOLTEX_LISTINGS_TEST_URL;
if(url){const parsed=new URL(url);if(parsed.hostname!=='127.0.0.1'||parsed.pathname!=='/voltex_listings_test')throw new Error('Disposable loopback DB required');}
const pg=url?describe:describe.skip;
pg('explicit managed listing allocation on actual disposable PostgreSQL',()=>{
  let db:PrismaClient,owner:string,other:string,row:ManagedListing;
  const key=()=>`managed-listing:${row.id}:allocation:v1`;
  beforeAll(()=>{db=new PrismaClient({datasources:{db:{url}}});});
  beforeEach(async()=>{owner=randomUUID();other=randomUUID();await db.user.createMany({data:[{id:owner,email:`${owner}@example.invalid`,passwordHash:'fixture',referralCode:owner,role:'ADMIN'},{id:other,email:`${other}@example.invalid`,passwordHash:'fixture',referralCode:other,role:'USER'}]});
    row={id:randomUUID(),ticker:'QANEW',pair:'QANEW/USDT',name:'QA',logo:'',initialPrice:'0.025',listingAt:'2027-01-01T00:00:00Z',seed:'stable',revision:2,version:1,status:'published',createdAt:'2026-09-29T00:00:00Z',createdBy:owner,ownerAllocation:'12345.12345678'};
    await db.balance.create({data:{userId:owner,asset:'USDT',available:'200'}});
  });
  afterAll(async()=>{await db.$disconnect();});
  test('exact decimals; concurrent/repeated calls credit once, no USDT, demo balance or other user writes',async()=>{
    const result=await Promise.all([allocateManagedListing(db,row,owner,key()),allocateManagedListing(db,row,owner,key())]);
    expect(result.filter(r=>r.applied)).toHaveLength(1);
    expect((await db.balance.findUnique({where:{userId_asset:{userId:owner,asset:'QANEW'}}}))!.available.toString()).toBe('12345.12345678');
    expect((await db.balance.findUnique({where:{userId_asset:{userId:owner,asset:'USDT'}}}))!.available.toString()).toBe('200');
    expect(await db.balance.count({where:{userId:other}})).toBe(0);expect(await db.demoBalance.count()).toBe(0);
    await db.balance.update({where:{userId_asset:{userId:owner,asset:'QANEW'}},data:{available:'1'}});
    expect((await allocateManagedListing(db,row,owner,key())).applied).toBe(false);
    expect((await db.balance.findUnique({where:{userId_asset:{userId:owner,asset:'QANEW'}}}))!.available.toString()).toBe('1');
  });
  test('draft, non-admin, wrong idempotency key refuse without any inventory',async()=>{
    await expect(allocateManagedListing(db,{...row,status:'draft'},owner,key())).rejects.toThrow();
    await expect(allocateManagedListing(db,row,other,key())).rejects.toThrow();
    await expect(allocateManagedListing(db,row,owner,'wrong')).rejects.toThrow();
    await db.user.update({where:{id:other},data:{role:'ADMIN'}});
    await expect(allocateManagedListing(db,row,other,key())).rejects.toThrow('allocation_owner_required');
    expect(await db.balance.count({where:{asset:'QANEW',userId:owner}})).toBe(0);
  });
  test('audit failure rolls balance back atomically',async()=>{
    const broken={ $transaction:(fn:any)=>db.$transaction(async tx=>fn(new Proxy(tx,{get:(target,prop)=>prop==='auditLog'?{create:async()=>{throw new Error('receipt failure');},findUnique:target.auditLog.findUnique.bind(target.auditLog)}:(target as any)[prop]}))) } as PrismaClient;
    await expect(allocateManagedListing(broken,row,owner,key())).rejects.toThrow('receipt failure');
    expect(await db.balance.count({where:{asset:'QANEW',userId:owner}})).toBe(0);
  });
});
