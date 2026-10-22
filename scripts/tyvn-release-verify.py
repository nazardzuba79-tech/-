#!/usr/bin/env python3
"""TYVN API switch: public before/after evidence. GET ONLY — no login, no secrets, no writes.

  baseline --out FILE [--local-api http://127.0.0.1:13020]
      Records what the API switch must not change, plus the revision it runs.
  verify --baseline FILE --expect-api-sha <40-hex> [--local-api URL] [--allow-tyvn-public]
      Repeats every read and compares it with the baseline. Exit 0 = PASS, 2 = FAIL.

What is compared (the API switch touches api-production only):
  API      /health revision (public, and local when --local-api is given);
           anonymous Admin Listings and Wallet balances are 401;
           public test-asset catalogue (pairs, tradability, status, listing time, price);
           AITH unknown to the API (it lives on the market edge); NRX redirected to the edge;
           Futures symbols; Spot display snapshot and external candles; Futures candles.
  Edge     Worker version; public listings (AITH present, TYVN absent unless allowed,
           every listed pair's identity unchanged); NRX catalogue;
           AITH and NRX hourly candles that had closed before the baseline — identical.

Nothing here logs in, places an order, publishes, starts a timer or touches PostgreSQL.
The edge, the Worker and the frontend are read only to prove the switch left them alone.
"""
import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request

SHA = re.compile(r'^[0-9a-f]{40}$')
API = 'https://api.voltextech.net'
EDGE = 'https://market.voltextech.net'
HOUR = 3600


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def get(url):
    """One GET with retries; returns (status, parsed JSON or None, Location header)."""
    last = None
    for attempt in range(3):
        request = urllib.request.Request(url, headers={'Accept': 'application/json', 'Cache-Control': 'no-cache', 'User-Agent': 'voltex-tyvn-release-verify'})
        try:
            with OPENER.open(request, timeout=20) as response:
                body = response.read()
                status, location = response.status, response.headers.get('Location')
        except urllib.error.HTTPError as error:
            body, status, location = error.read(), error.code, error.headers.get('Location')
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            last = error
            time.sleep(1 + attempt)
            continue
        try:
            payload = json.loads(body)
        except ValueError:
            payload = None
        return status, payload, location
    raise SystemExit(f'FAIL: GET {url} did not answer ({type(last).__name__})')


def closed_candles(payload, before):
    """Hourly candles that had closed before `before` (unix seconds), keyed by open time."""
    candles = (payload or {}).get('candles') or []
    return {str(c['time']): [c['open'], c['high'], c['low'], c['close'], c['volume']] for c in candles if c['time'] + HOUR <= before}


def listing_identity(asset):
    keys = ('pair', 'symbol', 'isTradable', 'status', 'listingArmed', 'listingAt', 'initialPrice', 'version', 'listingId', 'countdown')
    return {key: asset.get(key) for key in keys if key in asset}


def observe(api, edge, local_api):
    """Reads everything once. Values are public data only."""
    seen = {'capturedAt': int(time.time())}
    status, health, _ = get(f'{api}/health')
    seen['api.health'] = {'status': status, 'ok': (health or {}).get('status'), 'commit': (health or {}).get('commit'), 'startedAt': (health or {}).get('startedAt')}
    if local_api:
        status, local, _ = get(f'{local_api}/health')
        seen['api.local.health'] = {'status': status, 'commit': (local or {}).get('commit'), 'startedAt': (local or {}).get('startedAt')}
    seen['api.admin.listings.anonymous'] = get(f'{api}/api/v1/admin/listings')[0]
    seen['api.wallet.balances.anonymous'] = get(f'{api}/api/v1/balances')[0]
    status, assets, _ = get(f'{api}/api/v1/market/test-assets')
    seen['api.test-assets'] = {'status': status, 'assets': sorted((listing_identity(a) for a in (assets or {}).get('assets', [])), key=lambda a: a.get('pair', ''))}
    seen['api.test-assets.AITH'] = get(f'{api}/api/v1/market/test-assets/AITH-USDT')[0]
    status, _, location = get(f'{api}/api/v1/market/test-assets/NRX-USDT')
    seen['api.test-assets.NRX'] = {'status': status, 'location': location}
    status, futures, _ = get(f'{api}/api/v1/futures/config')
    seen['api.futures.symbols'] = {'status': status, 'symbols': sorted((futures or {}).get('symbols') or [])}
    status, spot, _ = get(f'{api}/api/v1/market/display/spot-snapshot')
    seen['api.spot.snapshot'] = {'status': status, 'tickersAvailable': ((spot or {}).get('tickers') or {}).get('available')}
    status, external, _ = get(f'{api}/api/v1/market/external/candles/BTC-USDT?interval=1h&limit=2')
    seen['api.spot.btc.candles'] = {'status': status, 'count': len((external or {}).get('candles') or [])}
    status, perp, _ = get(f'{api}/api/v1/market/futures/candles/BTC-USDT?interval=1h&limit=2')
    seen['api.futures.btc.candles'] = {'status': status, 'retCode': (perp or {}).get('retCode')}
    status, worker, _ = get(f'{edge}/health')
    seen['edge.health'] = {'status': status, 'version': (worker or {}).get('version')}
    status, listings, _ = get(f'{edge}/market/listings')
    seen['edge.listings'] = {'status': status, 'assets': sorted((listing_identity(a) for a in (listings or {}).get('assets', [])), key=lambda a: a.get('pair', ''))}
    status, nrx, _ = get(f'{edge}/market/nrx')
    seen['edge.nrx'] = {'status': status, 'assets': sorted((listing_identity(a) for a in (nrx or {}).get('assets', [])), key=lambda a: a.get('pair', ''))}
    for symbol in ('AITH', 'NRX'):
        status, candles, _ = get(f'{edge}/market/test-assets/{symbol}-USDT/candles?interval=1h&limit=48')
        seen[f'edge.{symbol}.candles'] = {'status': status, 'closed': closed_candles(candles, seen['capturedAt'])}
    return seen


