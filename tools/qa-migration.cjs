const assert=require('assert/strict'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const R=path.resolve(__dirname,'..');const qa=require('module').createRequire(path.join(R,'api-source/node_modules/.cache/issue640-qa/package.json'));const {Client}=qa('pg');
const url=process.env.COPY_SOCIAL_TEST_URL;if(!/^postgresql:\/\/postgres@127\.0\.0\.1:\d+\/voltex_copy_social_test$/.test(url||''))throw Error('Loopback fixture only');
const db=new Client({connectionString:url});
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function main(){await db.connect();
 const {PrismaClient}=require(path.join(R,'api-source/node_modules/@prisma/client'));const prisma=new PrismaClient({datasources:{db:{url}}});
 const u=await prisma.user.create({data:{email:'migration-fixture@example.invalid',passwordHash:'fixture-only',referralCode:crypto.randomUUID()},select:{id:true}});
 await prisma.balance.create({data:{userId:u.id,asset:'USDT',available:'123.456789',locked:'7.25'}});await prisma.$disconnect();
 await db.query(`INSERT INTO "CopyStrategyOwner" ("traderId","publicName","premium","updatedAt") VALUES ('VX-001','Fixture Nazar',true,now()),('VX-KSENIA','Fixture Ksenia',true,now())`);
 const columns=()=>db.query(`SELECT table_name,column_name,data_type,is_nullable,column_default,ordinal_position FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`).then(r=>r.rows);
 const structures=()=>db.query(`SELECT 'constraint' AS kind,conname AS name,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace UNION ALL SELECT 'index',indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY 1,2,3`).then(r=>r.rows);
 const tables=(await db.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`)).rows.map(r=>r.tablename).filter(t=>t!=='_prisma_migrations');
 const snapshot=async()=>{const out={};for(const t of tables){const q='"'+t.replaceAll('"','""')+'"';out[t]=(await db.query(`SELECT COALESCE(jsonb_agg(to_jsonb(t) - 'xUrl' - 'telegramUrl' - 'socialOwnerUserId' ORDER BY to_jsonb(t)::text),'[]') AS rows FROM ${q} t`)).rows[0].rows;}return out;};
 const before={columns:await columns(),structures:await structures(),data:await snapshot()};
 const sql=fs.readFileSync(path.join(R,'artifacts/apply-only-socials.sql'),'utf8');
 const locker=new Client({connectionString:url}),blocked=new Client({connectionString:url});await locker.connect();await blocked.connect();
 await locker.query('BEGIN');await locker.query('LOCK TABLE "CopyStrategyOwner" IN ACCESS SHARE MODE');let lockError;
 try{await blocked.query(sql);}catch(e){lockError=e.code;await blocked.query('ROLLBACK');}finally{await locker.query('ROLLBACK');await locker.end();await blocked.end();}
 assert.equal(lockError,'55P03');assert.deepEqual(await columns(),before.columns);assert.equal((await db.query('SELECT count(*)::int n FROM "_prisma_migrations"')).rows[0].n,0);
 await db.query(sql);await db.query(sql); // repeat must be an exact validated no-op
 const after=await columns();const added=after.filter(r=>r.table_name==='CopyStrategyOwner'&&['xUrl','telegramUrl','socialOwnerUserId'].includes(r.column_name));
 assert.equal(added.length,3);assert(added.every(r=>r.data_type==='text'&&r.is_nullable==='YES'&&r.column_default===null));assert.deepEqual(after.filter(r=>!added.includes(r)),before.columns);
 assert.deepEqual(await structures(),before.structures);assert.deepEqual(await snapshot(),before.data);
 const receipt=await db.query('SELECT migration_name,checksum,applied_steps_count FROM "_prisma_migrations"');assert.equal(receipt.rows.length,1);
 fs.writeFileSync(path.join(R,'evidence/migration-18.6.json'),JSON.stringify({passed:true,version:(await db.query('SHOW server_version')).rows[0].server_version,source:'read-only production schema-only dump; synthetic rows only',lockTimeoutRollback:true,idempotentReplay:true,columnsAdded:added,otherSchemaUnchanged:true,allTableDataUnchanged:true,tableCount:tables.length,fixtureDataHash:hash(before.data),ledger:receipt.rows},null,2));
 await db.end();console.log('PASS: PostgreSQL 18.6 migration, lock failure rollback, replay, all table data and non-social schema preserved');
}
main().catch(e=>{console.error(e);process.exitCode=1;db.end().catch(()=>{});});
