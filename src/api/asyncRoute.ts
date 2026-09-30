import type { Request, Response, NextFunction } from 'express';

/** Express 4 forwards synchronous throws, but does not observe a returned
 * promise. Keep asynchronous failures on the existing error-middleware path
 * so one failed database/provider read cannot terminate the API process. */
export function asyncRoute(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => handler(req, res, next).catch(next);
}
