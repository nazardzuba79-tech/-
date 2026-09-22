#!/usr/bin/env python3
"""Re-run the four required curl probes from the agent's runtime, not a browser."""
from pathlib import Path
import concurrent.futures,datetime,json,subprocess,os
ROOT=Path(__file__).resolve().parents[1]
TARGETS=[('alternative_me','https://api.alternative.me/fng/?limit=1'),('coinmetrics','https://community-api.coinmetrics.io/v4/catalog-v2/asset-metrics?assets=btc'),('binance','https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1'),('fred','https://fred.stlouisfed.org/graph/fredgraph.csv?id=WALCL')]
def probe(item):
    source,url=item
    cmd=['curl','--max-time','20','-sS','-o',os.devnull,'-w','%{http_code}\n',url]
    try:
        p=subprocess.run(cmd,capture_output=True,text=True,timeout=25)
        return dict(source=source,url=url,command=cmd,returncode=p.returncode,stdout=p.stdout,stderr=p.stderr,at_utc=datetime.datetime.now(datetime.timezone.utc).isoformat())
    except Exception as e:return dict(source=source,url=url,error=repr(e))
if __name__=='__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(probe,TARGETS))
    path=ROOT/'reports'/('network_probe_'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.json')
    path.write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(results,ensure_ascii=False,indent=2))
    print('Probe only: HTTP 200 is not yet validated history.')
