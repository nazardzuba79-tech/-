#!/usr/bin/env python3
"""Print an exact RU-only diff. READ ONLY: never writes config or reloads Nginx."""
import argparse
import difflib
import hashlib
from pathlib import Path
from endpoint import route_pattern

BASE_SHA256 = '12ff7c12a2039d6086affed9ab65adf71c69339936494f309d2dfaa2b02161f6'
READS = ('/banking/config', '/banking/state', '/banking/referral',
         '/copy-trading/nazar', '/copy-trading/ksenia')
LINES = ''.join('  ~^(GET|HEAD):/api/v1' + route_pattern(path) + '$ 1;\n' for path in READS)
MARKER = 'map "$request_method:$uri" $voltex_ru_api_allowed {\n  default 0;\n'

def propose(text):
    old = text
    if LINES in text:
        if text.count(LINES) != 1: raise ValueError('Duplicate proposed rules')
        old = text.replace(LINES, '', 1)
    if hashlib.sha256(old.encode()).hexdigest() != BASE_SHA256:
        raise ValueError('Live RU config drift: inspect; never overwrite')
    if old.count(MARKER) != 1: raise ValueError('Ambiguous API map')
    return old.replace(MARKER, MARKER + LINES, 1)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, help='Read the exact current RU vhost, never a primary vhost')
    args = parser.parse_args()
    old = Path(args.input).read_text(); new = propose(old)
    print('OLD_SHA256=' + hashlib.sha256(old.encode()).hexdigest())
    print('PROPOSED_SHA256=' + hashlib.sha256(new.encode()).hexdigest())
    print(''.join(difflib.unified_diff(old.splitlines(True), new.splitlines(True), fromfile='current-ru.conf', tofile='proposed-ru.conf')), end='')
    print('REVIEW_ONLY: no production write, reload, API/DB or financial command')

if __name__ == '__main__': main()
