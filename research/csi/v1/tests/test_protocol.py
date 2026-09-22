"""Unit tests for protocol mechanics. These test CODE correctness (lags, causality, parsing),
NOT profitability. Passing tests are not evidence of alpha."""
import math, sqlite3, sys, datetime as dt
from pathlib import Path
import numpy as np, pandas as pd, pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from csi.store import Store, add_lag, epoch_day, number
from csi.dataset import Data, forward_log_return
from csi.features import expanding_pct, roll_z, rsi
from csi.evaluate import slice_mask, block_bootstrap_ic
from csi.collect import parse_farside_table
from csi.systems import composite, backtest


@pytest.fixture
def tmp_store(tmp_path):
    (tmp_path / 'csi').mkdir(); (tmp_path / 'csi/schema.sql').write_text((Path(__file__).resolve().parents[1] / 'csi/schema.sql').read_text())
    import csi.store as st
    s = Store(tmp_path, today='2026-09-22')
    return s


def test_available_at_equals_date_plus_lag(tmp_store):
    s = tmp_store
    s.put('fred', 'WALCL', '', '2026-09-16', 100.0, 8); s.put('fred', 'M2SL', '', '2026-07-01', 5.0, 30); s.put('coinmetrics', 'PriceUSD', 'btc', '2026-09-21', 1.0, 1)
    rows = dict(((r[0], r[1]), r[2]) for r in s.db.execute('SELECT metric, date, available_at FROM series'))
    assert rows[('WALCL', '2026-09-16')] == '2026-09-24' and rows[('M2SL', '2026-07-01')] == '2026-07-31' and rows[('PriceUSD', '2026-09-21')] == '2026-09-22'


def test_current_day_and_missing_never_written(tmp_store):
    s = tmp_store
    assert s.put('okx', 'spot_close', 'btcusdt', '2026-09-22', 1.0, 0) is False   # today: partial bar
    assert s.put('okx', 'spot_close', 'btcusdt', '2026-09-23', 1.0, 0) is False   # future
    assert s.put('fred', 'VIXCLS', '', '2026-09-18', '.', 1) is False            # missing stays missing, never 0
    assert s.db.execute('SELECT COUNT(*) FROM series').fetchone()[0] == 0


def test_upsert_no_duplicates(tmp_store):
    s = tmp_store
    s.put('okx', 'spot_close', 'btcusdt', '2026-09-20', 1.0, 0); s.put('okx', 'spot_close', 'btcusdt', '2026-09-20', 2.0, 0)
    assert s.db.execute('SELECT COUNT(*), MAX(value) FROM series').fetchone() == (1, 2.0)


def test_non_finite_rejected():
    with pytest.raises(ValueError):
        number('inf')


def test_known_alignment_respects_lag_and_staleness():
    df = pd.DataFrame({'source': ['x'] * 3, 'metric': ['m'] * 3, 'asset': [''] * 3, 'date': pd.to_datetime(['2024-01-01', '2024-01-02', '2024-01-10']),
                       'available_at': pd.to_datetime(['2024-01-02', '2024-01-03', '2024-01-11']), 'value': [1.0, 2.0, 3.0]})
    d = Data(df); k = d.known(d.raw('x', 'm'), lag=1, max_stale=3)
    assert np.isnan(k[pd.Timestamp('2024-01-01')])            # not yet available on its own date
    assert k[pd.Timestamp('2024-01-02')] == 1.0 and k[pd.Timestamp('2024-01-03')] == 2.0
    assert k[pd.Timestamp('2024-01-06')] == 2.0 and np.isnan(k[pd.Timestamp('2024-01-07')])   # carried max 3 days, then missing


def test_forward_return_uses_future_only():
    c = pd.Series([1, 2, 4, 8.0], index=pd.date_range('2024-01-01', periods=4))
    r = forward_log_return(c, 1)
    assert math.isclose(r.iloc[0], math.log(2)) and np.isnan(r.iloc[-1])


