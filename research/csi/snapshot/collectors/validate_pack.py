#!/usr/bin/env python3
"""Structural checks. NO_DATA never becomes an empirical PASS."""
from pathlib import Path
import ast,csv,gzip,hashlib,json,sqlite3,collections,datetime,sys
R=Path(__file__).resolve().parents[1]
EXPECTED=['id','name','group','category','assets','proposed_horizon','formula','inputs','metric','mechanism','evidence_for','evidence_against','sources','source_types','data_source','cost','history_start','publication_lag_days','revisions','collected','verdict','verdict_reason']
def main():
    checks=[]
    def check(name,condition):
        checks.append({'check':name,'status':'PASS' if condition else 'FAIL'})
    with (R/'catalog/catalog.csv').open(encoding='utf-8-sig',newline='') as f:
        reader=csv.DictReader(f);columns=reader.fieldnames;rows=list(reader)
    meta=json.loads((R/'catalog/selection_metadata.json').read_text());src=json.loads((R/'catalog/sources.json').read_text());sources={s['id']:s for s in src}
    check('exact_catalog_columns',columns==EXPECTED)
    check('120_market_120_onchain',collections.Counter(r['group'] for r in rows)=={'market':120,'onchain':120})
    check('unique_candidate_ids',len({r['id'] for r in rows})==len(rows))
    check('unique_metric_names',len({r['metric'] for r in rows})==len(rows))
    check('verdict_enum',all(r['verdict'] in {'keep_candidate','weak','reject','untestable'} for r in rows))
    check('source_keys_exist',all(s in sources for m in meta for s in m['source_ids']))
    check('all_source_urls_registered',all(u in {s['url'] for s in src} for r in rows for u in r['sources'].split(';')))
    check('csv_json_agree',rows==json.loads((R/'catalog/catalog.json').read_text()))
    check('all_category_cards_exist',all((R/f'catalog/by_category/{r["category"]}.md').exists() for r in rows))
    check('all_rows_have_formula_risk_verdict_reason',all(r['formula'] and r['evidence_against'] and r['verdict_reason'] for r in rows))
    with sqlite3.connect(R/'data/csi.db') as db:
        info=db.execute('pragma table_info(series)').fetchall()
        check('exact_series_schema_columns',[x[1] for x in info]==['source','metric','asset','date','available_at','value','ingested_at'])
        check('exact_series_primary_key',[x[1] for x in sorted([v for v in info if v[5]],key=lambda x:x[5])]==['source','metric','asset','date'])
        check('sqlite_integrity',db.execute('pragma integrity_check').fetchone()[0]=='ok')
        n,first,last=db.execute('SELECT COUNT(*),MIN(date),MAX(date) FROM series').fetchone()
    with gzip.open(R/'data/series.csv.gz','rt',encoding='utf-8') as f:backup=list(csv.reader(f))
    check('backup_row_count_matches_database',len(backup)-1==n)
    if n==0:
        check('mode_B_banner', (R/'README.md').read_text().splitlines()[0]=='RESEARCH ONLY — NO DATA')
        check('no_claimed_collection_or_dates',all(r['collected']=='no' and r['history_start']=='' for r in rows))
    for p in sorted((R/'collectors').glob('*.py')):
        try:ast.parse(p.read_text(encoding='utf-8'));check('python_syntax_'+p.name,True)
        except SyntaxError:check('python_syntax_'+p.name,False)
    with (R/'reports/missing_core_metrics.csv').open(encoding='utf-8-sig') as f:missing=list(csv.DictReader(f))
    check('73_unique_core_pairs',len(missing)==73 and len({(r['metric'],r['asset']) for r in missing})==73)
    def expected_lag(r):
        if r['metric'] in {'WALCL','WTREGEN','WRESBAL'}: return 8
        if r['metric']=='M2SL': return 30
        if r['source'] in {'binance_spot','binance_futures','alternative_me'}: return 0
        return 1
    check('fixed_lag_contract',all(int(r['lag_days'])==expected_lag(r) for r in missing))
    result={'checked_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'STRUCTURE_ONLY_NOT_EMPIRICAL_VALIDATION','checks':checks,'passed':sum(c['status']=='PASS' for c in checks),'failed':sum(c['status']=='FAIL' for c in checks),'series_rows':n,'first_date':first,'last_date':last,'lag_check':'NOT_EVALUATED_NO_DATA' if n==0 else 'REQUIRES_ACTUAL_DATA_AUDIT','live_API_tests':'NOT_RUN','market_backtests':'NOT_RUN'}
    (R/'reports/quality_check.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False,indent=2));return 1 if result['failed'] else 0
if __name__=='__main__':raise SystemExit(main())
