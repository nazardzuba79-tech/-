# Issue636 — actual RU verification, 29 October 2026

No production configuration, TLS/DNS, Worker, API/DB code, financial flag, balance,
listing or timer change. One normal browser sign-in and logout occurred; their
ordinary session/last-seen metadata is not described as zero database writes. Hetzner cleanup and Wallet Conversion were not repeated.

## Sources and actual transport

- Fresh main `ad5bd1a7b9b537b9af92af6674686b663a79d5f5`;
  existing RU branch starts `e7b16eb8f0f358345946d32ef67ef68ad70ab2a2`.
- Pages canonical `95010b1c-b13f-4c52-b08c-a90ffa7d5d60`, source
  `6118e18e49edd226a6b250154d3893773b4522e2`; automatic production OFF,
  previews none. [Fresh browser API health](verification-20261029/api-health-after.json)
  isok at210aefac, started28Oct09:15:48UTC unchanged; no release was performed.
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
- The historical [old-certificate revocation receipt](live-old-cert-revoke.json)
  records successful Certbot revocation/deletion on26Oct20:20UTC. No new
  revocation was attempted and no fresh OCSP/CRL check is claimed.
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

Initial12 bounded HTTPS GETs all resolved185.23.35.226; same certificate as
Hetzner. Extended verification checked15 core lazy JS/CSS files for Register,
Spot, Futures, Markets, Settings, Wallet, Banking and Copy Trading:45 more
HTTP200 responses, correct JS/CSS MIME, not SPA HTML fallback. The HTTP probes
return only the first10KiB of bodies; they do not execute the modules.
KYC/me and Wallet/overview correctly returned401 without a session on all three
ISPs (6 responses). Banking/config reproduced the gateway403 on all three
(3 responses). Total22 measurements/66 GETs:57 HTTP200,6 expected401,
3 Banking403 defects, all with trusted TLS and the correct Beget address.
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
- Register1440/390 rendered its lazy RegisterPage, ReferralRedirectPage and utility
  chunks with HTTP200. No registration submitted or account created.
- Guest Spot, Futures, Banking and Settings in cloud Chrome, plus Wallet390
  and Markets390 in the exact-viewport renderer, redirect to ordinary login preserving next.
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
  No administrative page or command was opened. Current KYC account/session authorization,
  exact worker submit/materials/confirm paths, no-store, size4259840 and
  upstream certificate validation are retained.
- Executor Python asset GET got Cloudflare1010; no fingerprint spoofing or WAF
  change attempted. Chrome and all three RF probes got the entry JS200. That
  one client refusal is not represented as a general RU outage.
- Cloudflare rendering API rate limits caused diagnostic429 calls; those
  are provider test-tool limits, not VOLTEX responses. Subsequent sequential
  home1440 inspection succeeded. Truncated image outputs are not usable
  screenshots and are not supplied as evidence.

## Proven defects and narrowed, nonfinancial proposal

Direct loopback API gives401 Missing bearer token, while RU gives its own403
HTML BEFORE API for these five customer GETs:

- `/banking/config`, `/banking/state`, `/banking/referral`;
- `/copy-trading/nazar`, `/copy-trading/ksenia`.

Source review of the exact deployed API found that HTTP GET is not sufficient
to classify these as read-only:

- `src/banking/service.ts` state() calls syncAccruals(), which records accrued
  Banking ledger entries. It is not a payout, but it IS a financial-record write.
- `src/services/copyTrading/CopyPerformanceService.ts` get() can create/update
  CopyPerformanceScenario and append modeled history for a new UTC day.
- Banking config() only obtains market prices/config; referralSummary() only
  reads owner-filtered user/count/reward queries.

**Current candidate admits ONLY `/banking/config` and `/banking/referral` as
GET|HEAD.** Banking state and both strategy GETs intentionally remain blocked
until separately reviewed/approved. This cannot make Banking fully functional
by itself; it meets the current nonfinancial correction boundary. All financial
POSTs, admin/internal routes, JSON bodies, origin/TLS/peer/auth controls and
existing regular routes are unchanged. No production correction was applied.

