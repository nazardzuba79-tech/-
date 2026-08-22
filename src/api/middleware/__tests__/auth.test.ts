process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import jwt from 'jsonwebtoken';
import { requireAuth, AuthedRequest } from '../auth';

function mockReqRes(header?: string) {
  const req = { headers: { authorization: header } } as AuthedRequest;
  const res: any = { statusCode: 200, body: undefined, status(code: number) { this.statusCode = code; return this; }, json(body: any) { this.body = body; return this; } };
  const next = jest.fn();
  return { req, res, next };
}

describe('requireAuth', () => {
  it('accepts a normal session token and sets req.userId', () => {
    const token = jwt.sign({ sub: 'user-1' }, process.env.JWT_SECRET!);
    const { req, res, next } = mockReqRes(`Bearer ${token}`);

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.userId).toBe('user-1');
  });

  it('rejects a missing bearer header', () => {
    const { req, res, next } = mockReqRes(undefined);
    requireAuth(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a malformed/invalid token', () => {
    const { req, res, next } = mockReqRes('Bearer not-a-real-token');
    requireAuth(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a pending-2FA token — it must never work as a full session', () => {
    const pendingToken = jwt.sign({ sub: 'user-1', purpose: 'pending_2fa' }, process.env.JWT_SECRET!, { expiresIn: '5m' });
    const { req, res, next } = mockReqRes(`Bearer ${pendingToken}`);

    requireAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});
