"""v2 composites: same rules as v1; TACTICAL executes on the Binance archive spot close."""
from .systems import main, BASELINES
from .features_v2 import registry

if __name__ == '__main__':
    BASELINES['tactical']['onchain_only'] = 'T101'   # positioning-only baseline (funding)
    main(registry_fn=registry, tag='_v2', price_for={'cycle': 'cm', 'regime': 'cm', 'tactical': 'bv'},
         closes={'bv': lambda d: d.raw('binance_vision', 'spot_close', 'btcusdt')},
         exec_close=lambda d: d.raw('binance_vision', 'spot_close', 'btcusdt'))
