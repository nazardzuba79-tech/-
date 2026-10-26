#!/usr/bin/env python3
"""Render an own-application gateway, never an arbitrary URL proxy. No server writes."""
import argparse
import ipaddress
import os
import pwd
from pathlib import Path

HOST = 'ru.voltextech.net'
REWRITES = {
    'https://api.voltextech.net': 'https://' + HOST,
    # Keep a distinct base: isEdgeMarketUrl compares this URL prefix with API URLs.
    'https://market.voltextech.net': 'https://' + HOST + '/_voltex/market',
    'https://kyc.voltextech.net': 'https://' + HOST + '/_voltex/kyc',
    'https://voltex-deposit-catalogue-production.nazardzuba79.workers.dev': 'https://' + HOST + '/_voltex/catalogue',
    'https://api.kraken.com': 'https://' + HOST + '/_voltex/kraken',
    'https://api.bybit.com': 'https://' + HOST + '/_voltex/bybit',
    'https://api.bytick.com': 'https://' + HOST + '/_voltex/bytick',
    'wss://ws.kraken.com/v2': 'wss://' + HOST + '/_voltex/ws/kraken',
    'wss://stream.bybit.com/v5/public/linear': 'wss://' + HOST + '/_voltex/ws/bybit',
}


def render(prefix='/etc/nginx/voltex-rf', resolver='127.0.0.53', port=443,
           fixture_port=None, cert=None, key=None, bootstrap=False):
    """fixture_port is loopback-only, used by isolated tests, not a production target."""
    # Owner security order supersedes the former Beget TLS-terminating design.
    # The legacy L7 implementation is retained only for loopback regression fixtures.
    ipaddress.ip_address(resolver)
    prefix = str(Path(prefix).resolve())
    if any(c in prefix for c in '\n\r;{}"\' ') or not 1 <= port <= 65535:
        raise ValueError('unsafe path or port')
    if fixture_port is not None and not 1 <= fixture_port <= 65535:
        raise ValueError('invalid fixture port')
    cert = cert or '/etc/letsencrypt/live/' + HOST + '/fullchain.pem'
    key = key or '/etc/letsencrypt/live/' + HOST + '/privkey.pem'
    for path in (cert, key):
        if not Path(path).is_absolute() or any(c in path for c in '\n\r;{}"\' '):
            raise ValueError('unsafe certificate path')
    if fixture_port is None:
        from security_hold import CONFIG
        return CONFIG
    test = fixture_port is not None
    bind = f'127.0.0.1:{port}' if test else str(port)
    setup = (f'user {pwd.getpwuid(os.geteuid()).pw_name};\nmaster_process off;' if test else 'user www-data;')
    common = '''
      proxy_http_version 1.1;
      proxy_cache off;
      proxy_store off;
      proxy_request_buffering off;
      proxy_next_upstream off;
      proxy_set_header Forwarded "";
      proxy_set_header X-Forwarded-For $remote_addr;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-Proto https;
      proxy_set_header X-Forwarded-Host ru.voltextech.net;
      proxy_set_header Connection "";
      proxy_hide_header Cache-Control;
      proxy_hide_header Expires;
      add_header Cache-Control "no-store" always;
      add_header X-Content-Type-Options nosniff always;
      add_header Referrer-Policy strict-origin-when-cross-origin always;
      add_header Strict-Transport-Security "max-age=86400" always;
'''
    def proxy(host, uri, private=False, ws=False, html=False):
        proto = 'http' if test else 'https'
        target = f'127.0.0.1:{fixture_port}' if test else host
        conf = common + f'      set $fixed_upstream {target};\n      proxy_set_header Host {host};\n'
        conf += f'      proxy_pass {proto}://$fixed_upstream{uri};\n'
        if not test:
            conf += f'''      proxy_ssl_server_name on;
      proxy_ssl_name {host};
      proxy_ssl_verify on;
      proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;
      proxy_ssl_verify_depth 5;
'''
        if not private:
            conf += '''      if ($request_method !~ "^(GET|HEAD|OPTIONS)$") { return 405; }
      proxy_set_header Authorization "";
      proxy_set_header Cookie "";
      proxy_hide_header Set-Cookie;
'''
        else:
            conf += '''      # The RU Origin was checked at the gateway before canonical mapping.
      proxy_set_header Origin $canonical_app_origin;
      proxy_cookie_domain api.voltextech.net ru.voltextech.net;
      proxy_redirect https://api.voltextech.net/ https://ru.voltextech.net/;
'''
        if ws:
            conf += '''      if ($request_method != GET) { return 405; }
      if ($http_origin != "https://ru.voltextech.net") { return 403; }
      if ($http_upgrade != "websocket") { return 426; }
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection upgrade;
      proxy_read_timeout 3600s;
      proxy_buffering off;
      limit_conn gateway_connections 12;
'''
        else:
            conf += '''      proxy_buffering off;
      proxy_read_timeout 90s;
'''
        if html:
            conf += '''      proxy_set_header Accept-Encoding "";
      proxy_redirect https://voltextech.net/ https://ru.voltextech.net/;
      sub_filter_once off;
      sub_filter_types text/css application/javascript text/javascript;
'''
            for old, new in REWRITES.items():
                conf += f"      sub_filter '{old}' '{new}';\n"
        return conf

    def location(match, host, uri, **options):
        return f'    location {match} {{\n' + proxy(host, uri, **options) + '    }\n'

    config = f'''# Generated by ops/beget-rf/render.py. Dedicated Beget node only.
{setup}
worker_processes 1;
pid {prefix + '/nginx.pid' if test else '/run/nginx.pid'};
error_log {prefix}/error.log crit;
events {{ worker_connections 1024; }}
http {{
  default_type application/octet-stream;
  resolver {resolver} ipv6=off valid=300s;
  # No query strings, IPs, tokens, cookies, request bodies or financial values.
  log_format gateway '$request_method $status $request_time $upstream_status $upstream_response_time';
  access_log {prefix}/access.log gateway;
  limit_conn_zone $binary_remote_addr zone=gateway_connections:1m;
  map $http_origin $foreign_origin {{ default 1; "" 0; "https://{HOST}" 0; }}
  map $http_origin $canonical_app_origin {{ default ""; "https://{HOST}" "https://voltextech.net"; }}
  map "$request_method:$http_origin" $unsafe_origin {{
    default 1;
    ~^(GET|HEAD): 0;
    ~^(POST|PUT|PATCH|DELETE|OPTIONS):https://ru\\.voltextech\\.net$ 0;
  }}
  server_tokens off;
  client_max_body_size 5m;
  client_body_temp_path {prefix}/client;
  proxy_temp_path {prefix}/proxy;
'''
    if not test:
        config += f'''  server {{ listen 80 default_server; server_name _; return 444; }}
  server {{
    listen 80;
    server_name {HOST};
    location ^~ /.well-known/acme-challenge/ {{ root /var/www/voltex-acme; }}
    location / {{ return {'503' if bootstrap else '308 https://' + HOST + '$request_uri'}; }}
  }}
'''
    if not bootstrap:
        config += f'''  server {{
    listen {bind} ssl http2;
    server_name {HOST};
    ssl_certificate {cert};
    ssl_certificate_key {key};
    ssl_protocols TLSv1.2 TLSv1.3;
    if ($host != "{HOST}") {{ return 444; }}
    if ($foreign_origin) {{ return 403; }}
    if ($unsafe_origin) {{ return 403; }}
    if ($request_method !~ "^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$") {{ return 405; }}
    location = /_voltex/health {{ default_type text/plain; add_header Cache-Control no-store always; return 200 "voltex-rf-gateway\\n"; }}
'''
        config += location('^~ /api/v1/', 'api.voltextech.net', '$request_uri', private=True)
        config += location('= /health', 'api.voltextech.net', '/health$is_args$args')
        config += location('~ ^/_voltex/market(?<market_path>/(?:market/(?:display|listings|test-assets)(?:/[^?]*)?|cfd/display/[^?]*|health))$',
                           'market.voltextech.net', '$market_path$is_args$args')
        config += location('= /_voltex/catalogue/public/deposit-catalogue',
                           'voltex-deposit-catalogue-production.nazardzuba79.workers.dev', '/public/deposit-catalogue$is_args$args')
        config += location('~ ^/_voltex/kraken/0/public/(?<kraken_path>Depth|OHLC|Trades|Ticker|AssetPairs|Time)$',
                           'api.kraken.com', '/0/public/$kraken_path$is_args$args')
        for provider, host in [('bybit', 'api.bybit.com'), ('bytick', 'api.bytick.com')]:
            config += location('~ ^/_voltex/' + provider + '/v5/market/(?<' + provider + '_path>tickers|kline|orderbook|recent-trade)$',
                               host, '/v5/market/$' + provider + '_path$is_args$args')
        config += location('= /_voltex/ws/kraken', 'ws.kraken.com', '/v2', ws=True)
        config += location('= /_voltex/ws/bybit', 'stream.bybit.com', '/v5/public/linear', ws=True)
        # KYC path stays fixed; it may contain account-owned document bytes.
        config += location('~ ^/_voltex/kyc(?<kyc_path>/v1/(?:submit|confirm|materials))$',
                           'kyc.voltextech.net', '$kyc_path$is_args$args', private=True)
        config += '''    location /_voltex/ { return 404; }
    location /internal/ { return 404; }
    location / {
      if ($request_method !~ "^(GET|HEAD)$") { return 405; }
'''
        config += proxy('voltextech.net', '$request_uri', html=True) + '    }\n  }\n'
    return config + '}\n'


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--prefix', default='/etc/nginx/voltex-rf')
    p.add_argument('--resolver', default='127.0.0.53')
    p.add_argument('--bootstrap', action='store_true', help='Deprecated: also emits the security hold')
    args = p.parse_args()
    print(render(**vars(args)), end='')
