#!/usr/bin/env python3
"""Finite public-data research. No exchange, server, secret or database writes."""
import csv, datetime as dt, hashlib, io, json, math, os, re, sys, time, urllib.request, zipfile
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
SPECS = [
 ('01','btc','2015-08-17','2017-12-25','11872.45','cm'),
 ('02','eth','2016-12-01','2018-01-15','10936','cm'),
 ('03','sol','2020-11-01','2021-11-07','9348','binance'),
 ('04','bnb','2020-03-13','2021-05-11','12816','binance'),
 ('05','ada','2020-03-13','2021-09-03','8692','binance'),
 ('06','doge','2020-11-01','2021-05-09','14972','binance'),
 ('07','link','2019-04-01','2021-05-11','10084','binance'),
 ('08','avax','2021-01-01','2021-11-22','11428','binance'),
 ('09','matic','2021-01-01','2021-12-28','15324','binance'),
 ('10','dot','2020-08-25','2021-11-05','7848','binance'),
 ('11','ltc','2017-01-01','2017-12-20','9164','cm'),
 ('12','xrp','2017-01-01','2018-01-07','13896','cm'),
 ('13','xlm','2017-01-01','2018-01-07','12468','cm'),
 ('14','etc','2017-03-01','2018-01-14','7248','cm'),
 ('15','xmr','2016-01-01','2018-01-10','10652','cm'),
 ('16','trx','2020-03-13','2021-04-18','9836','binance'),
 ('17','uni','2020-11-05','2021-05-04','11604','binance'),
 ('18','aave','2020-11-05','2021-05-19','13248','binance'),
 ('19','atom','2020-03-13','2021-09-21','8424','binance'),
 ('20','near','2020-11-01','2022-01-17','14416','binance'),
]
ROOT=Path(os.environ.get('RESEARCH_OUT','research-output'))
MAX_BYTES=20*1024*1024
ALLOWED={'raw.githubusercontent.com','api.github.com','data.binance.vision'}
def sha(data): return hashlib.sha256(data).hexdigest()
def iso(s): return dt.date.fromisoformat(s)
def jd(path,value):
 path.parent.mkdir(parents=True,exist_ok=True)
 path.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
def fetch(url):
 from urllib.parse import urlparse
 if urlparse(url).hostname not in ALLOWED: raise ValueError('UNAPPROVED_HOST')
 request=urllib.request.Request(url,headers={'User-Agent':'VOLTEX-historical-research/1.0','Accept':'*/*'})
 for attempt in range(2):
  try:
   with urllib.request.urlopen(request,timeout=25) as response:
    if urlparse(response.url).hostname not in ALLOWED: raise ValueError('REDIRECT_HOST')
    content=response.read(MAX_BYTES+1)
    if len(content)>MAX_BYTES: raise ValueError('RESPONSE_TOO_LARGE')
    return content
  except Exception:
   if attempt: raise
   time.sleep(1)
def months(start,end):
 date=iso(start).replace(day=1); finish=iso(end)
 while date<=finish:
  yield date.strftime('%Y-%m')
  date=(date.replace(day=28)+dt.timedelta(days=4)).replace(day=1)
def cm(asset,start,end,pin):
 url=f'https://raw.githubusercontent.com/coinmetrics/data/{pin}/csv/{asset}.csv'
 body=fetch(url); parsed=list(csv.DictReader(io.StringIO(body.decode('utf-8-sig'))))
 selected=[r for r in parsed if start<=r.get('time','')[:10]<=end]
 if not selected: raise ValueError('NO_CM_DATE_COVERAGE')
 metric=None
 for candidate in ('PriceUSD','ReferenceRateUSD'):
  if all(r.get(candidate) and math.isfinite(float(r[candidate])) and float(r[candidate])>0 for r in selected): metric=candidate;break
 if not metric: raise ValueError('NO_COMPLETE_PRICE_METRIC')
 rows=[{'date':r['time'][:10],'close':float(r[metric])} for r in selected]
 return rows,{'provider':'Coin Metrics','metric':metric,'data_kind':'daily_reference_price_NOT_OHLC','license':'CC-BY-NC-4.0','license_url':'https://github.com/coinmetrics/data/blob/'+pin+'/README.md','source_files':[{'url':url,'sha256':sha(body),'bytes':len(body)}],'pin':pin,'symbol':asset.upper()+'/USD'}
