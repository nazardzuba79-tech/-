# Aitheron AI — explicit demo market

Source draft: `config/test-markets/aith.draft.json`. Logo:
`frontend/public/assets/coins/aith.svg` (vector, no remote asset dependencies).
This draft is not imported into the public catalogue. It cannot start a
countdown until explicitly published after implementation, QA and both releases.
When creating the draft, embed the SVG as a base64 data URL in `logo`.

Listing: Sunday 2026-10-11 15:00 UTC (18:00 Kyiv), 0.80 USDT.
Day-one endpoint: 14.60 USDT (+1725%). Six-hour discovery pause follows;
the next, slower, uneven rise matures on day seven. Then a permanent range,
without resetting to the legacy growth program. The hard maximum is
74.776 USDT (+9247% from listing); the trend endpoint sits below that maximum
to leave room for natural wick excursions. Every canonical tick price/high,
and therefore every aggregated candle, is bounded before publication.

The immutable `capped-growth-range-v1` program uses the shared scheduled
microstructure: uneven impulse legs, countertrend moves, breathing ranges,
flush/recovery events and activity-sensitive volume. It replaces the legacy
hour-anchor growth only for listings explicitly selecting this program with
`tradable: false`. It does not alter other profile-only managed listings, NRX,
VTA, orders, balances, execution or owner allocations. UI retains the existing
TEST / NOT TRADABLE status. No real-money orders can use this demo asset.

Configuration is persisted in the market-edge Listings Durable Object. Every
API registry/Worker read parses the same field; simulator cache identity
includes all schedule inputs. Once published, changing the program is rejected
by the existing history lock. To delay a launch, keep it in draft or postpone
before the listing opens; never publish an elapsed date.

QA: `cappedDemoListing.test.ts` checks exact day-one target, fourteen-day OHLC
cap (including highs), red candles, volume diversity, trade/price equality,
fresh-process determinism, day 1000 range, immutable publishing and rejection
of real Spot execution. No production account or financial mutation is used.
