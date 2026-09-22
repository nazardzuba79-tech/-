#!/usr/bin/env python3
"""Research-only data collector scaffold; live network execution not verified.

Uses only Python standard library. Never fabricates missing observations.
Reads public GET endpoints, saves response bytes before parsing, and writes the
exact user schema. No trading or account APIs. Run individual sources first.
"""
from __future__ import annotations
import argparse, csv, datetime as dt, gzip, io, json, math, sqlite3, sys, time
import urllib.error, urllib.parse, urllib.request
from pathlib import Path
from typing import Any
ROOT = Path(__file__).resolve().parents[1]
UTC = dt.timezone.utc
CM_METRICS = 'PriceUSD CapMrktCurUSD CapRealUSD CapMVRVCur SplyCur SplyAct1yr SplyActEver AdrActCnt TxCnt TxTfrValAdjUSD FeeTotUSD RevUSD IssTotUSD HashRate DiffMean NVTAdj90 VtyDayRet30d'.split()
FRED_METRICS = 'WALCL WTREGEN RRPONTSYD WRESBAL M2SL DTWEXBGS DFII10 BAMLH0A0HYM2 VIXCLS SP500'.split()
ALLOW = {'api.alternative.me','community-api.coinmetrics.io','api.binance.com','fapi.binance.com','fred.stlouisfed.org'}

def utc_now() -> str:
    return dt.datetime.now(UTC).isoformat()

def add_lag(day: str, days: int) -> str:
    return (dt.date.fromisoformat(day) + dt.timedelta(days=days)).isoformat()

def epoch_day(timestamp: int | float, unit: str = 'ms') -> str:
    scale = {'s':1, 'ms':1000, 'us':1_000_000}[unit]
    return dt.datetime.fromtimestamp(float(timestamp)/scale, UTC).date().isoformat()

def number(x: Any) -> float | None:
    if x is None or x in ('', '.', 'null'): return None
    out = float(x)
    if not math.isfinite(out): raise ValueError('Non-finite numeric value')
    return out

class Store:
    def __init__(self, root: Path = ROOT) -> None:
        self.root=root
        (root/'data').mkdir(parents=True,exist_ok=True)
        (root/'raw').mkdir(exist_ok=True)
        self.db=sqlite3.connect(root/'data/csi.db')
        self.db.executescript((root/'collectors/schema.sql').read_text())
        self.day=dt.datetime.now(UTC).date().isoformat()
        self.start_today=int(dt.datetime.combine(dt.date.fromisoformat(self.day),dt.time(),UTC).timestamp()*1000)
        self.page=0
        self.failures=0
        self.run=dt.datetime.now(UTC).strftime('%Y%m%dT%H%M%S%fZ')
    def log(self,source:str,metric:str,asset:str,status:str,message:str) -> None:
        n,first,last=self.db.execute('SELECT COUNT(*),MIN(date),MAX(date) FROM series WHERE source=? AND metric=? AND asset=?',(source,metric,asset)).fetchone()
        self.db.execute('INSERT INTO collection_log(source,metric,asset,rows,first_date,last_date,status,message) VALUES(?,?,?,?,?,?,?,?)',(source,metric,asset,n,first,last,status,message))
        self.db.commit()
        if status == 'FAIL': self.failures += 1
    def put(self,source:str,metric:str,asset:str,day:str,value:Any,lag:int) -> None:
        dt.date.fromisoformat(day)
        # Drop current and future periods: no partially formed daily bars.
        if day >= self.day:return
        self.db.execute('INSERT INTO series(source,metric,asset,date,available_at,value) VALUES(?,?,?,?,?,?) ON CONFLICT(source,metric,asset,date) DO UPDATE SET available_at=excluded.available_at,value=excluded.value,ingested_at=datetime(\'now\')',(source,metric,asset,day,add_lag(day,lag),number(value)))
    def request(self,source:str,metric:str,asset:str,url:str,ext:str='json') -> Any:
        # Explicit host allowlist also applies to pagination/redirects.
        p=urllib.parse.urlparse(url)
        if p.scheme!='https' or p.hostname not in ALLOW:raise ValueError('Unapproved public endpoint: '+url)
        class Redirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                q=urllib.parse.urlparse(newurl)
                if q.scheme!='https' or q.hostname not in ALLOW:raise ValueError('Unapproved redirect '+newurl)
                return super().redirect_request(req,fp,code,msg,headers,newurl)
        opener=urllib.request.build_opener(Redirect())
        body=None;status=0;error='';fetched=utc_now()
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'CSI-research-collector/1.0','Accept':'application/json,text/csv,*/*'})
            with opener.open(req,timeout=30) as response:
                status=response.status;body=response.read()
        except urllib.error.HTTPError as exc:
            status=exc.code;body=exc.read();error=str(exc)
        except Exception as exc:
            error=f'{type(exc).__name__}: {exc}'
        self.page+=1
        path=''
        if body is not None:
            folder=self.root/'raw'/source;folder.mkdir(exist_ok=True)
            safe=lambda s: ''.join(c if c.isalnum() or c in '_-.' else '_' for c in s)
            file=folder/f'{safe(metric)}__{safe(asset)}__{self.run}__{self.page:06d}.{ext}'
            file.write_bytes(body);path=file.relative_to(self.root).as_posix()
        manifest=self.root/'raw/MANIFEST.csv'
        fields=['source','metric','asset','url','file','http_status','fetched_at_utc','notes']
        exists=manifest.exists()
        with manifest.open('a',newline='',encoding='utf-8') as f:
            w=csv.DictWriter(f,fieldnames=fields)
            if not exists:w.writeheader()
            w.writerow(dict(zip(fields,[source,metric,asset,url,path,status,fetched,error])))
        if status!=200:
            self.log(source,metric,asset,'FAIL',f'HTTP {status}; {error}')
            raise RuntimeError(f'HTTP {status}; {error}')
        if source=='coinmetrics':time.sleep(0.7) # bounded request rate, no retries on 403
        if ext=='json':return json.loads(body)
        return body.decode('utf-8-sig')
    def finish(self) -> None:
        self.db.commit()
        with gzip.open(self.root/'data/series.csv.gz','wt',encoding='utf-8',newline='') as f:
            writer=csv.writer(f);cursor=self.db.execute('SELECT * FROM series ORDER BY source,metric,asset,date')
            writer.writerow([d[0] for d in cursor.description]);writer.writerows(cursor)
        self.db.close()