def bn(asset,start,end):
 symbol=asset.upper()+'USDT'; rows=[]; receipts=[]
 for month in months(start,end):
  filename=f'{symbol}-1d-{month}.zip'
  url=f'https://data.binance.vision/data/spot/monthly/klines/{symbol}/1d/{filename}'
  content=fetch(url);checksum=fetch(url+'.CHECKSUM').decode('utf-8').split()[0].lower()
  if not re.fullmatch('[0-9a-f]{64}',checksum) or sha(content)!=checksum: raise ValueError('ARCHIVE_CHECKSUM_MISMATCH')
  with zipfile.ZipFile(io.BytesIO(content)) as z:
   expected=f'{symbol}-1d-{month}.csv'
   if z.namelist()!=[expected] or z.getinfo(expected).file_size>MAX_BYTES: raise ValueError('UNEXPECTED_ZIP_MEMBER')
   data=z.read(expected)
  for r in csv.reader(io.StringIO(data.decode('utf-8-sig'))):
   if not r or not r[0].isdigit(): continue
   stamp=int(r[0]); divisor=1000000 if stamp>=100000000000000 else 1000
   date=dt.datetime.fromtimestamp(stamp/divisor,dt.timezone.utc).date().isoformat()
   if start<=date<=end:
    if (stamp/divisor)%86400!=0: raise ValueError('NOT_UTC_DAILY_BOUNDARY')
    rows.append(dict(date=date,open=float(r[1]),high=float(r[2]),low=float(r[3]),close=float(r[4]),volume=float(r[5])))
  receipts.append({'url':url,'checksum_url':url+'.CHECKSUM','sha256':sha(content),'csv_sha256':sha(data),'bytes':len(content),'checksum_verified':True})
 return rows,{'provider':'Binance Vision','metric':'spot daily OHLCV','data_kind':'exchange_ohlcv_1d','license':'CC-BY-NC-SA-4.0 plus Binance Vision Dataset Terms','license_url':'https://github.com/binance/binance-public-data/blob/master/TERMS_AND_CONDITIONS.md','source_files':receipts,'symbol':symbol}
def validate(rows,start,end):
 rows=sorted(rows,key=lambda r:r['date']);dates=[r['date'] for r in rows]
 expected=[(iso(start)+dt.timedelta(days=i)).isoformat() for i in range((iso(end)-iso(start)).days+1)]
 if dates!=expected: raise ValueError(f'DATE_GAP_OR_DUPLICATE expected={len(expected)} got={len(rows)} first={dates[:1]} last={dates[-1:]}')
 for r in rows:
  for k,v in r.items():
   if k not in ('date','volume') and (not math.isfinite(v) or v<=0): raise ValueError('NONPOSITIVE_PRICE')
  if 'open' in r:
   if r['high']<max(r['open'],r['close']) or r['low']>min(r['open'],r['close']) or r['low']>r['high']: raise ValueError('INVALID_OHLC')
   if not math.isfinite(r['volume']) or r['volume']<0: raise ValueError('INVALID_VOLUME')
 return rows
def mdd(values):
 peak=values[0];worst=0
 for value in values: peak=max(peak,value);worst=max(worst,1-value/peak)
 return 100*worst
def normalize(rows,target):
 anchor=rows[0].get('open',rows[0]['close'])
 highest=max(r.get('high',r['close']) for r in rows)
 if highest<=anchor: raise ValueError('WINDOW_HAS_NO_UPSIDE')
 peak_factor=1+float(target)/100; exponent=math.log(peak_factor)/math.log(highest/anchor)
 out=[]
 for row in rows:
  values={k:math.exp(exponent*math.log(v/anchor)) for k,v in row.items() if k not in ('date','volume')}
  if any(v>peak_factor*(1+1e-12) for v in values.values()): raise ValueError('TRANSFORM_EXCEEDS_PEAK')
  values={k:min(peak_factor,v) for k,v in values.items()}
  out.append({'source_date':row['date'],'offset_seconds':(iso(row['date'])-iso(rows[0]['date'])).days*86400,**values})
 actual=max(r.get('high',r['close']) for r in out)
 if not math.isclose(actual,peak_factor,rel_tol=1e-10,abs_tol=1e-10): raise ValueError('PEAK_MISMATCH')
 return out,exponent,anchor,highest
