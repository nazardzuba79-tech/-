#!/usr/bin/env python3
"""Bounded public GET/health checks only. No auth, secrets or financial writes."""
import json, urllib.request, urllib.error, datetime
results=[]
checks=[('API retired ticker','http://127.0.0.1:13020/api/v1/market/ticker/NRX-USDT',410),('API retired candles','http://127.0.0.1:13020/api/v1/market/external/candles/NRX-USDT',410),('Edge retired catalogue','https://market.voltextech.net/market/nrx',410),('Edge retired book','https://market.voltextech.net/market/display/spot-book/NRX-USDT',410)]
for label,url,expected in checks:
 try:
  try:
   response=urllib.request.urlopen(url,timeout=10)
  except urllib.error.HTTPError as error: response=error
  with response:
   status=response.status;body=json.loads(response.read(4096));ok=status==expected and body.get('error')=='market_retired'
  results.append({'check':label,'status':status,'expected':expected,'result':'PASS' if ok else 'FAIL'})
 except Exception as error: results.append({'check':label,'result':'BLOCKED','cause':type(error).__name__})
try:
 with urllib.request.urlopen('http://127.0.0.1:13020/health',timeout=5) as response: health=json.load(response)
 results.append({'check':'API health/source','status':health.get('status'),'source':health.get('commit'),'result':'PASS' if health.get('status')=='ok' and health.get('commit')=='85f6122b7ac0aa3ce72a2af9ac9aac13d814e44d' else 'FAIL'})
except Exception as error: results.append({'check':'API health/source','result':'BLOCKED','cause':type(error).__name__})
try:
 with urllib.request.urlopen('https://market.voltextech.net/market/listings',timeout=10) as response: catalogue=json.load(response)
 assets=catalogue.get('assets',[])
 visible=[{k:a.get(k) for k in ['symbol','pair','version','countdown','listingAt','initialPrice']} for a in assets if a.get('symbol') in ['ECLV','QVTR']]
 ok=not any(a.get('symbol')=='NRX' for a in assets) and {a['symbol'] for a in visible}=={'ECLV','QVTR'}
 results.append({'check':'Public ECLV/QVTR preserved, NRX absent','listings':visible,'result':'PASS' if ok else 'FAIL'})
except Exception as error:results.append({'check':'Public ECLV/QVTR preserved, NRX absent','result':'BLOCKED','cause':type(error).__name__})
print(json.dumps({'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'readOnly':True,'checks':results},indent=2))