def collect_fng(s:Store) -> None:
    obj=s.request('alternative_me','fng','','https://api.alternative.me/fng/?limit=0&format=json')
    if obj.get('metadata',{}).get('error'):raise ValueError(str(obj['metadata']['error']))
    data=obj.get('data')
    if not isinstance(data,list) or not data:raise ValueError('Missing nonempty fng data list')
    for row in data:s.put('alternative_me','fng','',epoch_day(int(row['timestamp']),'s'),row['value'],0)
    s.log('alternative_me','fng','','OK','All returned API observations saved; provider completeness not independently proven')

def collect_fred(s:Store) -> None:
    for metric in FRED_METRICS:
        try:
            text=s.request('fred',metric,'','https://fred.stlouisfed.org/graph/fredgraph.csv?id='+metric,'csv')
            reader=csv.DictReader(io.StringIO(text));headers=reader.fieldnames or []
            day_key='DATE' if 'DATE' in headers else 'observation_date'
            if metric not in headers or day_key not in headers:raise ValueError(f'Unexpected CSV columns {headers}')
            lag=8 if metric in ('WALCL','WTREGEN','WRESBAL') else 30 if metric=='M2SL' else 1
            for row in reader:s.put('fred',metric,'',row[day_key],row[metric],lag)
            s.log('fred',metric,'','PARTIAL','Latest-revised CSV; exact user lag preserved; original vintages NOT established')
        except Exception as exc:s.log('fred',metric,'','FAIL',repr(exc))

def collect_spot(s:Store) -> None:
    start=int(dt.datetime(2017,8,17,tzinfo=UTC).timestamp()*1000)
    for symbol in ('BTCUSDT','ETHUSDT'):
        cursor=start;seen=set()
        try:
            for _ in range(100): # daily 1000-row pages; explicit safety ceiling
                url='https://api.binance.com/api/v3/klines?'+urllib.parse.urlencode({'symbol':symbol,'interval':'1d','limit':1000,'startTime':cursor,'endTime':s.start_today-1})
                data=s.request('binance_spot','spot_ohlcv',symbol.lower(),url)
                if not isinstance(data,list):raise ValueError('Klines response is not a list')
                if not data:break
                for row in data:
                    if len(row)<12:raise ValueError('Incomplete kline record')
                    t=int(row[0]);ct=int(row[6])
                    if t in seen:raise ValueError('Duplicate kline timestamp')
                    seen.add(t)
                    if ct >= s.start_today:continue
                    o,h,l,c=map(float,row[1:5])
                    if min(o,h,l,c)<=0 or h<max(o,c,l) or l>min(o,c,h):raise ValueError('Invalid OHLC geometry')
                    d=epoch_day(t)
                    s.put('binance_spot','spot_close',symbol.lower(),d,c,0)
                    s.put('binance_spot','spot_volume',symbol.lower(),d,row[5],0)
                nxt=int(data[-1][0])+1
                if nxt<=cursor:raise ValueError('Pagination stalled')
                cursor=nxt
                if len(data)<1000:break
            else:raise ValueError('Page safety ceiling reached; history not complete')
            for metric in ('spot_close','spot_volume'):s.log('binance_spot',metric,symbol.lower(),'OK','Closed daily bars; raw OHLCV retained. Cross-venue integrity not verified')
        except Exception as exc:
            for metric in ('spot_close','spot_volume'):s.log('binance_spot',metric,symbol.lower(),'FAIL',repr(exc))

