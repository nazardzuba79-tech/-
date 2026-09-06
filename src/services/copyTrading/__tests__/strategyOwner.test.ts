import { resolveStrategyOwner, KSENIA_EXTERNAL_OWNER_ID } from '../strategyOwner';
import { assertReviewDatabase } from '../../../review/server';
import { readFileSync } from 'fs';
import { resolve } from 'path';

test('confirmed stable ID, no User creation, narrow profile read, KYC NOT_STARTED not verified', async () => {
  const db: any = { copyStrategyOwner: { findUnique: jest.fn().mockResolvedValue({ traderId: 'VX-KSENIA', publicName: 'Ksenia', premium: true, ownerUserId: null, externalOwnerUserId: KSENIA_EXTERNAL_OWNER_ID }) },
    user: { findUnique: jest.fn().mockResolvedValue({ avatarUrl: 'data:image/png;base64,YWJj', kycStatus: 'NOT_STARTED' }) } };
  const first = await resolveStrategyOwner(db, 'VX-KSENIA');
  expect(db.user.findUnique).toHaveBeenCalledWith({ where: { id: 'a2184cdc-c0fc-4892-9141-e493967245fd' }, select: { avatarUrl: true, kycStatus: true } });
  expect(first).toMatchObject({ displayName: 'Ksenia', verified: false, premium: true, avatarUrl: 'data:image/png;base64,YWJj' });
  expect(Object.keys(first!).sort()).toEqual(['traderId', 'displayName', 'avatarUrl', 'avatarVersion', 'verified', 'premium'].sort());
  db.user.findUnique.mockResolvedValue({ avatarUrl: 'data:image/png;base64,ZGVm', kycStatus: 'APPROVED' });
  const updated = await resolveStrategyOwner(db, 'VX-KSENIA');
  expect(updated!.avatarVersion).not.toBe(first!.avatarVersion);
  expect(updated!.verified).toBe(true);
  db.user.findUnique.mockResolvedValue(null);
  expect(await resolveStrategyOwner(db, 'VX-KSENIA')).toMatchObject({ avatarUrl: null, verified: false });
  expect(await resolveStrategyOwner(db, 'arbitrary-user')).toBeNull();
});
test('Nazar resolves configured owner independently of current viewer', async () => {
  const db: any = { copyStrategyOwner: { findUnique: jest.fn().mockResolvedValue({ publicName: 'Nazar', premium: true, ownerUserId: 'test-owner' }) }, user: { findUnique: jest.fn().mockResolvedValue({ avatarUrl: null, kycStatus: 'APPROVED' }) } };
  expect(await resolveStrategyOwner(db, 'VX-001')).toMatchObject({ displayName: 'Nazar', verified: true });
  expect(db.user.findUnique.mock.calls[0][0].where).toEqual({ id: 'test-owner' });
});
test('isolated entry point fails closed for production/unknown database URLs', () => {
  expect(() => assertReviewDatabase({ VOLTEX_ISOLATED_REVIEW: 'true', DATABASE_URL: 'postgresql://test:test@dpg-daei409t0dsc73aat5jg-a/voltex_review_db' })).not.toThrow();
  for (const url of ['postgresql://test:test@production.neon.tech/database', 'postgresql://test:test@localhost/voltex_review_db', 'postgresql://test:test@dpg-daei409t0dsc73aat5jg-a/production']) {
    expect(() => assertReviewDatabase({ VOLTEX_ISOLATED_REVIEW: 'true', DATABASE_URL: url })).toThrow();
  }
  expect(() => assertReviewDatabase({ DATABASE_URL: 'postgresql://test:test@dpg-daei409t0dsc73aat5jg-a/voltex_review_db' })).toThrow();
  const source = readFileSync(resolve(__dirname, '../../../review/server.ts'), 'utf8');
  expect(source).not.toMatch(/from ['"].*(Wallet|Matching|Auth|Deposit|Futures)/);
  expect(source).not.toMatch(/db\.user\.(create|update|upsert|delete)/);
});
