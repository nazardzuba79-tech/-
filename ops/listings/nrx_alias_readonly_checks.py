#!/usr/bin/env python3
"""Bounded read-only verification around the approved NRX one-module release.
No financial HTTP requests, DB writes, backup decrypt/restore or configuration changes.
"""
import argparse, datetime, hashlib, json, math, os, pathlib, runpy, subprocess, urllib.request

BASE = '85f6122b7ac0aa3ce72a2af9ac9aac13d814e44d'
NEW = '210aefacb319374194392624d75b312b87b42e94'
API = 'voltex-cutover-api-production-1'
DB = 'voltex-cutover-db-1'
SNAPSHOT = pathlib.Path('/opt/voltex-precutover/releases/nrx-alias-readonly-20261028.state.json')

def run(args, data=None, timeout=25):
    p = subprocess.run(args, input=data, capture_output=True, text=True, timeout=timeout)
    if p.returncode: raise RuntimeError('Read-only check failed: '+args[0]+' exit '+str(p.returncode))
    return p.stdout

def private_write(path, value):
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f: json.dump(value, f)

def db_snapshot():
    target = "pair IN ('NRX/USDT','NRX-USDT','NRXUSDT','NRX/SIMUSDT','NRX-SIMUSDT','NRXSIMUSDT','NRX') OR pair LIKE 'NRX/%' OR pair LIKE '%/NRX'"
    sql = "BEGIN READ ONLY; SET LOCAL statement_timeout='3s'; SET LOCAL lock_timeout='500ms';\n"
    sql += "SELECT json_build_object('readOnly',current_setting('transaction_read_only'),'postgresVersion',current_setting('server_version'));\n"
    for table, where in [('Order', target), ('Trade', target), ('Balance', "asset='NRX'")]:
        sql += "SELECT json_build_object('table','"+table+"','count',count(*),'digest',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),''))) FROM \""+table+'\" t WHERE '+where+';\n'
    sql += 'COMMIT;\n'
    raw = run(['docker','exec','-i',DB,'sh','-c','exec psql -X -qAt -U "$POSTGRES_USER" -d voltex_stage -v ON_ERROR_STOP=1'], sql)
    rows = [json.loads(line) for line in raw.splitlines() if line.startswith('{')]
    assert len(rows) == 4 and rows[0]['readOnly'] == 'on', 'DB read-only transaction not confirmed'
    return rows