Superseded five-rule proposal checkpoint ba676f53 passed19 isolated tests at
[run40839379410](https://github.com/nazardzuba79-tech/-/actions/runs/40839379410),
but that does NOT qualify the final narrower scope: the tests initially missed
the GET side effects. That five-rule proposal must NOT be applied under this
read-only permission. A new negative check was RED on it, then GREEN after the
three side-effecting GETs were removed. Local7 final policy/guard tests PASS.
The dedicated Ubuntu24 workflow now also asserts that those GETs never reach
the synthetic upstream, retaining all real Nginx/TLS/header/KYC/body-cap/admin/
JSON/WebSocket regressions. Final exact-head CI is the source of truth; do not
substitute the previous19-test PASS. No backend behavior/math was edited to
make a GET appear read-only.

`propose_customer_reads.py --input /private/current-ru.conf` is READ ONLY and
prints a diff; it rejects drift from the exact observed hash. Proposed config
hash `9cee50fb292066f8dab1356c34d222413ae82a9a8c74f990effa4ea74cb097a8`.
No automatic apply/reload command exists in this helper.

Future separately authorized rollout: save exact current RU file/root-only
backup, compare hash, inspect the two-line diff, validate `nginx -t`, reload
only Nginx after approval, verify API401 instead of gateway403 without a session
and owner-filtered reads with an ordinary session. If it fails, restore only
that saved RU file and validate/reload; leave main vhost/API/DB/Beget untouched.
This is a proposed procedure, not an executed rollback or production permission.

Public browser raw results: [exact viewport/resource matrix](verification-20261029/browser-public-matrix.json).

## Remaining blockers

Local extension still returns originating-browser-context error. A secure login
was completed in cloud Chrome. The resulting session rendered Futures with its
chart, book, real reference prices and existing positions (no order action).
The profile then exposed the ADMIN link. Deployed Nav shows that link only when
`api.getMe().isAdmin` is true, so this is NOT ordinary-user evidence. No personal
values or account identifiers were copied to this report. The session was
immediately logged out; direct Wallet returned to login. No admin page opened.
The sanitized [session QA receipt](verification-20261029/session-qa.json)
records this sign-in/logout and privileged Futures render only. It also
shows ADMIN login itself is not role-blocked at the RU login endpoint, although
admin/internal paths are denied. Enforcing an ADMIN-login ban would require a
separately reviewed authentication-policy change, not a cosmetic hidden link.

Ordinary-user authenticated KYC/Spot/Futures/Wallet/history/Banking and protected
mobile execution remain NOT VERIFIED. No supported cloud-browser viewport setter
was available for this authenticated session; real390 public/register rendering
is separately recorded. Do not transfer tokens to another renderer or mint
sessions from server secrets. An existing non-ADMIN account is required.
Registration form/lazy chunks passed, but successful account creation was not
attempted (it creates production account/session and accepts terms). KYC submit
was not attempted (it creates document/email/review state); no fake production
documents or real passports were sent. Current KYC account/session quota
separation is not certified by a401 unauthenticated probe.

[Actual negative controls](verification-20261029/public-negative-controls.json):
spoofed browser XFF/CF-IP still gets KYC401; spoofed Real-IP still gets admin403;
foreign Origin gets403. These do not prove that the relay cannot forge its
PROXY preamble: transport IP metadata is explicitly non-cryptographic, never
account ownership. API login throttling remains IP based; resistance to a
malicious relay rotating preamble IPs is not claimed or stress-tested.

The Hetzner VNC connection later disconnected before an optional repeated
console probe; reconnect was attempted once. The same no-write negative
controls then ran through public HTTPS instead. No session/credential reset
or server restart was performed.

Real RF HTTP availability now has evidence; authenticated browser behavior from
RF is still a separate test. Production application of the proposed two read
rules requires separate owner approval. Banking state accrual, strategy-history
append and Banking command admission require their own explicit review/decision.
No full-launch, legal authorization, all-ISP or financial-execution PASS.
