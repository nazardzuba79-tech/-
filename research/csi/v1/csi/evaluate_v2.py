"""v2 individual evaluation: v2 registry, TACTICAL priced on the Binance archive spot close."""
from .evaluate import main
from .features_v2 import registry


def price_keys_v2(f):
    if f.system in ('cycle',) or f.fid == 'C002':
        return ['cm']
    if f.system == 'regime':
        return ['bv', 'cm']
    return ['bv']


if __name__ == '__main__':
    import sys
    main(boot='--noboot' not in sys.argv, registry_fn=registry, tag='_v2', price_keys_for=price_keys_v2,
         primary_price=lambda f: 'bv' if f.system == 'tactical' else 'cm',
         extra_targets={'bv': lambda d: d.raw('binance_vision', 'spot_close', 'btcusdt')},
         prereg_hash_file='docs/PREREGISTRATION_v2_HASH.txt', features_file='csi/features_v2.py')
