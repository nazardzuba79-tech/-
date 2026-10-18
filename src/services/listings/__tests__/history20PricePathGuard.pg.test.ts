/**
 * The pinned History20 price path is frozen while any native Futures TEST
 * journal mentions its contract: the real query against a disposable,
 * loopback PostgreSQL. Synthetic users and rows only; nothing else is read.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { nativeJournalReferences } from '../../../private-trading/native/history20Prices';

const url = process.env.VOLTEX_LISTING_TEST_URL;
if (url) {
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/voltex_listing_test') throw new Error('History20 guard tests require the disposable loopback voltex_listing_test database');
}
const pg = url ? describe : describe.skip;

pg('History20 price-path references in native journals (disposable PostgreSQL)', () => {
  let db: PrismaClient;
  beforeAll(() => { db = new PrismaClient({ datasources: { db: { url } } }); });
  afterAll(async () => { await db.$disconnect(); });

  test('an account row or a stored revision that mentions the contract is a reference; a similar name or another contract is not', async () => {
    const contract = `Q${randomUUID().replace(/[^A-Z]/gi, '').slice(0, 6).toUpperCase()}SIMUSDT`, other = `${contract.slice(0, -7)}XSIMUSDT`;
    const referenced = nativeJournalReferences(db);
    expect(await referenced(contract)).toBe(false);

    const user = async () => { const id = randomUUID(); await db.user.create({ data: { id, email: `${id}@history20-guard.invalid`, referralCode: id, passwordHash: 'fixture', role: 'USER' } }); return id; };
    // A longer symbol or a sibling contract is not a reference.
    const holder = await user();
    await db.nativeDemoAccount.create({ data: { userId: holder, revision: 1, payload: { commands: [{ kind: 'OPEN', order: { symbol: `${contract}2` } }], snapshot: { positions: [{ symbol: other }] } } } });
    expect(await referenced(contract)).toBe(false);
    // The account row itself.
    await db.nativeDemoAccount.update({ where: { userId: holder }, data: { payload: { snapshot: { positions: [{ symbol: contract, status: 'CLOSED' }] } } } });
    expect(await referenced(contract)).toBe(true);
    expect(await referenced(other)).toBe(false);
    // A stored revision (immutable): the reference stays even after the account row moves on.
    const reviser = await user();
    await db.nativeDemoAccount.create({ data: { userId: reviser, revision: 1, payload: { commands: [] } } });
    await db.nativeDemoRevision.create({ data: { userId: reviser, revision: 1, requestKey: `h20g-${reviser}`, requestHash: 'a'.repeat(64),
      payload: { commands: [{ kind: 'OPEN', order: { symbol: other } }] } } });
    await db.nativeDemoAccount.update({ where: { userId: holder }, data: { payload: { commands: [] } } });
    expect(await referenced(contract)).toBe(false);
    expect(await referenced(other)).toBe(true);
  });
});