def collect_funding(s:Store) -> None:
    for symbol in ('BTCUSDT','ETHUSDT'):
        cursor=int(dt.datetime(2019,1,1,tzinfo=UTC).timestamp()*1000);events={}
        try:
            for _ in range(100):
                url='https://fapi.binance.com/fapi/v1/fundingRate?'+urllib.parse.urlencode({'symbol':symbol,'startTime':cursor,'endTime':s.start_today-1,'limit':1000})
                data=s.request('binance_futures','funding_events',symbol.lower(),url)
                if not isinstance(data,list):raise ValueError('Funding response not a list')
                if not data:break
                for row in data:
                    t=int(row['fundingTime'])
                    if row.get('symbol')!=symbol:raise ValueError('Wrong symbol in response')
                    if t in events:raise ValueError('Duplicate funding event timestamp')
                    events[t]=float(row['fundingRate'])
                nxt=max(int(row['fundingTime']) for row in data)+1
                if nxt<=cursor:raise ValueError('Funding pagination stalled')
                cursor=nxt
                if len(data)<1000:break
            else:raise ValueError('Page safety ceiling reached')
            days={}
            for t,val in sorted(events.items()):days.setdefault(epoch_day(t),[]).append(val)
            report=s.root/'reports'/f'funding_event_counts_{symbol.lower()}.csv'
            with report.open('w',encoding='utf-8',newline='') as f:
                w=csv.writer(f);w.writerow(['date','event_count','sum_rates','completeness'])
                for day,values in sorted(days.items()):
                    if day>=s.day:continue
                    s.put('binance_futures','funding_rate_daily',symbol.lower(),day,math.fsum(values),0)
                    w.writerow([day,len(values),math.fsum(values),'NOT_PROVEN_FROM_EVENT_COUNT_ALONE'])
            s.log('binance_futures','funding_rate_daily',symbol.lower(),'PARTIAL','Actual events summed, never assumed 3/day; interval-history completeness still needs audit')
        except Exception as exc:s.log('binance_futures','funding_rate_daily',symbol.lower(),'FAIL',repr(exc))

def metric_names(value:Any) -> set[str]:
    # Fail closed when unknown catalog shape: no guessed entitlement.
    found=set()
    if isinstance(value,dict):
        if isinstance(value.get('metric'),str):found.add(value['metric'])
        if isinstance(value.get('metrics'),list):found.update(x for x in value['metrics'] if isinstance(x,str))
        for v in value.values():found.update(metric_names(v))
    elif isinstance(value,list):
        for v in value:found.update(metric_names(v))
    return found

def collect_coinmetrics(s:Store) -> None:
    for asset in ('btc','eth'):
        try:
            catalog=s.request('coinmetrics','catalog',asset,'https://community-api.coinmetrics.io/v4/catalog-v2/asset-metrics?assets='+asset)
            offered=metric_names(catalog)
            if not offered:raise ValueError('Catalog schema not recognized. Inspect saved raw catalog; do not guess metrics')
        except Exception as exc:
            for metric in CM_METRICS:s.log('coinmetrics',metric,asset,'FAIL','Catalog gate: '+repr(exc))
            continue
        for metric in CM_METRICS:
            if metric not in offered:
                s.log('coinmetrics',metric,asset,'UNAVAILABLE','Not in successfully parsed Community catalog');continue
            url='https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?'+urllib.parse.urlencode({'assets':asset,'metrics':metric,'frequency':'1d','start_time':'2010-01-01','end_time':s.day,'page_size':10000})
            visited=set()
            try:
                for _ in range(100):
                    if url in visited:raise ValueError('Repeated next_page URL')
                    visited.add(url);obj=s.request('coinmetrics',metric,asset,url)
                    if not isinstance(obj,dict) or not isinstance(obj.get('data'),list):raise ValueError('Unknown CM timeseries schema')
                    for row in obj['data']:
                        if row.get('asset')!=asset:raise ValueError('Wrong asset in CM series')
                        if metric not in row:raise ValueError('Requested metric missing from CM observation')
                        s.put('coinmetrics',metric,asset,row['time'][:10],row[metric],1)
                    nxt=obj.get('next_page_url')
                    if not nxt and obj.get('next_page_token'):
                        q=urllib.parse.urlparse(url);params=urllib.parse.parse_qs(q.query)
                        params['next_page_token']=[obj['next_page_token']]
                        nxt=urllib.parse.urlunparse(q._replace(query=urllib.parse.urlencode(params,doseq=True)))
                    if not nxt:break
                    url=nxt
                else:raise ValueError('CM page ceiling reached')
                s.log('coinmetrics',metric,asset,'PARTIAL','Requested pages completed; revised history, asset applicability and coverage must be audited')
            except Exception as exc:s.log('coinmetrics',metric,asset,'FAIL',repr(exc))

def main() -> int:
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',required=True,choices=['alternative_me','fred','binance_spot','binance_funding','coinmetrics'])
    args=p.parse_args();s=Store()
    try:
        {'alternative_me':collect_fng,'fred':collect_fred,'binance_spot':collect_spot,'binance_funding':collect_funding,'coinmetrics':collect_coinmetrics}[args.source](s)
        if s.failures: return 1
    except Exception as exc:
        print(f'COLLECTION FAILED: {type(exc).__name__}: {exc}',file=sys.stderr);return 1
    finally:s.finish()
    return 0
if __name__=='__main__':raise SystemExit(main())