def backup():
    status = dict(line.split('=',1) for line in run(['systemctl','show','voltex-pg-backup.service','-p','Result','-p','ExecMainStatus','-p','ExecMainExitTimestamp']).splitlines())
    assert status['Result'] == 'success' and status['ExecMainStatus'] == '0', 'Last backup job failed'
    folder = pathlib.Path('/opt/voltex-precutover/backups/local-20261028T032048Z')
    assert folder.is_dir() and not folder.is_symlink(), 'Fresh backup missing'
    at = datetime.datetime.strptime(folder.name, 'local-%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.timezone.utc)
    assert 0 <= (datetime.datetime.now(datetime.timezone.utc)-at).total_seconds() < 48*3600, 'Backup is stale'
    files = []
    for p in sorted(folder.iterdir()):
        if p.is_file() and not p.is_symlink() and p.name.endswith(('.enc','.age','.gpg')):
            assert p.stat().st_size > 0, 'Empty encrypted backup'
            digest = hashlib.sha256()
            with p.open('rb') as f:
                for part in iter(lambda:f.read(1024*1024), b''): digest.update(part)
            files.append({'name':p.name,'bytes':p.stat().st_size,'sha256':digest.hexdigest()})
    assert files, 'No encrypted backup payload found'
    assert (folder/'complete.json').is_file() and (folder/'manifest.json').is_file(), 'Backup completion marker or manifest missing'
    return {'job':status,'snapshot':folder.name,'encryptedFiles':files,'completionMarkerPresent':True,'manifestPresent':True,'decrypted':False,'restorePerformed':False}

def public_checks():
    result=[]
    def positive(v):
        try: return math.isfinite(float(v)) and float(v)>0
        except (TypeError,ValueError): return False
    for name,path,kind in [
      ('BTC/USDT','/market/external/tickers/BTC-USDT','ticker'),
      ('ETH/USDT','/market/external/tickers/ETH-USDT','ticker'),
      ('CFD','/cfd/tickers','cfd'),
      ('Futures candles','/market/futures/candles/BTC-USDT?interval=15m&limit=3','candles')]:
        try:
            with urllib.request.urlopen('http://127.0.0.1:13020/api/v1'+path,timeout=12) as r: body=json.load(r); status=r.status
            if kind=='ticker': ok=positive(body.get('ticker',{}).get('lastPrice'))
            elif kind=='cfd': ok=any(positive(row.get('price',row.get('lastPrice'))) for row in body.get('tickers',[]))
            else:
                rows=body if isinstance(body,list) else body.get('candles',[])
                ok=bool(rows) and all(positive(row.get('close')) for row in rows)
            result.append({'check':name,'http':status,'result':'PASS' if ok else 'FAIL_SHAPE'})
        except Exception as error: result.append({'check':name,'result':'BLOCKED','cause':type(error).__name__})
    return result

def runtime_gates():
    js = r'''const assert=require('node:assert/strict'); let network=0; global.fetch=()=>{network++;throw Error('Diagnostic network forbidden');};
    const g=require('/app/dist/services/testMarkets/nrxSpot.js'),p=require('/app/dist/shared/nrxRetirement.js');
    (async()=>{let checks=0;for(const pair of ['NRX/USDT','NRX-USDT','nrx_usdt','NRXUSDT','NRX','NRX/BTC','BTC/NRX','NRX/SIMUSDT','NRXSIMUSDT']){
      assert.equal(p.isRetiredNrx(pair),true);checks++;assert.throws(()=>g.assertSpotListing(pair),/NRX is no longer/);checks++;
      await assert.rejects(g.assertSpotListingReady(pair),/NRX is no longer/);checks++;
    }for(const pair of ['BTC/USDT','ETH/USDT','NRXCOIN/USDT']){assert.equal(p.isRetiredNrx(pair),false);assert.doesNotThrow(()=>g.assertSpotListing(pair));checks++;}
    for(const pair of ['BTC/USDT','ETH/USDT']){const source={getTicker:async()=>({lastPrice:'42'})};assert.deepEqual(await g.spotPriceSource(source).getTicker(pair),{lastPrice:'42'});checks++;}
    assert.equal(network,0);console.log(JSON.stringify({result:'PASS',checks,networkRequests:network,financialRequests:0,syntheticSourceUsedOnlyInDiagnosticProcess:true}));process.exit(0);})().catch(e=>{console.log(JSON.stringify({result:'FAIL',error:e.name}));process.exit(1)});'''
    return json.loads(run(['docker','exec','-i',API,'node'],js))

def main():
    ap=argparse.ArgumentParser();ap.add_argument('phase',choices=['before','after']);a=ap.parse_args()
    op=runpy.run_path('/tmp/nrx-alias.py')
    c=op['inspect'](); h=op['health'](); expected=BASE if a.phase=='before' else NEW
    assert h.get('status')=='ok' and h.get('commit')==expected, 'Unexpected runtime source'
    assert c['State']['Health']['Status']=='healthy', 'API not healthy'
    op['memory_guard']();op['production_flags_match']()
    args,service=op['compose_context'](c)
    resolved=json.loads(op['run'](args+['config','--format','json']))
    assert resolved['services'][service]['command']==['node','dist/index.js'], 'Unexpected startup'
    rollback=op['authoritative_base_image']()
    assert op['run'](['docker','image','inspect',op['BASE_TAG'],'--format','{{.Id}}']).strip()==rollback,'Rollback unavailable'
    pins=dict(op['OLD_HASHES'])
    if a.phase=='after': pins['dist/shared/nrxRetirement.js']='2bf120f248775595d3160017e0bcaf6cc160561beeee8b4071fd8e0d249eea7c'
    actual={line.split()[1]:line.split()[0] for line in op['run'](['docker','exec',API,'sha256sum',*pins]).splitlines()}
    assert actual==pins,'Runtime or P0 modules changed'
    db=json.loads(run(['docker','inspect',DB]))[0]
    assert db['State']['Health']['Status']=='healthy','PostgreSQL not healthy'
    rows=db_snapshot()
    snapshot={'db':rows,'runtimeSignature':op['digest'](op['runtime_signature'](c)),'dbContainer':db['Id']}
    report={'phase':a.phase,'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':h['commit'],'apiImage':c['Image'],'health':'ok','node':run(['docker','exec',API,'node','--version']).strip(),'postgresVersion':rows[0]['postgresVersion'],'postgresHealthy':True,'nrxCounts':{row['table']:row['count'] for row in rows[1:]},'pinnedRuntimeModules':len(pins),'financialFlagsPreserved':True,'rollbackImage':rollback,'rollbackAvailable':True}
    if a.phase=='before':
        assert c['Image']==rollback,'Actual base image changed'
        report['backup']=backup(); private_write(SNAPSHOT,snapshot)
    else:
        before=json.loads(SNAPSHOT.read_text());assert snapshot==before,'NRX history/balance/runtime/DB identity changed'
        report['nrxHistoryAndBalancesUnchanged']=True;report['databaseContainerUnchanged']=True
        report['runtimeGates']=runtime_gates()
        logs=subprocess.run(['docker','logs','--since',h.get('startedAt',h.get('started_at','10m')),'--tail','300',API],capture_output=True,text=True,timeout=15)
        assert logs.returncode==0,'Log read failed'
        log=logs.stdout+'\n'+logs.stderr
        report['fatalLogLines']=sum(any(term in line for term in ['uncaughtException','UnhandledPromiseRejection','FATAL']) for line in log.splitlines())
        assert report['fatalLogLines']==0,'Fatal runtime log'
    report['publicGetChecks']=public_checks()
    private_write(SNAPSHOT.with_name('nrx-alias-readonly-20261028.'+a.phase+'.json'),report)
    print(json.dumps(report,indent=2))

if __name__=='__main__':
    try:main()
    except Exception as error: print(json.dumps({'result':'FAIL','error':type(error).__name__,'message':str(error) if isinstance(error,AssertionError) else 'Read-only diagnostic failed; private output suppressed'}));raise SystemExit(1)
