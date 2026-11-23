'use strict';
// Deterministic aggregate-only fixture for local QA. Never imported by the application.
module.exports = function fixture(owner, last = '2025-12-15') {
  const inceptionDate = '2024-01-01';
  const days = [];
  let balance = 1000;
  for (let t = Date.parse(inceptionDate); t <= Date.parse(last); t += 86400000) {
    const date = new Date(t).toISOString().slice(0, 10);
    const month = Number(date.slice(5, 7));
    const active = month !== 2 && date.endsWith('01');
    const gross = active ? (month % 2 ? 13 : -8) : 0;
    const fees = active ? 1 : 0;
    const externalFlow = date === '2025-03-15' ? 200 : date === '2025-08-16' ? -50 : 0;
    const closing = balance + gross - fees + externalFlow;
    days.push({ date, opening: String(balance), closing: String(closing), externalFlow: String(externalFlow),
      realizedGross: String(gross), unrealizedChange: '0', fees: String(fees), trades: Number(active), wins: Number(gross > 0) });
    balance = closing;
  }
  return { version: 1, publication: 'approved-aggregate', botId: 'range', strategyId: 'thomas-quant-ai',
    pair: 'XRP/USDT', creatorUserId: owner, inceptionDate, asOf: last + 'T23:59:59Z', currency: 'USDT', flowTiming: 'end-of-day', days };
};
