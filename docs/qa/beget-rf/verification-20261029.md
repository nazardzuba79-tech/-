# Issue636 — actual RU verification, 29 October 2026

No production configuration, TLS/DNS, Worker, API/DB, financial flag, balance,
listing or timer change. Hetzner cleanup and Wallet Conversion were not repeated.

## Sources and actual transport

- Fresh main `ad5bd1a7b9b537b9af92af6674686b663a79d5f5`;
  existing RU branch starts `e7b16eb8f0f358345946d32ef67ef68ad70ab2a2`.
- Pages canonical `95010b1c-b13f-4c52-b08c-a90ffa7d5d60`, source
  `6118e18e49edd226a6b250154d3893773b4522e2`; automatic production OFF,
  previews none. API remains210aefac; no release was performed.
- Cloudflare authoritative NS: lana/thomas.ns.cloudflare.com. RU A185.23.35.226,
  unproxied. No DNS record was changed.
- Beget RUNNING Ubuntu24.04, 2vCPU/1GiB/20GiB. Active Nginx hash
  `09afdb6c46e8abb76bcd298c1d04b5627ae90de43b305ab8b477b627c93e66d5`;
  `nginx -t` PASS, PID31410 unchanged. SNI ru only ->138.199.227.130:18444,
  `ssl_preread on`, PROXY protocol; no TLS listener/key directive/HTTP server.
  Port80 forwards fixed18080. This is not an arbitrary HTTP proxy/VPN.
- Hetzner RU vhost actual hash
  `12ff7c12a2039d6086affed9ab65adf71c69339936494f309d2dfaa2b02161f6`,
  identical to the checked-in final checkpoint. TLS18444 requires PROXY;
  legacy18443 remains for rollback. Allowed transport peer Beget/loopback only.
- Current RU certificate on Hetzner: SHA256
  `C6:13:6F:C3:F9:7D:35:67:7A:C1:95:D0:EA:AB:7C:BC:83:18:92:F9:37:43:78:DD:C4:06:82:09:1F:61:29:E8`,
  CNru.voltextech.net, Let's Encrypt YE1; valid26Oct2026–24Jan2027.
  Private key metadata only: root0600. Certificate fingerprint matches all
  three independent RF ISP measurements. Hetzner `nginx -t` PASS.
- Beget bounded scan of72 regular files under1MiB across /etc/nginx,
  /etc/letsencrypt, /etc/ssl/private, /opt and /root found no PEM private-key
  file (symlinks and larger files excluded). One old production ACME account
  key remains; its account DOES NOT match the pinned trusted RU production
  account. Its contents were not printed. This is a residual secret, not the
  active RU TLS key, and was not deleted under this read-only task.
- Current CAA restricts production issuance to the Hetzner ACME account;
  validationmethods=dns-01,http-01. An additional staging-account CAA exists.
  The old Beget account is not the allowed production account. This is a
  control against ordinary CA issuance, not a guarantee against CA/DNS compromise
  or historical copies of secrets. No absolute absence-of-secrets claim.

Route: browser TLS -> opaque Beget -> Hetzner termination -> loopback API or
verified HTTPS public upstream. Only Hetzner rewrites static frontend origins;
JSON financial responses are not rewritten. Beget can observe connection
metadata or deny service; it cannot decrypt this TLS connection with its
observed configuration/materials. No VOLTEX DB, admin account or signing
credential was provisioned to Beget by this task.

## Actual Russian ISP availability (public requests, no account)

Globalping supplied countryRU + system `eyeball-network` + exact ASN filters:

| ISP / city | ASN | relay health | home HTML | entry JS | listing JSON | TLS |
|---|---:|---:|---:|---:|---:|---|
| MTS / Novosibirsk |8359|200|200|200|200|trusted TLS1.3|
| Rostelecom / Kostroma |12389|200|200|200|200|trusted TLS1.3|
| ER-Telecom / Saint Petersburg |51570|200|200|200|200|trusted TLS1.3|

12 bounded HTTPS GETs, all resolved185.23.35.226; same certificate as Hetzner.
Exact UTC times, durations, response types, probe metadata and public API IDs:
[sanitized raw measurements](verification-20261029/rf-isp-public-https.json).
Each result can be independently read at
`https://api.globalping.io/v1/measurements/<measurementId>`.
Globalping's official [probe policy](https://github.com/jsdelivr/globalping#probe-availability-rules)
says it excludes detected VPN/proxy probes. This is evidence from named ISP
nodes under that policy; the operator did not independently inspect each node's
physical connection. It is not a logged-in RF browser/KYC/financial test and
does not prove all Russian providers work.

## Actual browser and upstream checks

- Cloud Chrome opened real RU home and real login/register pages. Home prices,
  candles, book and recent trades loaded. Only extension metadata error in the
  inspected page console, not an application error.
