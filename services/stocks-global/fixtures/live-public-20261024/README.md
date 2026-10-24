# Authentic public market fixtures

Captured 2026-10-24 from unauthenticated official venue endpoints. Original wire bytes are base64 in wire.json, including actual gzip and MEXC Protobuf bytes. at is local receipt UTC milliseconds, not a substituted source time. metadata.json and history.json are bounded unchanged row subsets of real responses. kraken-v2-instrument.json records the actual 967042-byte instrument snapshot's five selected public rows.

These dated fixtures are offline test data, never a hosted release data source. The production selector never imports this directory. No credentials, account/order APIs, balances, synthetic OHLC or commercial-data-rights attestation. Bitget is UTA v3 spot-category rToken, a distinct unified share-equivalent product. Missing native WS candles are not filled from quote ticks.

Wire SHA-256: dc2f7611f515fd66873fd66fbd9b4e07b6ad772758021a4dfe8463697fc21bb1