def pairs(entry):
    return [asset.get('pair') for asset in entry.get('assets', [])]


def baseline(args):
    seen = observe(args.api, args.edge, args.local_api)
    with open(args.out, 'w', encoding='utf-8') as handle:
        json.dump(seen, handle, indent=1, sort_keys=True)
    print(f"baseline written: {args.out}")
    print(f"  API revision {seen['api.health']['commit']} (started {seen['api.health']['startedAt']}); Worker {seen['edge.health']['version']}")
    print(f"  public listings {pairs(seen['edge.listings'])}; AITH closed 1h candles {len(seen['edge.AITH.candles']['closed'])}, NRX {len(seen['edge.NRX.candles']['closed'])}")


def verify(args):
    if not SHA.match(args.expect_api_sha):
        raise SystemExit('FAIL: --expect-api-sha must be a full 40-character commit')
    with open(args.baseline, encoding='utf-8') as handle:
        before = json.load(handle)
    after = observe(args.api, args.edge, args.local_api)
    results = []

    def check(name, ok, detail=''):
        results.append((name, bool(ok)))
        print(f"{'PASS' if ok else 'FAIL'}  {name}{(' — ' + detail) if detail else ''}")

    health = after['api.health']
    check('public /health is ok and runs the expected revision', health['status'] == 200 and health['ok'] == 'ok' and health['commit'] == args.expect_api_sha, f"{health['commit']}")
    if args.local_api:
        local = after['api.local.health']
        check('local /health runs the expected revision', local['status'] == 200 and local['commit'] == args.expect_api_sha, f"{local['commit']}")
    check('anonymous Admin Listings is 401', after['api.admin.listings.anonymous'] == 401, str(after['api.admin.listings.anonymous']))
    check('anonymous Wallet balances is 401', after['api.wallet.balances.anonymous'] == 401, str(after['api.wallet.balances.anonymous']))
    check('API test-asset catalogue unchanged', after['api.test-assets'] == before['api.test-assets'], f"{pairs(after['api.test-assets'])}")
    check('AITH answers on the API as before', after['api.test-assets.AITH'] == before['api.test-assets.AITH'], str(after['api.test-assets.AITH']))
    check('NRX on the API redirects to the edge as before', after['api.test-assets.NRX'] == before['api.test-assets.NRX'], str(after['api.test-assets.NRX']))
    check('Futures symbols unchanged', after['api.futures.symbols'] == before['api.futures.symbols'], f"{len(after['api.futures.symbols']['symbols'])} symbols")
    check('Spot display snapshot available', after['api.spot.snapshot'] == {'status': 200, 'tickersAvailable': True})
    check('Spot external candles answer', after['api.spot.btc.candles']['status'] == 200 and after['api.spot.btc.candles']['count'] > 0)
    check('Futures candles answer', after['api.futures.btc.candles'] == {'status': 200, 'retCode': 0})
    check('Worker version unchanged', after['edge.health'] == before['edge.health'], str(after['edge.health']['version']))
    listed = pairs(after['edge.listings'])
    check('AITH still public', 'AITH/USDT' in listed)
    if not args.allow_tyvn_public:
        check('TYVN not public', 'TYVN/USDT' not in listed, f'{listed}')
    unchanged = [a for a in after['edge.listings']['assets'] if a.get('pair') != 'TYVN/USDT']
    previous = [a for a in before['edge.listings']['assets'] if a.get('pair') != 'TYVN/USDT']
    check('every other public listing unchanged (identity, version, time, price, timer)', unchanged == previous)
    check('NRX catalogue unchanged', after['edge.nrx'] == before['edge.nrx'])
    for symbol in ('AITH', 'NRX'):
        old, new = before[f'edge.{symbol}.candles']['closed'], after[f'edge.{symbol}.candles']['closed']
        shared = sorted(set(old) & set(new))
        same = all(old[t] == new[t] for t in shared)
        check(f'{symbol} closed hourly candles identical', after[f'edge.{symbol}.candles']['status'] == 200 and len(shared) >= 12 and same, f'{len(shared)} compared')
    failed = [name for name, ok in results if not ok]
    print(f"{'PASS' if not failed else 'FAIL'}: {len(results) - len(failed)}/{len(results)} checks")
    sys.exit(2 if failed else 0)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument('--api', default=API)
    common.add_argument('--edge', default=EDGE)
    common.add_argument('--local-api', default=None, help='the server-local API, e.g. http://127.0.0.1:13020 (on the server only)')
    sub = parser.add_subparsers(dest='command', required=True)
    b = sub.add_parser('baseline', parents=[common])
    b.add_argument('--out', required=True)
    v = sub.add_parser('verify', parents=[common])
    v.add_argument('--baseline', required=True)
    v.add_argument('--expect-api-sha', required=True)
    v.add_argument('--allow-tyvn-public', action='store_true', help='only after TYVN publication was separately approved')
    args = parser.parse_args()
    baseline(args) if args.command == 'baseline' else verify(args)


if __name__ == '__main__':
    main()