def process(spec,pin):
 number,asset,start,end,target,preferred=spec
 ident=f'VHX-{number}-{asset.upper()}'; errors=[]
 try:
  if preferred=='binance':
   try:
    rows,meta=bn(asset,start,end)
    rows=validate(rows,start,end)
   except Exception as exc:
    errors.append({'attempt':'Binance Vision','error':str(exc)[:300]})
    rows,meta=cm(asset,start,end,pin)
  else: rows,meta=cm(asset,start,end,pin)
  rows=validate(rows,start,end)
  transformed,alpha,anchor,highest=normalize(rows,target)
  raw_file=ROOT/'data'/'source'/f'{ident}.csv';raw_file.parent.mkdir(parents=True,exist_ok=True)
  with raw_file.open('w',newline='',encoding='utf-8') as f:
   writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
  raw_bytes=raw_file.read_bytes(); closes=[r['close'] for r in rows]
  peak_index=max(range(len(rows)),key=lambda i:rows[i].get('high',rows[i]['close']))
  growth_days=(iso(rows[peak_index]['date'])-iso(start)).days
  negatives=sum(closes[i]<closes[i-1] for i in range(1,len(closes)))
  metrics={'source_rows':len(rows),'elapsed_days_between_first_last':len(rows)-1,'candle_coverage_days':len(rows) if 'open' in rows[0] else None,'raw_start_price':anchor,'raw_peak_price':highest,'raw_peak_date':rows[peak_index]['date'],'raw_peak_growth_pct':100*(highest/anchor-1),'raw_end_growth_pct':100*(closes[-1]/anchor-1),'raw_max_close_drawdown_pct':mdd(closes),'negative_close_days':negatives,'negative_close_days_pct':100*negatives/(len(rows)-1),'amplitude_exponent':alpha,'model_max_close_drawdown_pct':mdd([r['close'] for r in transformed]),'model_end_growth_pct':100*(transformed[-1]['close']-1),'days_to_source_peak':growth_days}
  result={'schema':'voltex.historical-research.v1','id':ident,'asset':asset.upper(),'window_start':start,'window_end_inclusive':end,'target_peak_growth_pct':float(target),'target_peak_factor':1+float(target)/100,'status':'RESEARCH_DATA_VERIFIED_NOT_RELEASED','role':'historical_growth_window_candidate','normalization':'positive_log_amplitude_power','clock':{'default':'REAL_TIME','source_step_seconds':86400,'allow_speed_change_by_default':False,'optional_120_hour_remap':'PROPOSAL_REQUIRES_OWNER_APPROVAL'},'source':meta,'metrics':metrics,'source_slice_sha256':sha(raw_bytes),'upstream_errors_and_fallbacks':errors,'public_publish_allowed':False,'real_money_trading_allowed':False,'rights_status':'PUBLIC_COMMERCIAL_NOT_CLEARED','source_volume_in_simulator':False,'intrabar_order':'UNKNOWN_MODEL_ONLY','normalized_path':transformed}
  jd(ROOT/'data'/'scenarios'/f'{ident}.json',result)
  print(json.dumps({'id':ident,'rows':len(rows),'source':meta['provider'],'kind':meta['data_kind'],'target':target,'status':'VERIFIED'}),flush=True)
  return {k:v for k,v in result.items() if k!='normalized_path'}
 except Exception as exc:
  result={'id':ident,'asset':asset.upper(),'window_start':start,'window_end_inclusive':end,'target_peak_growth_pct':float(target),'status':'BLOCKED_DATA','error':str(exc)[:500],'attempts':errors,'public_publish_allowed':False}
  print(json.dumps(result),flush=True);return result
def selftest():
 rows=[{'date':'2020-01-01','close':10.0},{'date':'2020-01-02','close':8.0},{'date':'2020-01-03','close':100.0},{'date':'2020-01-04','close':30.0}]
 for target in (7248,11872.45,15324):
  vals,a,_,_=normalize(rows,target)
  assert vals[0]['close']==1 and vals[1]['close']<1 and vals[3]['close']<vals[2]['close']
  assert abs((max(v['close'] for v in vals)-1)*100-target)<1e-7 and a>0
 assert mdd([10,5,20,12])==50
 try: validate(rows[:1]+rows[2:],'2020-01-01','2020-01-04')
 except ValueError: pass
 else: raise AssertionError('gaps accepted')
 assert len(SPECS)==20 and len(set(x[1] for x in SPECS))==20
 assert all(7248<=float(x[4])<=15324 for x in SPECS)
if __name__=='__main__':
 selftest();ROOT.mkdir(parents=True,exist_ok=True)
 pin=json.loads(fetch('https://api.github.com/repos/coinmetrics/data/commits/master'))['sha']
 if not re.fullmatch('[0-9a-f]{40}',pin): raise ValueError('UNPINNED_CM_SOURCE')
 collected=dt.datetime.now(dt.timezone.utc).isoformat()
 with ThreadPoolExecutor(max_workers=2) as pool: records=list(pool.map(lambda item:process(item,pin),SPECS))
 jd(ROOT/'catalog.json',{'schema':'voltex.history-catalog.research.v1','collected_at_utc':collected,'coinmetrics_commit':pin,'source_code_sha256':sha(Path(__file__).read_bytes()),'code_head':os.environ.get('GITHUB_SHA'),'all_20_data_verified':all(r['status']=='RESEARCH_DATA_VERIFIED_NOT_RELEASED' for r in records),'release_allowed':False,'scenarios':records})
 (ROOT/'ATTRIBUTION_AND_RIGHTS.txt').write_text('Historical data attribution: Coin Metrics (https://github.com/coinmetrics/data), CC BY-NC 4.0; Binance Vision (https://github.com/binance/binance-public-data), CC BY-NC-SA 4.0 plus Vision Dataset Terms. This pack contains historical slices and modified log-scaled derivatives, not investment forecasts. No endorsement. Non-commercial research only; commercial product/bot deployment and redistribution are not cleared. Retain each source URL/hash and license. No real accounts, keys, orders, ledger, deposits or deployment. Exact current-source terms must be reviewed for the intended use.\n',encoding='utf-8')
 (ROOT/'collect_history.py').write_bytes(Path(__file__).read_bytes())
 sums={str(p.relative_to(ROOT)):sha(p.read_bytes()) for p in sorted(ROOT.rglob('*')) if p.is_file()}
 jd(ROOT/'SHA256SUMS.json',sums)
 ok=sum(r['status']=='RESEARCH_DATA_VERIFIED_NOT_RELEASED' for r in records)
 print(json.dumps({'data_verified':ok,'requested':20,'public_release':False,'elapsed_source_time_preserved_by_default':True}),flush=True)
 if ok!=20: sys.exit(2)
