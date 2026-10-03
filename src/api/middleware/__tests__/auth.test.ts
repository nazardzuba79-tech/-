process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import jwt from 'jsonwebtoken';
import { requireAuth, AuthedRequest } from '../auth';

function mockReqRes(header?: string) {
  const req = { headers: { authorization: header } } as AuthedRequest;
  const res: any = { statusCode: 200, body: undefined, status(code: number) { this.statusCode = code; return this; }, json(body: any) { this.body = body; return this; } };
  const next = jest.fn();
  return { req, res, next };
}

function makePrismaMock(session: any = null, owner: any = { createdAt: new Date(), user: { role: 'ADMIN' } }) {
  return {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }) },
    session: {
      // The first read is authorization; a remembered session's second read is its owner.
      findUnique: jest.fn().mockImplementation(async ({ select }: any) => (select?.user ? owner : session)),
      update: jest.fn().mockResolvedValue({}),
    },
  } as any;
}

describe('requireAuth', () => {
  it('rejects a legacy token after its user has been deleted', async () => {
    const { req, res, next } = mockReqRes(`Bearer ${jwt.sign({ sub: 'deleted' }, process.env.JWT_SECRET!)}`);
    const prisma = makePrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    await requireAuth(prisma)(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it.each([{}, { sub: '' }, { sub: 123 }])('rejects malformed identity claims %j before any DB lookup', async claims => {
    const { req, res, next } = mockReqRes(`Bearer ${jwt.sign(claims, process.env.JWT_SECRET!)}`);
    const prisma = makePrismaMock();
    await requireAuth(prisma)(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it.each([undefined, 'session-1'])('fails closed on authorization database outage (sid=%s)', async sid => {
    const { req, res, next } = mockReqRes(`Bearer ${jwt.sign({ sub: 'user-1', sid }, process.env.JWT_SECRET!)}`);
    const prisma = makePrismaMock();
    prisma.user.findUnique.mockRejectedValue(new Error('offline'));
    prisma.session.findUnique.mockRejectedValue(new Error('offline'));
    await requireAuth(prisma)(req, res, next);
    expect(res.statusCode).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts a normal session token (no sid claim — pre-Session-model token) and sets req.userId', async () => {
    const token = jwt.sign({ sub: 'user-1' }, process.env.JWT_SECRET!);
    const { req, res, next } = mockReqRes(`Bearer ${token}`);
    const prisma = makePrismaMock();

    await requireAuth(prisma)(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.userId).toBe('user-1');
    expect(prisma.session.findUnique).not.toHaveBeenCalled();
  });

  it('accepts a token carrying a live sid and sets req.sessionId', async () => {
    const token = jwt.sign({ sub: 'user-1', sid: 'session-1' }, process.env.JWT_SECRET!);
    const { req, res, next } = mockReqRes(`Bearer ${token}`);
    const prisma = makePrismaMock({ id: 'session-1', userId: 'user-1', revokedAt: null, lastSeenAt: new Date() });

    await requireAuth(prisma)(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.userId).toBe('user-1');
    expect(req.sessionId).toBe('session-1');
  });

  describe('remembered device (admin account only)', () => {
    const DAY = 24 * 60 * 60_000;
    const token = () => jwt.sign({ sub: 'user-1', sid: 'session-1' }, process.env.JWT_SECRET!);

    it('keeps a remembered device signed in after 29 days without use', async () => {
      const { req, res, next } = mockReqRes(`Bearer ${token()}`);
      const prisma = makePrismaMock({ id: 'session-1', userId: 'user-1', revokedAt: null, remembered: true, lastSeenAt: new Date(Date.now() - 29 * DAY) });
      await requireAuth(prisma)(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.sessionId).toBe('session-1');
    });

    it('signs a remembered device out after 30 days without use', async () => {
      const { req, res, next } = mockReqRes(`Bearer ${token()}`);
      const prisma = makePrismaMock({ id: 'session-1', userId: 'user-1', revokedAt: null, remembered: true, lastSeenAt: new Date(Date.now() - 31 * DAY) });
      await requireAuth(prisma)(req, res, next);
      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('still honours a revoked remembered session immediately', async () => {
      const { req, res, next } = mockReqRes(`Bearer ${token()}`);
      const prisma = makePrismaMock({ id: 'session-1', userId: 'user-1', revokedAt: new Date(), remembered: true, lastSeenAt: new Date() });
      await requireAuth(prisma)(req, res, next);
      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('holds a remembered session of a non-admin account to 12h from sign-in', async () => {
      const remembered = { id: 'session-1', userId: 'user-1', revokedAt: null, remembered: true, lastSeenAt: new Date() };
      for (const [hoursAgo, accepted] of [[11, true], [13, false]] as const) {
        const { req, res, next } = mockReqRes(`Bearer ${token()}`);
        const prisma = makePrismaMock(remembered, { createdAt: new Date(Date.now() - hoursAgo * 3_600_000), user: { role: 'USER' } });
        await requireAuth(prisma)(req, res, next);
        expect({ hoursAgo, accepted: next.mock.calls.length === 1 }).toEqual({ hoursAgo, accepted });
        if (!accepted) expect(res.statusCode).toBe(401);
      }
    });

    it('keeps an admin\'s remembered session past 12h', async () => {
      const { req, res, next } = mockReqRes(`Bearer ${token()}`);
      const prisma = makePrismaMock({ id: 'session-1', userId: 'user-1', revokedAt: null, remembered: true, lastSeenAt: new Date() },
        { createdAt: new Date(Date.now() - 20 * DAY), user: { role: 'ADMIN' } });
      await requireAuth(prisma)(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('does not pay the owner read for an ordinary session', async () => {
      const { req, res, next } = mockReqRes(`Bearer ${token()}`);
      const prisma = makePrismaMock({ id: 'session-1', userId: 'user-1', revokedAt: null, remembered: false, lastSeenAt: new Date() });
      await requireAuth(prisma)(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(prisma.session.findUnique).toHaveBeenCalledTimes(1);
    });

    it('leaves an ordinary session to its own 12h token expiry', async () => {
      const { req, res, next } = mockReqRes(`Bearer ${token()}`);
      const prisma = makePrismaMock({ id: 'session-1', userId: 'user-1', revokedAt: null, remembered: false, lastSeenAt: new Date(Date.now() - 31 * DAY) });
      await requireAuth(prisma)(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  it('rejects a token whose session has been revoked', async () => {
    const token = jwt.sign({ sub: 'user-1', sid: 'session-1' }, process.env.JWT_SECRET!);
    const { req, res, next } = mockReqRes(`Bearer ${token}`);
    const prisma = makePrismaMock({ id: 'session-1', userId: 'user-1', revokedAt: new Date(), lastSeenAt: new Date() });

    await requireAuth(prisma)(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a token whose session no longer exists', async () => {
    const token = jwt.sign({ sub: 'user-1', sid: 'session-1' }, process.env.JWT_SECRET!);
    const { req, res, next } = mockReqRes(`Bearer ${token}`);
    const prisma = makePrismaMock(null);

    await requireAuth(prisma)(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a missing bearer header', async () => {
    const { req, res, next } = mockReqRes(undefined);
    await requireAuth(makePrismaMock())(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a malformed/invalid token', async () => {
    const { req, res, next } = mockReqRes('Bearer not-a-real-token');
    await requireAuth(makePrismaMock())(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a pending-2FA token — it must never work as a full session', async () => {
    const pendingToken = jwt.sign({ sub: 'user-1', purpose: 'pending_2fa' }, process.env.JWT_SECRET!, { expiresIn: '5m' });
    const { req, res, next } = mockReqRes(`Bearer ${pendingToken}`);

    await requireAuth(makePrismaMock())(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});
