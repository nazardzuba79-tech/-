#!/usr/bin/env python3
"""Map every catalogue candidate (240) to what this run could actually do with it.
status:
  evaluated                 - implemented in csi/features.py and tested individually (fid in registry)
  redundant_family          - computable, deliberately not evaluated: exact/near identity with an evaluated candidate (MATHEMATICAL_REDUNDANCY.md)
  computable_not_evaluated  - inputs are in the database, but the candidate was not implemented in this release (budget / lower priority)
  data_unavailable          - required input not obtainable in this runtime (Coin Metrics non-Community, Binance/Bybit geo-block, CoinGecko 401/429, no options feed, no PIT universe)
  insufficient_history      - obtained but < 2 years of history (short OKX windows) => cannot be evaluated under the protocol
  untestable_definition     - catalogue verdict untestable / unverified definition; not implemented on purpose
"""
from __future__ import annotations
import csv, json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
SNAP = ROOT.parent / 'snapshot'


def main() -> None:
    from .features import registry
    reg = {f.fid.rstrip('t'): f for f in registry()}
    ev = {'M096t': 'M096'}
    rows = list(csv.DictReader((SNAP / 'catalog/catalog.csv').open(encoding='utf-8-sig')))
    meta = {m['id']: m for m in json.load((SNAP / 'catalog/selection_metadata.json').open())}
    out = []
    price_local = {'M001': 'evaluated', 'M015': 'evaluated', 'M017': 'evaluated', 'M018': 'evaluated', 'M021': 'evaluated', 'M032': 'evaluated', 'M040': 'evaluated', 'M044': 'evaluated', 'M053': 'evaluated',
                   'M057': 'evaluated', 'M058': 'evaluated', 'M059': 'evaluated', 'M064': 'evaluated', 'M065': 'evaluated', 'M066': 'evaluated'}
    redundant = {'M019': 'Williams %R = Stochastic %K - 100 (M018)', 'M022': 'ROC = TS momentum family (M015)', 'M034': 'NATR = ATR/price scaling (N003 realized vol used as the vol state)',
                 'O002': 'realized price = CapRealUSD/SplyCur; MVRV = price/realized price (O003)', 'O005': 'NUPL = 1 - 1/MVRV (O003)', 'M060': 'Pi Cycle = two MAs of price; family of M057/M059', 'M061': 'Golden ratio multiplier = price / 350DMA multiples; family of M057',
                 'O012': 'thermocap level enters O013 (mcap/thermocap)', 'O054': 'velocity needs TxTfrValAdjUSD (unavailable)', 'M016': 'MA crossover = SMA distance family (M001)', 'M002': 'EMA slope = trend family (M001/M015)'}
    for r in rows:
        fid = r['id']; ds = r['data_source']; v = r['verdict']; status = None; reason = ''
        if fid in reg or fid in ev.values():
            status = 'evaluated'; reason = 'implemented in csi/features.py; see evaluation/ic_individual.csv'
        elif fid in redundant:
            status = 'redundant_family'; reason = redundant[fid]
        elif v == 'untestable' or meta.get(fid, {}).get('definition_verification') in ('unverified_definition', 'unverified_provider_definition'):
            status = 'untestable_definition'; reason = r['verdict_reason'][:200]
        elif fid in ('M067', 'M069', 'M070', 'M071', 'M072', 'M073', 'M074'):
            status = 'insufficient_history'; reason = 'Binance 451 / Bybit 403; OKX fallback gives 72-180 days (rubik) or ~97 days (funding)'
        elif 'coinmetrics' in ds and r['metric'] in ('CapRealUSD', 'SplyAct1yr', 'SplyActEver', 'TxTfrValAdjUSD', 'NVTAdj90', 'VtyDayRet30d', 'supply_inactive_1y', 'supply_active_30d', 'hodl_waves', 'revived_supply_1y', 'nvt', 'rvt', 'monetary_velocity', 'sopr', 'coin_days_destroyed', 'cdd_supply_adjusted', 'dormancy', 'binary_cdd_causal', 'supply_top100_fraction', 'realized_cap_change', 'native_issuance', 'net_supply_growth', 'new_addresses', 'nonzero_addresses', 'mean_fee_native', 'fee_per_weight', 'block_count', 'block_interval_mean', 'block_size_mean', 'tx_throughput', 'median_fee_native', 'difficulty_ribbon', 'hash_price', 'DiffMean', 'FeeTotUSD', 'RevUSD', 'SplyCur', 'TxCnt', 'AdrActCnt'):
            have = r['metric'] in ('SplyCur', 'TxCnt', 'AdrActCnt', 'DiffMean', 'FeeTotUSD', 'RevUSD', 'native_issuance', 'net_supply_growth', 'nonzero_addresses', 'block_count', 'mean_fee_native', 'hash_price', 'difficulty_ribbon', 'realized_cap_change', 'tx_throughput')
            status = 'computable_not_evaluated' if have else 'data_unavailable'
            reason = 'inputs present in csi.db (Community or blockchain.info fallback); not implemented in v1 budget' if have else 'metric not in Coin Metrics Community catalog for btc/eth; no allowed free substitute with the same definition'
        elif 'binance_spot' in ds:
            status = 'computable_not_evaluated'; reason = 'OKX daily OHLCV present (2018+); indicator not implemented in v1 budget (trend/momentum/volatility family already represented)'
        elif 'beacon' in ds:
            status = 'data_unavailable'; reason = 'no public beacon/execution node history collected in this runtime'
        elif 'defillama' in ds:
            status = 'computable_not_evaluated' if r['metric'] in ('stablecoin_supply_change', 'stablecoin_issuer_hhi', 'protocol_fees', 'protocol_revenue', 'defi_usd_inflows') else 'data_unavailable'
            reason = 'DefiLlama aggregate series present; per-protocol/issuer breakdown not collected in v1' if status == 'computable_not_evaluated' else 'endpoint not collected'
        elif 'coingecko' in ds:
            status = 'data_unavailable'; reason = 'CoinGecko public API returned 429 then 401 for days=max (verbatim in collection_log); no point-in-time universe'
        elif 'fred' in ds:
            status = 'computable_not_evaluated' if r['metric'] in ('T10Y2Y', 'DFF', 'T10YIE', 'NFCI', 'WALCL', 'WTREGEN', 'RRPONTSYD', 'WRESBAL') else 'data_unavailable'
            reason = 'FRED series collected; not in v1 registry' if status == 'computable_not_evaluated' else 'no allowed free feed'
        elif 'farside' in ds:
            status = 'evaluated' if fid == 'M117' else 'data_unavailable'
        elif ds == 'coinmetrics' or ds == 'alternative_me':
            status = 'evaluated' if fid in reg else 'data_unavailable'; reason = 'VtyDayRet30d not in Community' if fid == 'M035' else ''
        else:
            status = 'data_unavailable'; reason = ds
        out.append(dict(id=fid, name=r['name'], group=r['group'], category=r['category'], catalog_verdict=v, data_source=ds, metric=r['metric'], run_status=status, run_reason=reason))
    with (ROOT / 'evaluation/catalog_audit.csv').open('w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys())); w.writeheader(); w.writerows(out)
    from collections import Counter
    c = Counter(o['run_status'] for o in out); print(dict(c)); (ROOT / 'evaluation/catalog_audit_summary.json').write_text(json.dumps(dict(c), indent=2))


if __name__ == '__main__':
    main()
