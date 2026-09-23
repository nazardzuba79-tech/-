import type { RequestHandler, Response, Request } from 'express';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export const DISPLAY_REFRESH_MS = 60_000;
export const SLOW_DISPLAY_REFRESH_MS = 6 * 60 * 60 * 1000;

type Entry = { at: number; expires: number; raw: Buffer; gzip: Buffer; etag: string };
/** Only mount on explicit public DISPLAY routes. Never accounts, execution or authenticated reads.
 * This cache never rewrites quote/provider timestamps or feeds any financial service.
 * No timer, database, background refresh or per-visitor provider subscription.
 */
export function publicDisplayCache(ttlMs: number, valid: (body: any) => boolean,
  now: () => number = Date.now): RequestHandler {
  if (!Number.isFinite(ttlMs) || ttlMs < 30_000 || ttlMs > SLOW_DISPLAY_REFRESH_MS) throw new Error('Invalid display cadence');
  const entries = new Map<string, Entry>();
  const pending = new Map<string, Promise<void>>();
  const failedUntil = new Map<string, number>();
  const maxBytes = 8 * 1024 * 1024;
  let bytes = 0;
  const remove = (key: string) => { const old = entries.get(key); if (old) bytes -= old.raw.length + old.gzip.length; entries.delete(key); };
  const send = (req: Request, res: Response, entry: Entry) => {
    res.status(200).type('application/json');
    res.setHeader('Cache-Control', `public, max-age=${Math.max(0, Math.floor((entry.expires - now()) / 1000))}, must-revalidate`);
    res.setHeader('ETag', entry.etag);
    res.setHeader('X-VOLTEX-Display', 'snapshot');
    res.setHeader('X-VOLTEX-Refresh-Seconds', String(ttlMs / 1000));
    res.vary('Accept-Encoding');
    const gzip = /(?:^|,)\s*gzip\s*(?:;\s*q=(?!0(?:\.0*)?(?:\s*(?:,|$)))[0-9.]+)?\s*(?:,|$)/i.test(req.header('accept-encoding') ?? '');
    if (gzip) res.setHeader('Content-Encoding', 'gzip');
    else res.removeHeader('Content-Encoding');
    res.send(gzip ? entry.gzip : entry.raw);
  };
  return async (req, res, next) => {
    if (req.method !== 'GET') { next(); return; }
    // Each middleware instance belongs to an explicit alias, with no personal query parameters.
    const key = req.originalUrl;
    if (key.length > 512) { res.status(400).json({ error: 'display_query_too_long' }); return; }
    const cached = entries.get(key);
    if (cached && now() < cached.expires) { send(req, res, cached); return; }
    const existing = pending.get(key);
    if (existing) {
      await existing;
      if (res.destroyed || res.writableEnded) return;
      const fresh = entries.get(key);
      if (fresh && now() < fresh.expires) send(req, res, fresh);
      else res.status(503).set('Retry-After', '60').json({ error: 'display_snapshot_unavailable' });
      return;
    }
    if (now() < (failedUntil.get(key) ?? 0) || pending.size >= 16) {
      res.status(503).set('Retry-After', '60').json({ error: 'display_snapshot_unavailable' }); return;
    }
    let resolve!: () => void;
    const work = new Promise<void>(done => { resolve = done; });
    pending.set(key, work);
    let complete = false;
    const finish = () => { if (complete) return; complete = true; pending.delete(key); resolve(); };
    const originalJson = res.json.bind(res);
    res.once('finish', finish); res.once('close', finish);
    res.json = ((body: any) => {
      try {
        if (res.statusCode >= 400 || !valid(body)) {
          failedUntil.set(key, now() + 60_000);
          if (failedUntil.size > 64) failedUntil.delete(failedUntil.keys().next().value!);
          return originalJson(body);
        }
        const at = now();
        const data = { ...body, _display: { mode: 'snapshot', capturedAt: at, refreshMs: ttlMs } };
        const raw = Buffer.from(JSON.stringify(data));
        if (raw.length > 2 * 1024 * 1024) {
          return res.status(503).send({ error: 'display_snapshot_too_large' });
        }
        const compressed = gzipSync(raw);
        const entry: Entry = { at, expires: at + ttlMs, raw, gzip: compressed,
          etag: `W/\"${createHash('sha256').update(raw).digest('hex')}\"` };
        remove(key);
        while (entries.size >= 64 || bytes + raw.length + compressed.length > maxBytes) remove(entries.keys().next().value!);
        entries.set(key, entry); bytes += raw.length + compressed.length; failedUntil.delete(key);
        send(req, res, entry);
        return res;
      } finally { finish(); }
    }) as Response['json'];
    next();
  };
}
