"""Storage layer: exact user schema (series/collection_log), append-only raw bytes,
manifest with the 8 contractual columns, separate checksum file and fetch ledger sidecar.

Never fabricates observations. Never forward-fills. Drops the current UTC day
(a partially formed daily bar) for every daily series.
"""
from __future__ import annotations
import csv, datetime as dt, gzip, hashlib, json, math, sqlite3, time
import urllib.error, urllib.parse, urllib.request
from pathlib import Path
from typing import Any

UTC = dt.timezone.utc
ROOT = Path(__file__).resolve().parents[1]

ALLOW = {
    'api.alternative.me', 'community-api.coinmetrics.io', 'api.binance.com', 'fapi.binance.com',
    'fred.stlouisfed.org', 'api.llama.fi', 'stablecoins.llama.fi', 'www.okx.com', 'api.bybit.com',
    'api.coingecko.com', 'api.blockchain.info', 'mempool.space', 'farside.co.uk',
}


def utc_now() -> str:
    return dt.datetime.now(UTC).isoformat()


def add_lag(day: str, days: int) -> str:
    return (dt.date.fromisoformat(day) + dt.timedelta(days=days)).isoformat()


def epoch_day(timestamp: int | float, unit: str = 'ms') -> str:
    scale = {'s': 1, 'ms': 1000}[unit]
    return dt.datetime.fromtimestamp(float(timestamp) / scale, UTC).date().isoformat()


def number(x: Any) -> float | None:
    if x is None or x in ('', '.', 'null', 'None'):
        return None
    out = float(x)
    if not math.isfinite(out):
        raise ValueError('Non-finite numeric value')
    return out


