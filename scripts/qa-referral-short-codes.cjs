/** Alias migration test: isolated schema in the explicitly named loopback QA DB. */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { Client, Pool } = require(process.env.QA_PG_MODULE || 'pg');
const url = new URL(process.env.DATABASE_URL || 'https://invalid');
if (process.env.REFERRAL_REGION_QA !== '1' || !['127.0.0.1','localhost'].includes(url.hostname) || url.pathname !== '/voltex_referral_regions') {
  throw new Error('Only the named disposable loopback database is allowed');
}
const schema = 'referral_alias_qa_' + Date.now();
const client = new Client({connectionString: url.href});
const migration = fs.readFileSync(path.join(__dirname, '../prisma/migrations/20261030120000_referral_short_codes/migration.sql'), 'utf8');
const out = path.resolve('output/referral-short-codes');
fs.mkdirSync(out, {recursive:true});
(async () => {
  await client.connect();
  await client.query('CREATE SCHEMA ' + schema);
  try {
    await client.query('SET search_path TO ' + schema);
    await client.query('CREATE TABLE "User" (id TEXT PRIMARY KEY, "referralCode" TEXT UNIQUE NOT NULL, "referredById" TEXT REFERENCES "User"(id), marker TEXT)');
    await client.query('CREATE TABLE balances (id TEXT PRIMARY KEY, amount NUMERIC NOT NULL); CREATE TABLE ledger (id TEXT PRIMARY KEY, amount NUMERIC NOT NULL)');
    const codes = ['9BB77B42','9BB77AAA','TRADE123','LOGIN123','ABCDE','ABCDE999'];
    for(let i=0;i<codes.length;i++) await client.query('INSERT INTO "User" VALUES ($1,$2,$3,$4)', ['old-'+i,codes[i],i?'old-0':null,'preserve-'+i]);
    await client.query("INSERT INTO balances VALUES ('fixture',123.456); INSERT INTO ledger VALUES ('fixture',-12.34)");
    const before = (await client.query('SELECT * FROM "User" ORDER BY id')).rows;
    const financeBefore = await client.query('SELECT row_to_json(b) AS row FROM balances b UNION ALL SELECT row_to_json(l) FROM ledger l');
    await client.query(migration);
    const users = (await client.query('SELECT * FROM "User" ORDER BY id')).rows;
    assert.deepEqual(users.map(({referralShortCode,...old})=>old),before);
    assert.equal(users[0].referralShortCode,'9BB77');
    assert.notEqual(users[1].referralShortCode,'9BB77');
    assert.ok(users.every(u=>/^[A-Z0-9]{5}$/.test(u.referralShortCode)));
    assert.equal(new Set(users.map(u=>u.referralShortCode)).size,users.length);
    assert.ok(users.every(u=>!['TRADE','LOGIN','TOOLS','LEGAL','ADMIN','ABOUT','TERMS','ABCDE'].includes(u.referralShortCode)));
    for (const reserved of ['LOGIN','TRADE','TOOLS','LEGAL','ADMIN','ABOUT','TERMS','ABCDE','9BB77']) {
      const code = (await client.query('SELECT voltex_referral_short_code($1) AS code',[reserved])).rows[0].code;
      assert.notEqual(code,reserved);
    }
    await assert.rejects(client.query('INSERT INTO "User" (id,"referralCode","referralShortCode") VALUES ($1,$2,$3)', ['duplicate','DUPL1234','9BB77']), e=>e.code==='23505');
    await assert.rejects(client.query('INSERT INTO "User" (id,"referralCode","referralShortCode") VALUES ($1,$2,$3)', ['bad','BAD12345','abcde']), e=>e.code==='23514');
    const pool = new Pool({connectionString:url.href,max:12,options:'-c search_path='+schema});
    try {
      await Promise.all(Array.from({length:250},(_,i)=>(async()=>{
        for(let attempt=0;;attempt++){
          try {await pool.query('INSERT INTO "User" (id,"referralCode") VALUES ($1,$2)',['new-'+i,'NEW'+String(i).padStart(5,'0')]);break;}
          catch(e){if(e.code==='23505'&&e.constraint==='User_referralShortCode_key'&&attempt<5)continue;throw e;}
        }
      })()));
    } finally {await pool.end();}
    const counts=(await client.query('SELECT count(*)::int AS total,count(DISTINCT "referralShortCode")::int AS unique FROM "User"')).rows[0];
    assert.deepEqual(counts,{total:256,unique:256});
    assert.deepEqual((await client.query('SELECT row_to_json(b) AS row FROM balances b UNION ALL SELECT row_to_json(l) FROM ledger l')).rows,financeBefore.rows);
    // Reconnect: aliases survive process/connection restarts.
    const restart=new Client({connectionString:url.href,options:'-c search_path='+schema});
    await restart.connect();
    try {
      assert.deepEqual((await restart.query('SELECT * FROM "User" WHERE id LIKE \'old-%\' ORDER BY id')).rows,users);
    } finally {await restart.end();}
    // Application rollback keeps legacy identities usable without dropping aliases.
    assert.deepEqual((await client.query('SELECT id,"referralCode","referredById",marker FROM "User" WHERE id LIKE \'old-%\' ORDER BY id')).rows,before);
    const report={result:'PASS',postgres:(await client.query('SHOW server_version')).rows[0].server_version,backfilledUsers:6,concurrentNewUsers:250,uniqueAliases:256,legacyCodesAndReferrersUnchanged:true,financialFixturesUnchanged:true,reservedRoutesExcluded:true,duplicateAndInvalidCodesRejected:true,restartStable:true};
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  } finally {
    await client.query('SET search_path TO public');
    await client.query('DROP SCHEMA '+schema+' CASCADE');
    await client.end();
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