def test_expanding_percentile_is_causal():
    s = pd.Series(np.arange(10, dtype=float), index=pd.date_range('2024-01-01', periods=10))
    p = expanding_pct(s, min_periods=3)
    assert np.isnan(p.iloc[1]) and p.iloc[9] == 1.0 and p.iloc[2] == 1.0
    s2 = s.copy(); s2.iloc[-1] = -100   # changing the future must not change the past
    assert expanding_pct(s2, 3).iloc[:-1].equals(p.iloc[:-1])


def test_slice_mask_excludes_overlapping_target_windows():
    idx = pd.date_range('2019-12-01', '2022-03-01', freq='D'); m = slice_mask(idx, 30, 'ex_2020-03_2022-01')
    assert not m[idx.get_loc(pd.Timestamp('2020-02-15'))]   # window 02-15..03-16 touches the excluded interval
    assert m[idx.get_loc(pd.Timestamp('2020-01-15'))] and m[idx.get_loc(pd.Timestamp('2022-02-01'))] and not m[idx.get_loc(pd.Timestamp('2021-06-01'))]


def test_block_bootstrap_band_contains_zero_for_noise():
    rng = np.random.default_rng(0); x = rng.normal(size=2000); y = rng.normal(size=2000)
    lo, hi = block_bootstrap_ic(x, y, 20, 100)
    assert lo < 0 < hi


def test_farside_parser_parentheses_and_totals():
    html = '<table class="etf"><thead><tr><th>Date</th><th>IBIT</th><th>GBTC</th><th>Total</th></tr></thead><tbody>' \
           '<tr><td>11 Jan 2024</td><td>111.7</td><td><span class="redFont">(95.1)</span></td><td>16.6</td></tr>' \
           '<tr><td>Total</td><td>1</td><td>2</td><td>3</td></tr></tbody></table>'
    heads, rows = parse_farside_table(html)
    assert heads == ['Date', 'IBIT', 'GBTC', 'Total'] and rows == [['2024-01-11', 111.7, -95.1, 16.6]]


def test_composite_equal_weight_and_min_coverage():
    idx = pd.date_range('2020-01-01', periods=800)
    panel = pd.DataFrame({'a': np.arange(800.0), 'b': -np.arange(800.0)}, index=idx)
    score, parts = composite(panel, [('a', 1), ('b', -1)], min_periods=10)
    assert math.isclose(score.dropna().iloc[-1], 1.0)  # both ranks 1.0 after sign
    score1, _ = composite(panel.assign(b=np.nan), [('a', 1), ('b', -1)], min_periods=10)
    assert score1.notna().sum() > 0  # 1 of 2 = 50% coverage allowed


def test_backtest_costs_and_exposure_timing():
    idx = pd.date_range('2020-01-01', periods=800); close = pd.Series(np.exp(np.linspace(0, 1, 800)), index=idx)
    score = pd.Series(np.linspace(0, 1, 800), index=idx)
    df, st = backtest(score, close, 'pct', 1, cost=0.0)
    assert (df['expo'].between(0, 1)).all() and st['strategy']['cagr'] > 0
    df2, _ = backtest(score, close, 'pct', 1, cost=0.01)
    assert df2['strat'].sum() < df['strat'].sum()


def test_rsi_bounds():
    c = pd.Series(np.cumsum(np.random.default_rng(1).normal(size=300)) + 100)
    r = rsi(c).dropna(); assert r.between(0, 100).all()


def test_v2_month_iter_and_unzip():
    import io, zipfile
    from csi.collect_v2 import month_iter, unzip_csv
    assert list(month_iter('2019-11', '2020-02-15')) == ['2019-11', '2019-12', '2020-01', '2020-02']
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        z.writestr('x.csv', 'a,b\n1,2\n')
    assert unzip_csv(buf.getvalue()) == [['a', 'b'], ['1', '2']]


def test_v2_registry_signs_fixed_and_hash_recorded():
    import hashlib
    from csi.features_v2 import registry
    feats = registry(); ids = [f.fid for f in feats]
    assert len(ids) == len(set(ids)), 'duplicate feature ids'
    assert all(f.sign in (-1, 0, 1) for f in feats)
    root = Path(__file__).resolve().parents[1]
    assert hashlib.sha256((root / 'csi/features_v2.py').read_bytes()).hexdigest() == (root / 'docs/PREREGISTRATION_v2_HASH.txt').read_text().strip()
