#!/usr/bin/env python3
"""Owner-approved isolated ru endpoint on the EXISTING Hetzner only.

No API/container/database/financial-setting write. No primary-vhost edit.
All customer TLS termination stays on Hetzner; never transfer its keys.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import urllib.request

HOST = 'ru.voltextech.net'
HETZNER_IP = '138.199.227.130'
BEGET_IP = '185.23.35.226'
ROOT = Path('/opt/voltex-rf-endpoint')
VHOST = Path('/etc/nginx/conf.d/voltex-ru.conf')
DIRECTORY = 'https://acme-v02.api.letsencrypt.org/directory'
TERMS = 'https://letsencrypt.org/documents/LE-SA-v1.8-July-06-2026.pdf'
ROUTES = [["DELETE","/api-keys/:id"],["DELETE","/demo/orders/:orderId"],["DELETE","/futures/orders/:orderId"],["DELETE","/futures/positions/:positionId/protection"],["DELETE","/me/avatar"],["DELETE","/me/sessions/:id"],["DELETE","/orders/:orderId"],["DELETE","/private-trading/orders/:id"],["DELETE","/private-trading/previews/:id"],["GET","/account/security-log"],["GET","/analytics/open-interest-history"],["GET","/analytics/overview"],["GET","/api-keys"],["GET","/arbitrage/opportunities"],["GET","/balances"],["GET","/candles/:pair"],["GET","/card/application/me"],["GET","/card/waitlist/me"],["GET","/cfd/candles/:symbol"],["GET","/cfd/catalog"],["GET","/cfd/config"],["GET","/cfd/display/candles/:symbol"],["GET","/cfd/display/tickers"],["GET","/cfd/positions"],["GET","/cfd/positions/history"],["GET","/cfd/tickers"],["GET","/copy-trading/identities"],["GET","/copy-trading/identity/:traderId"],["GET","/copy-trading/marketplace"],["GET","/copy-trading/synthetic"],["GET","/demo/balances"],["GET","/demo/orderbook/:pair"],["GET","/demo/orders/history"],["GET","/demo/orders/open"],["GET","/demo/spot/access"],["GET","/demo/trades/:pair"],["GET","/deposit-address/:chain"],["GET","/deposit-catalogue"],["GET","/deposit-chains"],["GET","/deposit-config-version"],["GET","/deposits/me"],["GET","/futures/balances"],["GET","/futures/config"],["GET","/futures/funding-rate/:symbol"],["GET","/futures/mark-price/:symbol"],["GET","/futures/open-interest/:symbol"],["GET","/futures/orderbook/:symbol"],["GET","/futures/orders/me"],["GET","/futures/positions"],["GET","/futures/positions/:positionId/protection"],["GET","/futures/positions/history"],["GET","/market/assets"],["GET","/market/assets/icons"],["GET","/market/derivatives/:baseAsset"],["GET","/market/display/spot-snapshot"],["GET","/market/external/candles/:pair"],["GET","/market/external/orderbook/:pair"],["GET","/market/external/rankings"],["GET","/market/external/symbols"],["GET","/market/external/tickers"],["GET","/market/external/tickers/:pair"],["GET","/market/external/trades/:pair"],["GET","/market/featured-trader"],["GET","/market/futures/candles/:pair"],["GET","/market/global"],["GET","/market/options/instruments"],["GET","/market/options/tickers"],["GET","/market/snapshot"],["GET","/market/ticker/:pair"],["GET","/market/tradable"],["GET","/market/universe"],["GET","/me"],["GET","/me/sessions"],["GET","/orderbook/:pair"],["GET","/orders/me"],["GET","/otc/balances"],["GET","/otc/config"],["GET","/otc/requests/by-key/:key"],["GET","/private-trading/access"],["GET","/private-trading/candles"],["GET","/private-trading/cards/:id"],["GET","/private-trading/market"],["GET","/private-trading/native/account"],["GET","/private-trading/native/cards/:revision/:positionId"],["GET","/private-trading/native/collateral"],["GET","/private-trading/native/contracts/:symbol"],["GET","/private-trading/native/history"],["GET","/private-trading/native/live"],["GET","/private-trading/native/state"],["GET","/private-trading/native/wallet"],["GET","/private-trading/previews/:id"],["GET","/private-trading/state"],["GET","/products"],["GET","/purchases/me"],["GET","/referral/me"],["GET","/reserves"],["GET","/trades/me"],["GET","/wallet/overview"],["GET","/wallet/performance"],["GET","/wallet/portfolio-history"],["GET","/withdrawals/me"],["GET","/withdrawals/options"],["PATCH","/me/password"],["PATCH","/me/profile"],["PATCH","/orders/:orderId/trigger"],["PATCH","/private-trading/positions/:id"],["POST","/account/2fa/disable"],["POST","/account/2fa/setup"],["POST","/account/2fa/verify"],["POST","/api-keys"],["POST","/auth/login"],["POST","/auth/login/2fa"],["POST","/auth/logout"],["POST","/auth/register"],["POST","/card/application"],["POST","/card/waitlist/join"],["POST","/cfd/positions"],["POST","/cfd/positions/:positionId/close"],["POST","/demo/orders"],["POST","/deposit-address-copies"],["POST","/deposits/claim/:chain"],["POST","/futures/orders"],["POST","/futures/positions/:positionId/close"],["POST","/futures/transfer"],["POST","/orders"],["POST","/orders/oco"],["POST","/otc/requests"],["POST","/private-trading/allocate"],["POST","/private-trading/cards"],["POST","/private-trading/native/cards"],["POST","/private-trading/native/collateral-preference"],["POST","/private-trading/native/commands"],["POST","/private-trading/native/execution-session"],["POST","/private-trading/native/initialize"],["POST","/private-trading/native/quote"],["POST","/private-trading/positions/:id/close"],["POST","/private-trading/previews"],["POST","/private-trading/previews/:id/confirm"],["POST","/private-trading/scenarios/:id/advance"],["POST","/private-trading/scenarios/:id/close-on-chart"],["POST","/purchases"],["POST","/support/request"],["POST","/wallet/portfolio-snapshot"],["POST","/withdrawals"],["PUT","/futures/positions/:positionId/protection"],["PUT","/me/avatar"],["GET","/market/test-assets"],["GET","/market/test-assets/:pair"],["GET","/market/test-assets/:pair/candles"]]
REWRITES = {
    'https://api.voltextech.net': 'https://' + HOST,
    'https://market.voltextech.net': 'https://' + HOST + '/_voltex/market',
    'https://kyc.voltextech.net': 'https://' + HOST + '/_voltex/kyc',
    'https://voltex-deposit-catalogue-production.nazardzuba79.workers.dev': 'https://' + HOST + '/_voltex/catalogue',
    'https://api.kraken.com': 'https://' + HOST + '/_voltex/kraken',
    'https://api.bybit.com': 'https://' + HOST + '/_voltex/bybit',
    'https://api.bytick.com': 'https://' + HOST + '/_voltex/bytick',
    'wss://ws.kraken.com/v2': 'wss://' + HOST + '/_voltex/ws/kraken',
    'wss://stream.bybit.com/v5/public/linear': 'wss://' + HOST + '/_voltex/ws/bybit',
}


def route_pattern(path):
    # Express decoded pair parameters may contain a slash, but never change
    # the fixed route prefix. Exact allowlist plus sensitive-segment deny.
    return '/'.join('[A-Za-z0-9_./:-]+' if part.startswith(':') else re.escape(part)
                    for part in path.split('/'))


def render(prefix=str(ROOT), port=18443, fixture_port=None, cert=None, key=None):
    prefix = str(Path(prefix).resolve())
    if any(c in prefix for c in '\n\r;{}"\' $') or not 0 < port < 65536:
        raise ValueError('Unsafe configuration input')
    test = fixture_port is not None
    cert = cert or '/etc/letsencrypt/live/' + HOST + '/fullchain.pem'
    key = key or '/etc/letsencrypt/live/' + HOST + '/privkey.pem'
    for p in (cert, key):
        if not Path(p).is_absolute() or any(c in p for c in '\n\r;{}"\' $'):
            raise ValueError('Unsafe certificate path')
    maps = '''map $http_upgrade $voltex_ru_upgrade { default upgrade; '' close; }
map $http_origin $voltex_ru_foreign { default 1; "" 0; "https://ru.voltextech.net" 0; }
map $http_origin $voltex_ru_origin { default ""; "https://ru.voltextech.net" "https://voltextech.net"; }
map "$request_method:$http_origin" $voltex_ru_unsafe {
  default 1; ~^(GET|HEAD): 0;
  ~^(POST|PUT|PATCH|DELETE|OPTIONS):https://ru\\.voltextech\\.net$ 0;
}
map $uri $voltex_ru_sensitive {
  default 0;
  ~*(^|/)(admin|kyc|internal)(/|$) 1;
  ~*^/api/v1/demo/(vta|liquidity)(/|$) 1;
  ~*^/api/v1/market/status(/|$) 1;
}
map $request_uri $voltex_ru_ambiguous {
  default 0;
  "~*^[^?]*(%25|%5c|%00|;)" 1;
}
map "$request_method:$uri" $voltex_ru_api_allowed {
  default 0;
'''
    for method, path in ROUTES:
        methods = '(GET|HEAD)' if method == 'GET' else method
        maps += f'  ~^{methods}:/api/v1{route_pattern(path)}$ 1;\n'
    maps += '}\n'
    conf = maps
    if not test:
        conf += f'''server {{
  listen 18080; server_name {HOST};
  allow {BEGET_IP}; allow 127.0.0.1; deny all;
  access_log off; error_log {prefix}/error.log crit;
  location ^~ /.well-known/acme-challenge/ {{ root {prefix}/acme; }}
  location / {{ return 444; }}
}}
'''
    conf += f'''server {{
  listen {'127.0.0.1:' if test else ''}{port} ssl http2;
  server_name {HOST};
  ssl_certificate {cert}; ssl_certificate_key {key};
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_session_tickets off;
  server_tokens off;
  resolver 127.0.0.53 ipv6=off valid=300s;
  {'allow ' + BEGET_IP + ';' if not test else ''}
  allow 127.0.0.1; deny all;
  access_log off; error_log {prefix}/error.log crit;
  client_max_body_size 10m;
  client_body_temp_path {prefix}/client;
  proxy_temp_path {prefix}/proxy;
  if ($host != "{HOST}") {{ return 444; }}
  if ($voltex_ru_foreign) {{ return 403; }}
  if ($voltex_ru_unsafe) {{ return 403; }}
  if ($voltex_ru_sensitive) {{ return 403; }}
  if ($voltex_ru_ambiguous) {{ return 400; }}
  location = /_voltex/health {{ default_type text/plain; add_header Cache-Control no-store always; return 200 "voltex-rf-hetzner\\n"; }}
'''

    def proxy(host, uri, private=False, html=False, websocket=False):
        target = f'127.0.0.1:{fixture_port}' if test else ('127.0.0.1:13020' if private else host)
        proto = 'http' if test or private else 'https'
        text = f'''    set $voltex_ru_target {target};
    proxy_pass {proto}://$voltex_ru_target{uri};
    proxy_http_version 1.1;
    proxy_set_header Host {host};
    proxy_set_header Forwarded "";
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-Host {HOST};
    proxy_set_header CF-Connecting-IP "";
    proxy_set_header Connection "";
    proxy_request_buffering off;
    proxy_next_upstream off;
    proxy_buffering off;
    proxy_cache off;
    proxy_store off;
    proxy_read_timeout {'3600s' if websocket else '90s'};
    proxy_hide_header Cache-Control;
    proxy_hide_header Expires;
    add_header Cache-Control no-store always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header Strict-Transport-Security "max-age=86400" always;
'''
        if not test and not private:
            text += f'''    proxy_ssl_server_name on;
    proxy_ssl_name {host};
    proxy_ssl_verify on;
    proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;
'''
        if private:
            text += '    proxy_set_header Origin $voltex_ru_origin;\n'
        else:
            text += '''    proxy_set_header Authorization "";
    proxy_set_header Cookie "";
    proxy_hide_header Set-Cookie;
    if ($request_method !~ "^(GET|HEAD)$") { return 405; }
'''
        if websocket:
            text += '''    if ($http_origin != "https://ru.voltextech.net") { return 403; }
    if ($http_upgrade != websocket) { return 426; }
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $voltex_ru_upgrade;
'''
        if html:
            text += '''    proxy_set_header Accept-Encoding "";
    proxy_redirect https://voltextech.net/ https://ru.voltextech.net/;
    sub_filter_once off;
    sub_filter_types text/css application/javascript text/javascript;
    add_header Content-Security-Policy "connect-src 'self' wss://ru.voltextech.net" always;
'''
            for old, new in REWRITES.items():
                text += f"    sub_filter '{old}' '{new}';\n"
        return text

    conf += '''  location ^~ /api/v1/ {
    if ($voltex_ru_api_allowed = 0) { return 403; }
'''
    conf += proxy('api.voltextech.net', '$request_uri', private=True) + '  }\n'
    for match, host, uri, ws in [
        ('~ "^(?:/_voltex/market){1,2}(?<voltex_ru_market>/(?:market/(?:display|listings|test-assets|nrx)(?:/[^?]*)?|cfd/display/[^?]*|health))$"', 'market.voltextech.net', '$voltex_ru_market$is_args$args', False),
        ('= /_voltex/catalogue/public/deposit-catalogue', 'voltex-deposit-catalogue-production.nazardzuba79.workers.dev', '/public/deposit-catalogue$is_args$args', False),
        ('~ ^/_voltex/kraken/0/public/(?<voltex_ru_kraken>Depth|OHLC|Trades|Ticker|AssetPairs|Time)$', 'api.kraken.com', '/0/public/$voltex_ru_kraken$is_args$args', False),
        ('~ ^/_voltex/bybit/v5/market/(?<voltex_ru_bybit>tickers|kline|orderbook|recent-trade)$', 'api.bybit.com', '/v5/market/$voltex_ru_bybit$is_args$args', False),
        ('~ ^/_voltex/bytick/v5/market/(?<voltex_ru_bytick>tickers|kline|orderbook|recent-trade)$', 'api.bytick.com', '/v5/market/$voltex_ru_bytick$is_args$args', False),
        ('= /_voltex/ws/kraken', 'ws.kraken.com', '/v2', True),
        ('= /_voltex/ws/bybit', 'stream.bybit.com', '/v5/public/linear', True),
    ]:
        conf += '  location ' + match + ' {\n' + proxy(host, uri, websocket=ws) + '  }\n'
    conf += '  location /_voltex/ { return 404; }\n  location / {\n'
    conf += proxy('voltextech.net', '$request_uri', html=True) + '  }\n}\n'
    return conf


def run(args, timeout=30):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout)


def identity():
    if os.geteuid() != 0:
        raise RuntimeError('Root required on the approved existing Hetzner')
    rows = json.loads(subprocess.check_output(['ip', '-j', 'address'], text=True))
    if not any(a.get('local') == HETZNER_IP for n in rows for a in n.get('addr_info', [])):
        raise RuntimeError('Wrong server; Beget may NEVER execute this installer')


def primary_snapshot():
    response = run(['curl', '-fsS', '--max-time', '5', 'http://127.0.0.1:13020/health'])
    if response.returncode:
        raise RuntimeError('Primary loopback API not healthy')
    return {'api': json.loads(response.stdout), 'mainVhostSha256': hashlib.sha256(Path('/etc/nginx/conf.d/voltex.conf').read_bytes()).hexdigest()}


def prepare():
    identity()
    before = primary_snapshot()
    if shutil.which('certbot') is None:
        subprocess.run(['apt-get', 'update', '-qq'], check=True, timeout=180)
        subprocess.run(['apt-get', 'install', '-y', '--no-upgrade', '--no-install-recommends', 'certbot'], check=True, timeout=240)
    with urllib.request.urlopen(DIRECTORY, timeout=15) as response:
        terms = json.load(response).get('meta', {}).get('termsOfService')
    if terms != TERMS:
        raise RuntimeError('LE terms differ from the exact owner-approved agreement')
    os.umask(0o077)
    ROOT.mkdir(mode=0o700, exist_ok=True)
    subprocess.run(['certbot', 'register', '--non-interactive', '--agree-tos',
                    '--register-unsafely-without-email', '--server', DIRECTORY], check=True, timeout=60)
    accounts = list(Path('/etc/letsencrypt/accounts/acme-v02.api.letsencrypt.org/directory').glob('*/regr.json'))
    if len(accounts) != 1:
        raise RuntimeError('Ambiguous ACME accounts; do not choose automatically')
    account = json.loads(accounts[0].read_text())['uri']
    (ROOT / 'prepared.json').write_text(json.dumps({'before': before, 'account': account, 'at': datetime.now(timezone.utc).isoformat()}, indent=2))
    print('CAA_RU_VALUE=letsencrypt.org;validationmethods=dns-01;accounturi=' + account, flush=True)


def certificate():
    identity()
    if (ROOT / 'certificate-requested').exists():
        raise RuntimeError('Certificate already requested; inspect instead of automatic retries')
    if not (ROOT / 'prepared.json').exists():
        raise RuntimeError('Prepare first')
    (ROOT / 'certificate-requested').write_text(datetime.now(timezone.utc).isoformat())
    # Intentionally interactive: operator adds the public DNS TXT in the existing
    # authorized Cloudflare UI. No DNS credentials are created or copied.
    subprocess.run(['certbot', 'certonly', '--manual', '--preferred-challenges', 'dns',
                    '--cert-name', HOST, '-d', HOST, '--server', DIRECTORY,
                    '--agree-tos', '--register-unsafely-without-email'], check=True)


def install():
    identity()
    before = primary_snapshot()
    cert = Path('/etc/letsencrypt/live') / HOST / 'fullchain.pem'
    subprocess.run(['openssl', 'x509', '-in', str(cert), '-noout', '-checkend', '2592000'], check=True)
    if VHOST.exists():
        raise RuntimeError('Existing RU vhost; inspect, never overwrite blindly')
    with socket.socket() as s:
        s.bind(('0.0.0.0', 18443))
    os.umask(0o077)
    backup = ROOT / ('backup-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    shutil.copytree('/etc/nginx', backup / 'nginx', symlinks=True)
    (backup / 'before.json').write_text(json.dumps(before, indent=2))
    uid = __import__('pwd').getpwnam('www-data').pw_uid
    gid = __import__('pwd').getpwnam('www-data').pw_gid
    ROOT.chmod(0o750)
    os.chown(ROOT, 0, gid)
    for name in ('client', 'proxy', 'acme'):
        p = ROOT / name
        p.mkdir(mode=0o700, exist_ok=True)
        os.chown(p, uid, gid)
        p.chmod(0o700 if name != 'acme' else 0o755)
    VHOST.write_text(render())
    VHOST.chmod(0o600)
    try:
        subprocess.run(['nginx', '-t'], check=True, timeout=15)
        subprocess.run(['systemctl', 'reload', 'nginx'], check=True, timeout=20)
        import time
        for _ in range(20):
            health = run(['curl', '-fsS', '--max-time', '2', '--noproxy', '*', '--resolve',
                          HOST + ':18443:127.0.0.1', 'https://' + HOST + ':18443/_voltex/health'])
            if health.returncode == 0 and health.stdout.strip() == 'voltex-rf-hetzner':
                break
            time.sleep(0.25)
        else:
            raise RuntimeError('RU TLS health failed')
        after = primary_snapshot()
        if (before['mainVhostSha256'] != after['mainVhostSha256'] or
                before['api']['commit'] != after['api']['commit'] or
                abs((datetime.fromisoformat(before['api']['startedAt'].replace('Z', '+00:00')) -
                     datetime.fromisoformat(after['api']['startedAt'].replace('Z', '+00:00'))).total_seconds()) > 2):
            raise RuntimeError('Primary API runtime or vhost changed')
        (ROOT / 'installed.json').write_text(json.dumps({'before': before, 'after': after,
            'backup': str(backup), 'vhostSha256': hashlib.sha256(VHOST.read_bytes()).hexdigest(),
            'status': 'TRUSTED_TLS_HEALTH_PASS', 'at': datetime.now(timezone.utc).isoformat()}, indent=2))
        print('TRUSTED_TLS_HEALTH_PASS; primary unchanged', flush=True)
    except BaseException:
        VHOST.unlink(missing_ok=True)
        subprocess.run(['nginx', '-t'], check=True, timeout=15)
        subprocess.run(['systemctl', 'reload', 'nginx'], check=True, timeout=20)
        raise


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=['inspect', 'prepare', 'cert', 'install', 'rollback'])
    args = p.parse_args()
    identity()
    if args.action == 'inspect':
        print(json.dumps(primary_snapshot(), indent=2))
    elif args.action == 'prepare':
        prepare()
    elif args.action == 'cert':
        certificate()
    elif args.action == 'install':
        install()
    elif args.action == 'rollback':
        expected = json.loads((ROOT / 'installed.json').read_text())['vhostSha256']
        if hashlib.sha256(VHOST.read_bytes()).hexdigest() != expected:
            raise RuntimeError('RU vhost drift; inspect before rollback')
        VHOST.unlink()
        subprocess.run(['nginx', '-t'], check=True, timeout=15)
        subprocess.run(['systemctl', 'reload', 'nginx'], check=True, timeout=20)
        print('Only RU vhost removed; primary config untouched')


if __name__ == '__main__':
    main()
