'use strict';
// Loopback-only review of the built frontend. Fixtures come from the real
// API/snapshot/service regression test, never from production or credentials.
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const root = path.resolve(__dirname, '..');
const fixtures = process.env.COPY_DEMO_EVIDENCE_DIR;
if (!fixtures) throw new Error('Set COPY_DEMO_EVIDENCE_DIR to the October test evidence folder');
const app = express();
app.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "connect-src 'self'; img-src 'self' data:; font-src 'self' data:");
  next();
});
app.get('/__qa/payload', (req, res) => {
  const day = String(req.query.day);
  if (!/^2026-10-(18|19|20|21|22)$/.test(day)) return res.sendStatus(400);
  res.type('json').send(fs.readFileSync(path.join(fixtures, `payload-${day}.json`), 'utf8'));
});
app.get('/api/v1/me', (_req, res) => res.json({ id: 'local-fixture', email: 'qa@example.invalid',
  displayName: 'Local QA', isAdmin: false, kycStatus: 'NOT_STARTED', twoFactorEnabled: false }));
app.get('/api/v1/wallet/portfolio-history', (_req, res) => res.json({ points: [] }));
app.get(['/api/v1/balances', '/api/v1/futures/balances'], (_req, res) => res.json([]));
app.get('/api/v1/market/external/tickers', (_req, res) => res.json({ tickers: [] }));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Unrelated API unavailable in local fixture review' }));
app.use(express.static(path.join(root, 'frontend/dist'), { index: false }));
app.get('*', (_req, res) => {
  const bootstrap = `<script>
    const params = new URLSearchParams(location.search);
    // A fresh local fixture session, including when reviewing an earlier day.
    localStorage.clear();
    localStorage.setItem('exchange_token', 'local-fixture');
    localStorage.setItem('exchange_lang', params.get('lang') || 'ru');
    const RealDate = Date;
    let clock = RealDate.parse('2026-10-21T23:59:59.000Z');
    Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [clock])); }
      static now() { return clock; }
    };
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (String(input).includes('/copy-trading/marketplace'))
        return realFetch('/__qa/payload?day=' + new RealDate(clock).toISOString().slice(0, 10), init);
      return realFetch(input, init);
    };
    addEventListener('DOMContentLoaded', () => {
      const toolbar = document.createElement('div');
      toolbar.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:99999;background:#172738;color:#fff;padding:8px;font:12px sans-serif;border:1px solid #6ba8d1;border-radius:6px';
      toolbar.innerHTML = '<label>LOCAL QA · UTC <select aria-label="QA day">' +
        [18,19,20,21,22].map(d => '<option value="'+d+'" '+(d===21?'selected':'')+'>2026-10-'+d+'</option>').join('') +
        '</select></label> <button id="qa-expire">22 Oct 00:00 UTC</button>';
      document.body.append(toolbar);
      toolbar.querySelector('select').onchange = event => {
        clock = RealDate.parse('2026-10-'+event.target.value+'T12:00:00Z');
        dispatchEvent(new Event('focus'));
      };
      toolbar.querySelector('button').onclick = () => {
        clock = RealDate.parse('2026-10-22T00:00:00Z');
        toolbar.querySelector('select').value = '22';
        dispatchEvent(new Event('focus'));
      };
    });
  </script>`;
  res.type('html').send(fs.readFileSync(path.join(root, 'frontend/dist/index.html'), 'utf8').replace('<head>', '<head>' + bootstrap));
});
const server = app.listen(0, '127.0.0.1', () => console.log(`Local review: http://127.0.0.1:${server.address().port}/copy-trading`));
