#!/usr/bin/env python3
"""Read-only Beget-local probe; no restart, remote writes, auth or notifications."""
import json
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone


def main():
    prefix = Path('/etc/nginx/voltex-rf')
    probe = subprocess.run(['curl', '--silent', '--show-error', '--fail', '--max-time', '10',
        '--noproxy', '*', '--resolve', 'ru.voltextech.net:443:127.0.0.1',
        'https://ru.voltextech.net/_voltex/health'], capture_output=True, text=True)
    memory = {}
    for line in Path('/proc/meminfo').read_text().splitlines():
        if line.startswith(('MemTotal:', 'MemAvailable:')):
            name, value, _ = line.split()
            memory[name.rstrip(':')] = int(value) * 1024
    counts = {'requests': 0, '5xx': 0}
    log = prefix / 'access.log'
    if log.exists():
        for line in log.open():
            fields = line.split()
            if len(fields) >= 2 and fields[1].isdigit():
                counts['requests'] += 1
                counts['5xx'] += int(500 <= int(fields[1]) < 600)
    healthy = probe.returncode == 0 and probe.stdout.strip() == 'voltex-rf-gateway'
    report = {'at': datetime.now(timezone.utc).isoformat(), 'gatewayTlsHealthy': healthy,
              'memoryBytes': memory, 'accessLogCurrentRotation': counts}
    print(json.dumps(report, sort_keys=True))
    return 0 if healthy else 1


if __name__ == '__main__':
    sys.exit(main())