class Store:
    def __init__(self, root: Path = ROOT, today: str | None = None) -> None:
        self.root = root
        (root / 'data').mkdir(parents=True, exist_ok=True)
        (root / 'raw').mkdir(exist_ok=True)
        (root / 'reports').mkdir(exist_ok=True)
        self.db = sqlite3.connect(root / 'data/csi.db', timeout=120)
        self.db.executescript((Path(__file__).parent / 'schema.sql').read_text())
        self.side = sqlite3.connect(root / 'data/sidecar.db', timeout=120)
        self.side.executescript(
            'CREATE TABLE IF NOT EXISTS fetch_ledger(source TEXT, metric TEXT, asset TEXT, url TEXT, file TEXT,'
            ' http_status INTEGER, fetched_at_utc TEXT, bytes INTEGER, sha256 TEXT, max_date_in_response TEXT, note TEXT);'
        )
        self.day = today or dt.datetime.now(UTC).date().isoformat()
        self.page = 0
        self.failures = 0
        self.run = dt.datetime.now(UTC).strftime('%Y%m%dT%H%M%S%fZ')
        self.last_response: dict[str, Any] = {}

    # ---- logging -------------------------------------------------------
    def log(self, source: str, metric: str, asset: str, status: str, message: str) -> None:
        n, first, last = self.db.execute(
            'SELECT COUNT(*),MIN(date),MAX(date) FROM series WHERE source=? AND metric=? AND asset=?',
            (source, metric, asset)).fetchone()
        self.db.execute(
            'INSERT INTO collection_log(source,metric,asset,rows,first_date,last_date,status,message) VALUES(?,?,?,?,?,?,?,?)',
            (source, metric, asset, n, first, last, status, message[:2000]))
        self.db.commit()
        if status == 'FAIL':
            self.failures += 1
        print(f'[{status}] {source} {metric} {asset}: rows={n} {first}..{last} | {message[:160]}')

    # ---- writing -------------------------------------------------------
    def put(self, source: str, metric: str, asset: str, day: str, value: Any, lag: int) -> bool:
        dt.date.fromisoformat(day)
        if day >= self.day:  # current/future period: not a closed daily bar
            return False
        v = number(value)
        if v is None:  # a missing value stays missing; never written as 0
            return False
        self.db.execute(
            'INSERT INTO series(source,metric,asset,date,available_at,value) VALUES(?,?,?,?,?,?) '
            'ON CONFLICT(source,metric,asset,date) DO UPDATE SET available_at=excluded.available_at,'
            "value=excluded.value,ingested_at=datetime('now')",
            (source, metric, asset, day, add_lag(day, lag), v))
        self._pending = getattr(self, '_pending', 0) + 1
        if self._pending >= 2000:
            self.db.commit(); self._pending = 0
        return True

    # ---- fetching ------------------------------------------------------
    def request(self, source: str, metric: str, asset: str, url: str, ext: str = 'json',
                timeout: int = 60, note: str = '') -> Any:
        p = urllib.parse.urlparse(url)
        if p.scheme != 'https' or p.hostname not in ALLOW:
            raise ValueError('Unapproved public endpoint: ' + url)

        class Redirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                q = urllib.parse.urlparse(newurl)
                if q.scheme != 'https' or q.hostname not in ALLOW:
                    raise ValueError('Unapproved redirect ' + newurl)
                return super().redirect_request(req, fp, code, msg, headers, newurl)

        opener = urllib.request.build_opener(Redirect())
        body = None; status = 0; error = ''; fetched = utc_now()
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'CSI-research-collector/1.0',
                                                       'Accept': 'application/json,text/csv,text/html,*/*'})
            with opener.open(req, timeout=timeout) as response:
                status = response.status; body = response.read()
        except urllib.error.HTTPError as exc:
            status = exc.code; body = exc.read(); error = str(exc)
        except Exception as exc:
            error = f'{type(exc).__name__}: {exc}'
        self.page += 1
        path = ''; sha = ''; nbytes = 0
        if body is not None:
            folder = self.root / 'raw' / source; folder.mkdir(exist_ok=True)
            safe = lambda s: ''.join(c if c.isalnum() or c in '_-.' else '_' for c in s) or 'na'
            file = folder / f'{safe(metric)}__{safe(asset)}__{self.run}__{self.page:06d}.{ext}.gz'
            with gzip.open(file, 'wb') as f:
                f.write(body)
            path = file.relative_to(self.root).as_posix()
            sha = hashlib.sha256(body).hexdigest(); nbytes = len(body)
            with (self.root / 'raw/CHECKSUMS.csv').open('a', newline='', encoding='utf-8') as f:
                w = csv.writer(f)
                if f.tell() == 0:
                    w.writerow(['file', 'bytes_raw', 'sha256_raw'])
                w.writerow([path, nbytes, sha])
        manifest = self.root / 'raw/MANIFEST.csv'
        fields = ['source', 'metric', 'asset', 'url', 'file', 'http_status', 'fetched_at_utc', 'notes']
        exists = manifest.exists()
        with manifest.open('a', newline='', encoding='utf-8') as f:
            w = csv.DictWriter(f, fieldnames=fields)
            if not exists:
                w.writeheader()
            w.writerow(dict(zip(fields, [source, metric, asset, url, path, status, fetched, (error or note)[:500]])))
        self.side.execute('INSERT INTO fetch_ledger VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                          (source, metric, asset, url, path, status, fetched, nbytes, sha, None, (error or note)[:500]))
        self.side.commit()
        self.last_response = dict(status=status, error=error, bytes=nbytes, file=path,
                                  preview=(body or b'')[:300].decode('utf-8', 'replace'))
        if status != 200:
            raise RuntimeError(f'HTTP {status}; {error}; body[:300]={self.last_response["preview"]!r}')
        if ext == 'json':
            return json.loads(body)
        if ext in ('bin', 'zip'):
            return body
        return body.decode('utf-8-sig')

    def request_bytes(self, source: str, metric: str, asset: str, url: str, ext: str = 'zip', timeout: int = 60) -> bytes:
        """Same as request() but returns raw bytes (for zip archives)."""
        return self.request(source, metric, asset, url, ext=ext, timeout=timeout)

    def finish(self) -> None:
        self.db.commit()
        with gzip.open(self.root / 'data/series.csv.gz', 'wt', encoding='utf-8', newline='') as f:
            writer = csv.writer(f)
            cursor = self.db.execute('SELECT * FROM series ORDER BY source,metric,asset,date')
            writer.writerow([d[0] for d in cursor.description]); writer.writerows(cursor)
        self.db.close(); self.side.close()