- Actual rendered home1440x900 and390x844: scrollWidth equals viewport,
  same-origin entry JS/CSS and market/API calls succeed. Public font/icon
  resources still use Google Fonts, jsDelivr and CoinGecko; those are separate
  availability dependencies. Cross-origin ResourceTiming status0 is not treated
  as an HTTP failure. Complete authenticated/lazy-component coverage is NOT
  claimed from the public homepage.
- Register390 rendered its lazy RegisterPage, ReferralRedirectPage and utility
  chunks with HTTP200. No registration submitted or account created.
- Guest Wallet390 and Markets390 redirect to ordinary login preserving next.
  Guest redirect is an auth guard PASS, not a signed-in feature PASS.
- Both `wss://ru.voltextech.net/_voltex/ws/kraken` and `/bybit`: real101
  upgrades and public BTC ticker snapshots received; Bybit also delivered delta
  updates. Subscriptions only; no order command. Test origin Hetzner, not RF ISP.
- Deployed live-market adapter is SampledMarketSource: bounded GET snapshots,
  explicitly no EventSource stream. No active SSE PASS is invented.
- KYC `/api/v1/kyc/me` ->401 through RU, same as direct API. Worker active
  version `db1e9f2a-20ed-4d0d-9e59-716e9047a359`100%, deployment
  `1339592b-6bac-4b91-95f2-b0d79362a831`27Oct08:11:11UTC.
  RU origin is validated at Hetzner then mapped to the existing allowed primary
  origin. Worker peer pin138.199.227.130. No wildcard CORS or secret read/write.
- Admin `/api/v1/admin/users` and internal KYC authorization ->403 through RU.
  No administrator login attempted. Current KYC account/session authorization,
  exact worker submit/materials/confirm paths, no-store, size4259840 and
  upstream certificate validation are retained.
- Executor Python asset GET got Cloudflare1010; no fingerprint spoofing or WAF
  change attempted. Chrome and all three RF probes got the entry JS200. That
  one client refusal is not represented as a general RU outage.
- Cloudflare rendering concurrency limit caused two429 diagnostic calls; those
  are provider test-tool limits, not VOLTEX responses. Subsequent sequential
  home1440 inspection succeeded. Truncated image outputs are not usable
  screenshots and are not supplied as evidence.

## Proven defects and narrow proposed correction

Direct loopback API gives401 Missing bearer token, while RU gives its own403
HTML BEFORE API for these five customer GETs:

- `/banking/config`, `/banking/state`, `/banking/referral`;
- `/copy-trading/nazar`, `/copy-trading/ksenia`.

Candidate changes exactly five GET|HEAD map rules in the existing RU vhost;
keeps the source renderer and route inventory consistent. No prefix wildcard,
financial write, crypto-address/JSON rewrite, TLS/peer/Origin/auth/quotas change.
POST Banking calculate/placements/settle remain blocked. Therefore this
read-only correction alone is NOT a claim of fully functional Banking.
No production correction has been applied.

Local6 policy/negative/guard tests PASS. Initial RED: two checks failed on the
old config, before adding the missing five rules. The exact-head Ubuntu24.04
workflow runs real isolated Nginx/TLS fixture regressions, no production URLs,
secrets, database, Worker deployment or financial operations. Its actual final
result must be read before calling the transport checks PASS.

`propose_customer_reads.py --input /private/current-ru.conf` is READ ONLY and
prints a diff; it rejects drift from the exact observed hash. Proposed config
hash `c957542b3304f647dcac99ab602bb126aa93bf91bb9b2652ebc9366af98c863e`.
No automatic apply/reload command exists in this helper.

Future separately authorized rollout: save exact current RU file/root-only
backup, compare hash, inspect the five-line diff, validate `nginx -t`, reload
only Nginx after approval, verify API401 instead of gateway403 without a session
and owner-filtered reads with an ordinary session. If it fails, restore only
that saved RU file and validate/reload; leave main vhost/API/DB/Beget untouched.
This is a proposed procedure, not an executed rollback or production permission.

## Remaining blockers

Local extension still returns originating-browser-context error. Available
cloud browser has no ordinary VOLTEX session. Actual authenticated login/logout,
KYC upload/status, Spot/Futures account UI, Wallet/history, Banking and their
protected lazy components remain NOT VERIFIED in this attempt. Do not mint a
token/session from server secrets or copy administrator credentials into RU.
Secure normal-account login is the next user-dependent step. KYC submission
would also create production personal-data/email state; no fake production
documents were submitted under this read-only verification.

Real RF HTTP availability now has evidence; authenticated browser behavior from
RF is still a separate test. Production application of the proposed five read
rules and any Banking write-route admission require separate owner approval.
No full-launch, legal authorization, all-ISP or financial-execution PASS.
