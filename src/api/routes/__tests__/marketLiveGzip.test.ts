import express from 'express';
import http from 'node:http';
import zlib from 'node:zlib';
import type { AddressInfo } from 'net';
import { marketLiveRouter, shouldGzipLiveStream } from '../marketLive';
import { LiveFeed } from '../../../services/marketData/live/contract';
import type { LiveTicker } from '../../../services/marketData/bybit/types';

/**
 * The event stream is compressed on the wire. The thing that can go wrong
 * is not the compression — it is the STREAMING: a compressor buffers by
 * design, so an event written without an explicit sync flush sits in zlib
 * and the client sees nothing at all. These connect a real socket, gunzip
 * what comes back, and assert frames arrive while the stream is still open.
 */

function ticker(id: string, lastPrice: number): LiveTicker {
  return {
    id, pair: 'BTC/USDT', symbol: 'BTC/USDT', providerSymbol: 'BTCUSDT', provider: 'bybit',
    marketType: 'spot', baseAsset: 'BTC', quoteAsset: 'USDT', settleAsset: null,
    lastPrice, bidPrice: null, askPrice: null, high24h: null, low24h: null,
    volume24h: null, quoteVolume24h: null, changePercent24h: null,
    indexPrice: null, markPrice: null, fundingRate: null, openInterest: null,
    openInterestValue: null, fundingIntervalMinutes: null, providerEventAt: null,
    sequence: null, receivedAt: 1, fetchedAt: 1, stale: false,
  } as LiveTicker;
}

/** Opens a real connection and yields decoded SSE frames as they land. */
function connect(port: number, headers: Record<string, string>) {
  const frames: any[] = [];
  const encodings: (string | undefined)[] = [];
  let buf = '';
  const consume = (text: string) => {
    buf += text;
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const ev = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = ev.split('\n').find((l) => l.startsWith('data: '));
      if (line) frames.push(JSON.parse(line.slice(6)));
    }
  };
  const req = http.get({ port, path: '/api/v1/market/live', headers }, (res) => {
    encodings.push(res.headers['content-encoding']);
    if (res.headers['content-encoding'] === 'gzip') {
      const gunzip = zlib.createGunzip();
      res.pipe(gunzip);
      gunzip.on('data', (c) => consume(c.toString('utf8')));
    } else {
      res.on('data', (c) => consume(c.toString('utf8')));
    }
  });
  return { frames, encodings, close: () => req.destroy() };
}

const until = async (predicate: () => boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('Timed out waiting for a frame');
    await new Promise((r) => setTimeout(r, 10));
  }
};

async function listen(app: express.Express) {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, port: (server.address() as AddressInfo).port };
}

describe('live stream compression', () => {
  it('negotiates: gzip only for a client that asks, and never when disabled by env', () => {
    const asks = { header: () => 'gzip, deflate, br' } as any;
    const doesNot = { header: () => 'identity' } as any;
    const absent = { header: () => undefined } as any;

    expect(shouldGzipLiveStream(asks, {})).toBe(true);
    expect(shouldGzipLiveStream(doesNot, {})).toBe(false);
    expect(shouldGzipLiveStream(absent, {})).toBe(false);
    // The kill switch wins over a client that asked.
    expect(shouldGzipLiveStream(asks, { MARKET_LIVE_SSE_GZIP: '0' })).toBe(false);
  });

  it('delivers the snapshot AND a later delta while the stream stays open', async () => {
    const feed = new LiveFeed('gzip-stream');
    feed.status = 'live';
    feed.publish('snapshot', [ticker('spot:BTCUSDT', 100)]);
    const app = express();
    app.use('/api/v1', marketLiveRouter(feed));
    const { server, port } = await listen(app);
    const client = connect(port, { 'accept-encoding': 'gzip' });
    try {
      await until(() => client.frames.length >= 1);
      expect(client.encodings[0]).toBe('gzip');
      expect(client.frames[0].type).toBe('snapshot');
      expect(client.frames[0].rows[0].lastPrice).toBe(100);

      // THE FLUSH TEST. Published after the client connected: without a
      // per-event sync flush this never arrives and the wait times out.
      feed.publish('delta', [ticker('spot:BTCUSDT', 101)]);
      await until(() => client.frames.length >= 2);
      expect(client.frames[1].type).toBe('delta');
      expect(client.frames[1].rows[0].lastPrice).toBe(101);
      expect(client.frames[1].revision).toBe(client.frames[0].revision + 1);
    } finally { client.close(); server.close(); }
  });

  it('serves plain text, unchanged, to a client that does not accept gzip', async () => {
    const feed = new LiveFeed('plain-stream');
    feed.status = 'live';
    feed.publish('snapshot', [ticker('spot:BTCUSDT', 100)]);
    const app = express();
    app.use('/api/v1', marketLiveRouter(feed));
    const { server, port } = await listen(app);
    const client = connect(port, { 'accept-encoding': 'identity' });
    try {
      await until(() => client.frames.length >= 1);
      expect(client.encodings[0]).toBeUndefined();
      expect(client.frames[0].type).toBe('snapshot');
    } finally { client.close(); server.close(); }
  });

  it('decompresses to exactly what the uncompressed stream sends', async () => {
    const build = () => {
      const feed = new LiveFeed('parity');
      feed.status = 'live';
      feed.publish('snapshot', Array.from({ length: 40 }, (_, i) => ticker(`spot:S${i}`, i)));
      const app = express();
      app.use('/api/v1', marketLiveRouter(feed));
      return { feed, app };
    };
    const a = build(), b = build();
    const sa = await listen(a.app), sb = await listen(b.app);
    const gz = connect(sa.port, { 'accept-encoding': 'gzip' });
    const plain = connect(sb.port, { 'accept-encoding': 'identity' });
    try {
      await until(() => gz.frames.length >= 1 && plain.frames.length >= 1);
      const strip = (f: any) => ({ ...f, sentAt: 0, epoch: 'x' });
      expect(strip(gz.frames[0])).toEqual(strip(plain.frames[0]));
      expect(gz.frames[0].rows).toHaveLength(40);
    } finally { gz.close(); plain.close(); sa.server.close(); sb.server.close(); }
  });

  it('the disabled stream stays plain, so its single frame is readable', async () => {
    const app = express();
    app.use('/api/v1', marketLiveRouter(null));
    const { server, port } = await listen(app);
    const client = connect(port, { 'accept-encoding': 'gzip' });
    try {
      await until(() => client.frames.length >= 1);
      // Headers are flushed for both paths, so an encoding claimed here
      // could not be taken back — it must never be claimed.
      expect(client.encodings[0]).toBeUndefined();
      expect(client.frames[0].status).toBe('disabled');
    } finally { client.close(); server.close(); }
  });
});
