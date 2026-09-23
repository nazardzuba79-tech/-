"""v3 regression tests: each test pins one defect found by the 2026-09-23 audit (mechanics only, not profitability)."""
import sys
from pathlib import Path
import numpy as np, pandas as pd, pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from csi.features import expanding_pct
from csi.v3util import expanding_pct_fast, pine_percentrank, h10_available, known_var
from csi.backtest import exposure, run, trend_exposure


def test_fast_percentile_identical_to_reference_with_ties_and_nans():
    rng = np.random.default_rng(3)
    s = pd.Series(np.round(rng.normal(size=900), 1), index=pd.date_range('2020-01-01', periods=900))
    s.iloc[::17] = np.nan
    a = expanding_pct(s.dropna(), 50); b = expanding_pct_fast(s, 50)
    pd.testing.assert_series_equal(a, b, check_names=False)


def test_pine_percentrank_semantics():
    up = pd.Series([1, 2, 3, 4, 5.0]); dn = pd.Series([5, 4, 3, 2, 1.0]); gap = pd.Series([np.nan, 1, 2, 3.0])
    assert pine_percentrank(up, 3).tolist()[3:] == [100.0, 100.0]
    assert pine_percentrank(dn, 3).tolist()[3:] == [0.0, 0.0]
    assert np.isnan(pine_percentrank(up, 3).iloc[2])
    assert pine_percentrank(gap, 3).iloc[3] == pytest.approx(200 / 3)   # NaN in the window counts as "not <="


def test_h10_weekly_release_rule():
    d = pd.DatetimeIndex(['2026-09-14', '2026-09-16', '2026-09-18'])   # Mon, Wed, Fri
    assert [x.date().isoformat() for x in h10_available(d)] == ['2026-09-21'] * 3


def test_known_var_latest_observation_wins_and_staleness():
    v = pd.Series([1.0, 2.0, 3.0], index=pd.DatetimeIndex(['2026-09-14', '2026-09-16', '2026-09-18']))
    cal = pd.date_range('2026-09-14', '2026-10-05')
    k = known_var(v, h10_available(v.index), cal, max_stale=7)
    assert np.isnan(k['2026-09-20']) and k['2026-09-21'] == 3.0 and k['2026-09-28'] == 3.0 and np.isnan(k['2026-09-29'])


def test_exposure_is_never_inverted():
    # regression for the v1/v2 CYCLE bug: a favourable-oriented score must map to a positively related exposure
    idx = pd.date_range('2015-01-01', periods=1500)
    score = pd.Series(np.sin(np.arange(1500) / 50.0), index=idx)
    e = exposure(score, rebal=1).dropna()
    assert pd.concat([score, e], axis=1).dropna().corr(method='spearman').iloc[0, 1] > 0.8


def test_holdout_window_does_not_restart_the_percentile():
    # regression for the v1/v2 holdout bug: cutting the window must not need a new 365-day warm-up inside it
    idx = pd.date_range('2019-01-01', periods=1600)
    score = pd.Series(np.random.default_rng(1).normal(size=1600), index=idx)
    close = pd.Series(np.exp(np.cumsum(np.random.default_rng(2).normal(0, 0.02, 1600))), index=idx)
    df, st = run(exposure(score, 1), close, start='2023-01-31')
    assert df.index.min() == pd.Timestamp('2023-01-31')


def test_simple_returns_full_exposure_equals_buy_and_hold():
    idx = pd.date_range('2020-01-01', periods=800)
    close = pd.Series(np.exp(np.cumsum(np.random.default_rng(5).normal(0, 0.03, 800))), index=idx)
    df, st = run(pd.Series(1.0, index=idx), close, cost=0.0)
    assert st['strategy']['cagr'] == pytest.approx(st['buy_and_hold']['cagr'])
    df2, st2 = run(pd.Series(0.5, index=idx), close, cost=0.001)
    assert df2['turnover'].iloc[0] == 0.5 and df2['turnover'].iloc[1:].sum() == 0


def test_trend_baseline_binary_and_causal():
    idx = pd.date_range('2020-01-01', periods=400)
    close = pd.Series(np.linspace(1, 2, 400), index=idx)
    e = trend_exposure(close, 200)
    assert e.dropna().isin([0.0, 1.0]).all() and np.isnan(e.iloc[198]) and e.iloc[250] == 1.0


def test_sanitize_turns_infinite_into_missing():
    from csi.v3util import sanitize
    p = pd.DataFrame({'a': [1.0, np.inf, -np.inf, 2.0], 'b': [1.0, 2.0, 3.0, 4.0]})
    q, counts = sanitize(p)
    assert q['a'].isna().sum() == 2 and counts == {'a': 2} and q['b'].notna().all()


def test_dq_mask_flags_only_impossible_zero_open_interest():
    from csi.v3util import dq_mask
    df = pd.DataFrame({'source': ['binance_vision', 'binance_vision', 'bitfinex', 'farside', 'coinmetrics'],
                       'metric': ['open_interest', 'open_interest', 'open_interest', 'etf_flow_musd', 'TxCnt'],
                       'value': [0.0, 5.0, 0.0, 0.0, 0.0]})
    assert dq_mask(df).tolist() == [True, False, True, False, False]   # zero ETF flow and zero 2009 tx count are real values


def test_forward_ledger_hash_chain_detects_tampering(tmp_path, monkeypatch):
    import shutil, csi.forward as fw
    src = Path(__file__).resolve().parents[1] / 'forward' / 'ledger.csv'
    if not src.exists():
        pytest.skip('ledger not created yet')
    led = tmp_path / 'ledger.csv'; shutil.copy(src, led)
    monkeypatch.setattr(fw, 'LEDGER', led)
    assert fw.verify() is True
    rows = led.read_text().splitlines()
    parts = rows[1].split(',')
    idx = rows[0].split(',').index('score')
    parts[idx] = str(float(parts[idx]) + 0.01)          # rewrite history by one hundredth
    rows[1] = ','.join(parts); led.write_text('\n'.join(rows) + '\n')
    assert fw.verify() is False


def test_merged_report_never_truncates_history(tmp_path):
    from csi.store import write_merged_report
    p = tmp_path / 'r.csv'; hdr = ['date', 'event_count']
    write_merged_report(p, hdr, [['2020-01-01', 3], ['2020-01-02', 3]])
    write_merged_report(p, hdr, [['2020-01-02', 2], ['2020-01-03', 3]])     # an incremental run with a small window
    rows = p.read_text().splitlines()
    assert rows == ['date,event_count', '2020-01-01,3', '2020-01-02,2', '2020-01-03,3']
