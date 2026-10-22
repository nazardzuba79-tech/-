import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import WebSocket from 'ws';
import { DerivPublicStreamQuoteSource } from '../../services/marketData/cfd/DerivPublicStreamQuoteSource';

class SocketFixture extends EventEmitter {
  close = jest.fn();
  terminate = jest.fn();
  send = jest.fn();
}

function fixture() {
  const sockets: SocketFixture[] = [];
  const source = new DerivPublicStreamQuoteSource({
    shadow: true,
    reconnectBaseMs: 5,
    socketFactory: () => {
      const socket = new SocketFixture();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
  return { source, sockets };
}

describe('Deriv collector shutdown', () => {
  afterEach(() => jest.useRealTimers());

  test('absorbs the late socket error after stop without reconnecting', () => {
    jest.useFakeTimers();
    const { source, sockets } = fixture();
    source.start();
    source.stop();
    expect(() => sockets[0].emit('error', new Error('WebSocket was closed before the connection was established'))).not.toThrow();
    sockets[0].emit('close');
    jest.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].terminate).not.toHaveBeenCalled();
  });

  test('cancels a pending reconnect on stop', () => {
    jest.useFakeTimers();
    const { source, sockets } = fixture();
    source.start();
    sockets[0].emit('close');
    source.stop();
    jest.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });

  test('stop is idempotent and stale socket callbacks cannot affect a new start', () => {
    const { source, sockets } = fixture();
    source.start(); source.stop(); source.stop(); source.start();
    expect(sockets).toHaveLength(2);
    expect(sockets[0].close).toHaveBeenCalledTimes(1);
    expect(() => sockets[0].emit('error', new Error('late shutdown'))).not.toThrow();
    sockets[0].emit('close'); sockets[0].emit('open');
    expect(sockets[0].send).not.toHaveBeenCalled();
    expect(sockets[1].close).not.toHaveBeenCalled();
    source.stop();
  });

  test.each(['connecting', 'open', 'repeat'])('real local WebSocket %s shutdown exits cleanly', (mode) => {
    const modulePath = path.resolve(__dirname, '../../services/marketData/cfd/DerivPublicStreamQuoteSource.ts');
    const script = `
      const { WebSocketServer, WebSocket } = require('ws');
      const { DerivPublicStreamQuoteSource } = require(${JSON.stringify(modulePath)});
      const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
      const deadline = setTimeout(() => { console.error('local shutdown deadline exceeded'); process.exit(2); }, 3000);
      server.on('listening', () => {
        const source = new DerivPublicStreamQuoteSource({ shadow: true,
          socketFactory: () => {
            const socket = new WebSocket('ws://127.0.0.1:' + server.address().port);
            if (${JSON.stringify(mode)} === 'open') socket.once('open', () => source.stop());
            return socket;
          }
        });
        source.start();
        if (${JSON.stringify(mode)} !== 'open') source.stop();
        if (${JSON.stringify(mode)} === 'repeat') {
          for (let i = 0; i < 3; i++) { source.start(); source.stop(); }
        }
        setTimeout(() => {
          source.stop();
          for (const socket of server.clients) socket.terminate();
          server.close(() => { clearTimeout(deadline); console.log('shutdown-ok'); });
        }, 150);
      });
    `;
    const result = spawnSync(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'), '-e', script], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' },
    });
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    expect(result.stdout).toContain('shutdown-ok');
  });
});
