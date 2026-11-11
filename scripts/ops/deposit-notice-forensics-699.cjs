#!/usr/bin/env node
/*
 * Issue #699 — read-only, public-chain check of WHEN TRON transactions happened.
 *
 *   node scripts/ops/deposit-notice-forensics-699.cjs [--at 2026-11-11T10:00:00Z] [--full] <txid> [<txid> …]
 *   … | node scripts/ops/deposit-notice-forensics-699.cjs --at …        (one TXID per line on stdin)
 *
 * For every TXID it asks the TRON node (TronGrid, solidified data) for the block,
 * the block time and — for a native transfer — the amount, and prints the time in
 * UTC and Europe/Kyiv plus how many confirmations the transaction had at `--at`
 * (default: now). It needs no key, no database and no VOLTEX access; it sends
 * nothing but the TXIDs to the public node and writes nothing anywhere.
 * TXIDs are printed masked (first 6 … last 4) unless --full is given, so the
 * output can be pasted without publishing the identifiers. Never commit TXIDs.
 */
const API = process.env.TRON_API_URL || 'https://api.trongrid.io';
const BLOCK_MS = 3000;
const args = process.argv.slice(2);
const full = args.includes('--full');
const atArg = args.includes('--at') ? args[args.indexOf('--at') + 1] : null;
const at = atArg ? Date.parse(atArg) : Date.now();
const kyiv = (ms) => new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(ms));
const mask = (id) => (full ? id : `${id.slice(0, 6)}…${id.slice(-4)}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function post(path, body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    if (res.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`node answered HTTP ${res.status}`);
    return res.json();
  }
  throw new Error('node rate limit');
}

async function main() {
  if (!Number.isFinite(at)) throw new Error('--at must be an ISO time, e.g. 2026-11-11T10:00:00Z');
  let ids = args.filter((a, i) => /^[0-9a-fA-F]{64}$/.test(a) && args[i - 1] !== '--at');
  if (ids.length === 0 && !process.stdin.isTTY) {
    let input = ''; for await (const chunk of process.stdin) input += chunk;
    ids = input.split(/\s+/).filter((a) => /^[0-9a-fA-F]{64}$/.test(a));
  }
  if (ids.length === 0) throw new Error('give at least one 64-hex TXID');
  const rows = [];
  for (const id of [...new Set(ids.map((x) => x.toLowerCase()))]) {
    const info = await post('/walletsolidity/gettransactioninfobyid', { value: id });
    await sleep(1100); // anonymous TronGrid is paced; this is a handful of reads
    const body = await post('/walletsolidity/gettransactionbyid', { value: id });
    await sleep(1100);
    if (!info || !Number.isSafeInteger(info.blockNumber) || !Number.isSafeInteger(info.blockTimeStamp)) { rows.push({ tx: mask(id), status: 'NOT_VERIFIED (not found in solidified data)' }); continue; }
    const contract = body?.raw_data?.contract?.[0];
    const native = contract?.type === 'TransferContract';
    rows.push({
      tx: mask(id), status: 'VERIFIED', block: info.blockNumber,
      chainTimeUtc: new Date(info.blockTimeStamp).toISOString(), chainTimeKyiv: kyiv(info.blockTimeStamp),
      type: contract?.type ?? 'unknown', amount: native ? `${(Number(contract.parameter.value.amount) / 1e6).toFixed(6)} TRX` : '(not a native TRX transfer)',
      execution: body?.ret?.[0]?.contractRet ?? (info.receipt?.result ?? 'unknown'),
      confirmationsAt: at >= info.blockTimeStamp ? Math.floor((at - info.blockTimeStamp) / BLOCK_MS) + 1 : 0,
      ageAtHours: Number(((at - info.blockTimeStamp) / 3_600_000).toFixed(2)),
    });
  }
  console.log(JSON.stringify({ at: new Date(at).toISOString(), atKyiv: kyiv(at), note: 'confirmationsAt is estimated from the 3-second TRON block interval', transactions: rows }, null, 2));
}

main().catch((error) => { console.error(`forensics failed: ${error.message}`); process.exitCode = 1; });
