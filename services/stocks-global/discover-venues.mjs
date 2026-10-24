// Read-only, finite venue discovery. No ledger imports, trades, credentials or runtime changes.
// Usage: node services/stocks-global/discover-venues.mjs <evidence-directory> [venue,venue,...]
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { discover, renderTable, VENUE_DISCOVERY } from './venue-discovery.mjs';
const out = process.argv[2]; if (!out) throw Error('Explicit evidence directory required');
const venues = process.argv[3] ? process.argv[3].split(',') : Object.keys(VENUE_DISCOVERY);
for (const v of venues) if (!VENUE_DISCOVERY[v]) throw Error(`Unknown venue ${v}`);
await mkdir(out, { recursive: true });
const result = await discover({ venues });
await mkdir(resolve(out, 'raw'), { recursive: true });
for (const [n, r] of result.requests.entries()) await writeFile(resolve(out, 'raw', `${String(n).padStart(3, '0')}-${r.venue}-${r.kind}.json`), r.text ?? '');
const requests = result.requests.map(({ text, ...r }) => r);
await writeFile(resolve(out, 'discovery.json'), JSON.stringify({ ...result, requests }, null, 2));
await writeFile(resolve(out, 'discovery.md'), `# Venue discovery ${result.checkedAt}\n\n${renderTable(result.rows)}`);
console.log(JSON.stringify({ checkedAt: result.checkedAt, requests: requests.length, rows: result.rows.map(r => ({ venue: r.venue, ticker: r.ticker, status: r.status, http: r.http, symbol: r.venueSymbol, candles: r.candlesOk ?? null })) }, null, 2));
