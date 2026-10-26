#!/usr/bin/env python3
"""OFFLINE proposal, never applies configs. Trusted terminator is not provisioned.

The Beget stream layer cannot enforce HTTP path policy. An independently trusted
terminator must reject admin/KYC/financial routes before this may be considered.
Existing Beget-held RU certificate and CA issuance control must be remediated too.
"""
import argparse
import ipaddress
from pathlib import Path

HOST = 'ru.voltextech.net'


def render(trusted_ip, prefix, listen_port=443, target_port=443, fixture=False):
    address = ipaddress.ip_address(trusted_ip)
    if address.version != 4 or (not fixture and (not address.is_global or trusted_ip == '185.23.35.226')):
        raise ValueError('A separately reviewed trusted external IPv4 is required')
    if fixture and trusted_ip != '127.0.0.1':
        raise ValueError('Fixtures must stay on loopback')
    if not all(isinstance(p, int) and 0 < p < 65536 for p in (listen_port, target_port)):
        raise ValueError('Invalid port')
    path = str(Path(prefix).resolve())
    if any(c in path for c in '\n\r;{}"\' $'):
        raise ValueError('Unsafe prefix')
    listen = ('127.0.0.1:' if fixture else '') + str(listen_port)
    process = 'master_process off;\n' if fixture else ''
    level = 'info' if fixture else 'crit'
    return f'''# OFFLINE ONLY: opaque TLS relay. No certificate, HTTP parser or local JS.
{process}worker_processes 1;
pid {path}/nginx.pid;
error_log {path}/error.log {level};
events {{ worker_connections 512; }}
stream {{
  access_log off;
  map $ssl_preread_server_name $fixed_target {{
    default "";
    {HOST} {address}:{target_port};
  }}
  server {{
    listen {listen};
    ssl_preread on;
    preread_timeout 5s;
    proxy_connect_timeout 5s;
    proxy_timeout 60s;
    proxy_next_upstream off;
    proxy_pass $fixed_target;
  }}
}}
'''


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--trusted-ip', required=True)
    p.add_argument('--prefix', default='/etc/nginx/voltex-rf-stream')
    args = p.parse_args()
    print(render(args.trusted_ip, args.prefix), end='')
