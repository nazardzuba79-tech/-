#!/usr/bin/env node
/*
 * Operator check for Issue #694 (run once on the API host after BESTCHANGE_API_KEY is set).
 *
 *   BESTCHANGE_API_KEY=… node scripts/bestchange-key-check.cjs [amountRub]
 *
 * Uses the real BestChangeService (official BestChange API v2 only) and prints a NON-SECRET summary:
 * directory status, which RUB methods and asset/network pairs were matched against the live
 * `currencies` directory (with BestChange's own names), and for СБП/Сбербанк → USDT TRC-20 how many
 * real offers came back, the best RUB-per-USDT and whether every exchanger link passed validation.
 * It never prints the key, an upstream URL or a raw upstream body, and it writes nothing anywhere.
 */
require('ts-node/register/transpile-only');
const { bestChangeServiceFromEnv } = require('../src/services/exchangers/BestChangeService');

async function main() {
  const amount = process.argv[2] || '10000';
  const service = bestChangeServiceFromEnv(process.env);
  if (!service.isConfigured()) {
    console.log(JSON.stringify({ status: 'not_configured', hint: 'BESTCHANGE_API_KEY is unset or not plausible' }));
    process.exitCode = 2;
    return;
  }
  const directory = await service.directory();
  if (directory.status !== 'ok') {
    console.log(JSON.stringify({ status: directory.status }));
    process.exitCode = 1;
    return;
  }
  const summary = {
    status: 'ok',
    asOf: directory.asOf,
    methods: directory.methods.map((m) => `${m.id} | ${m.label} | ${m.kind} | ${m.available ? 'available' : 'no rates'}`),
    assets: directory.assets.map((a) => `${a.assetId}:${a.networkId} | ${a.available ? 'available' : 'no rates'}`),
    samples: [],
  };
  for (const method of ['sbp', 'sberbank']) {
    if (!directory.methods.some((m) => m.id === method && m.available)) continue;
    const res = await service.offers({ method, asset: 'USDT', network: 'tron', amount: Number(amount) });
    if (res.status !== 'ok') {
      summary.samples.push({ method, status: res.status });
      continue;
    }
    summary.samples.push({
      method,
      offers: res.offers.length,
      bestRubPerUsdt: res.offers[0] ? res.offers[0].rubPerUnit : null,
      withExchangerLink: res.offers.filter((o) => o.link !== null).length,
      directionLink: res.directionLink ? res.directionLink.url.replace(/\?p=\d+$/, '?p=<partner>') : null,
      firstThree: res.offers.slice(0, 3).map((o) => `${o.exchanger.name}: ${o.rubPerUnit} RUB/USDT, reserve ${o.reserve}, limits ${o.minRub}-${o.maxRub}`),
    });
  }
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  // Fixed text only: an error here must never carry the key-bearing upstream URL.
  console.log(JSON.stringify({ status: 'error', name: error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : 'unknown' }));
  process.exitCode = 1;
});
