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


def _safe_path(raw):
    if not isinstance(raw, str) or not raw.startswith('/'):
        raise ValueError('An absolute local path is required')
    path = str(Path(raw).resolve())
    if any(c in path for c in '\n\r;{}"\' $'):
        raise ValueError('Unsafe local path')
    return path


def render(trusted_ip, prefix, listen_port=443, target_port=443, fixture=False,
           stream_module=None):
    address = ipaddress.ip_address(trusted_ip)
    if address.version != 4 or (not fixture and (not address.is_global or trusted_ip == '185.23.35.226')):
        raise ValueError('A separately reviewed trusted external IPv4 is required')
    if fixture and trusted_ip != '127.0.0.1':
        raise ValueError('Fixtures must stay on loopback')
    if not all(isinstance(p, int) and 0 < p < 65536 for p in (listen_port, target_port)):
        raise ValueError('Invalid port')
    path = _safe_path(prefix)
    module = ''
    if stream_module is not None:
        module_path = _safe_path(stream_module)
        if not module_path.endswith('/ngx_stream_module.so'):
            raise ValueError('Only the Nginx stream module may be explicitly loaded')
        module = f'load_module {module_path};\n'
    listen = ('127.0.0.1:' if fixture else '') + str(listen_port)
    process = 'master_process off;\n' if fixture else ''
    level = 'info' if fixture else 'crit'
    return f'''# OFFLINE ONLY: opaque TLS relay. No certificate, HTTP parser or local JS.
{module}{process}worker_processes 1;
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
    # Avoid idle WebSocket/SSE sessions being cut off after 60 seconds.
    proxy_timeout 3600s;
    proxy_next_upstream off;
    proxy_pass $fixed_target;
  }}
}}
'''


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--trusted-ip', required=True)
    p.add_argument('--prefix', default='/etc/nginx/voltex-rf-stream')
    p.add_argument('--stream-module', default=None,
                   help='If Nginx has --with-stream=dynamic: absolute ngx_stream_module.so path')
    args = p.parse_args()
    print(render(args.trusted_ip, args.prefix, stream_module=args.stream_module), end='')
