# VOLTEX Solana Stocks public-only Beget offload — code-only prototype

**OFF by default; not deployed.** This is a bounded fan-out of **signed, already verified** `voltex.solana-ohlcv.v1` pages. It does **not** fetch RPC, prove Solana execution, produce candles, accept transactions, place orders, read personal data or perform KYC. It **does not** solve Stocks' 240/min private authorization quota; Stocks #613 R8 +22.73% p95 stays NO-GO.

## Reason for isolation

Beget `voltex-ru-gateway-01` has 2 vCPU, **1 GiB RAM**, ~344 MB mean used and ~2.5% mean CPU (Beget read-only API, 2026-10-29). Public serving may fit, but no measured throughput or allowed licensing was established. Never move PostgreSQL, a signing private key, a JWT, an admin route, balance, portfolio, session, authority, wallet or order code to Beget. Never repurpose the current ru.voltextech.net gateway path without a separate reviewed release.

## Runtime

```sh
node --test scripts/ops/stocks-public-relay/relay.test.mjs
VOLTEX_PUBLIC_RELAY_ENABLE=1 \
VOLTEX_PUBLIC_RELAY_PUBKEY_FILE=/path/to/public-spki.pem \
VOLTEX_PUBLIC_RELAY_SNAPSHOT=/path/to/signed-snapshot.json \
node scripts/ops/stocks-public-relay/relay.mjs
```

The only listener is `127.0.0.1:4477`; publish via a **separate reviewed** read-only host/path, not a general proxy. No production deployment is authorized here. External TLS/reverse proxy, DNS, permissions, cgroup limits, systemd unit and origin routing are intentionally **not** changed. `/health` checks transport only and is **not** proof of quote readiness. `/v1/public/ohlcv?instrumentId=SOLANA:<mint>:<pool>&interval=1m` returns the **original** signed envelope or 503. `/v1/public/stream?...` fan-outs it at most once per source change, max 64 streams, 64-KiB output buffer and event `unavailable` on failure. Unknown URI/method returns 404/405; no credentials are read or forwarded.

## Critical trust boundary

A signed snapshot is `{ "payloadB64": "...", "signatureB64": "..." }`. Signature is Ed25519 over the **decoded exact UTF-8 payload**. Producer must sign only after independent, full Solana source attestation; signature verification and boolean `gates:true` are **not** substitutes for the missing program binary proof, historical mint/fee chronology and complete finalized block coverage (currently **0 accepted markets/intervals** from Stocks #615/#621). Until a separate attested producer exists, the endpoint must return `SOURCE_UNAVAILABLE`. Never ship test keys or fixture prices.

The public key is configured out-of-band and must be **pinned in the independently delivered Cloudflare frontend**, which must verify every envelope (source, signature, expiry, instrument, range and proof) before display. **That browser verifier is NOT implemented here.** Without it, a provider controlling Beget's TLS/HTML/JS can forge a display even though the local relay checks its own inputs. Treat Beget data as untrusted even after this prototype; it must **never drive order execution or deposits**. Replay is limited to 30 s by the local verifier, but Beget can withhold service or send older responses to non-verifying clients.

The current marketplace source issue remains unsolved. No verified Solana snapshots exist. No API licence/right is implied by this code. A technical test must not be represented as a public Stocks launch.

## Test/review gates before further work

- Verify host capacity / CPU, RAM under **real** 50 concurrent consumers, zero external private requests; stop on memory/connection pressure.
- Integrate independent Cloudflare-frontend WebCrypto verification and reject unknown/expired/modified messages *before* UI state changes; no financial endpoints or tokens in relay traffic.
- Build a real bounded Solana attestor from #615/#621 receipts, not boolean claims. No synthetic/fabricated OHLCV or CEX feed.
- Prove actual p95 and private 240/min behaviour on an isolated environment *before* replacing the #613 acceptance path. Do not treat moving a public file to Beget as solving trade-command CPU and quota.

No server, CDN, database, financial state, worker, listing, timer, PR #613 or user data was changed by this branch.
