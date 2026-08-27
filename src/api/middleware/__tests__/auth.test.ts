process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import jwt from 'jsonwebtoken';
import { requireAuth, AuthedRequest } from '../auth';

function mockReqRes(header?: string) {
  const req = { headers: { authorization: header } } as AuthedRequest;
  const res: any = { statusCode: 200, body: undefined, status(code: number) { this.statusCode = code; return this; }, json(body: any) { this.body = body; return this; } };
  const next = jest.fn();
  return { req, res, next };
}

function makePrismaMock(session: any = null) {
  return {
    session: {
      findUnique: jest.fn().mockResolvedValue(session),
      update: jest.fn().mockResolvedValue({}),
    },
  } as any;
}

describe('requireAuth', () => {
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
