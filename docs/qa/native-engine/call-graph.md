# Native engine — market-data call graph per command

What one command costs upstream, per kind, at 1 / 10 / 20 / 30 open
contracts. Counted on the service's market source (the interface production
wires to the collector), with the service's own 2-second quote snapshot
expired before every command, so each figure is the worst case. Asserted
exactly by `src/private-trading/__tests__/nativeCallGraph.test.ts`; nothing
here is a latency claim (see the benchmark note for timings).

## What one call is, in production

| Service call | Path | Venue (Bybit) REST calls behind it |
| --- | --- | --- |
| `instrument(symbol)` | API → collector `/private-trading/instruments/:symbol` | 2 (instrument + risk tiers), cached 60 s on the collector |
| `freshQuote(symbol)` | API → collector `/private-trading/quote/:symbol` | **2 per call, never cached**: order book (1000 levels) + ticker |
| `marks(symbols[])` (NEW) | API → collector `/private-trading/marks?symbols=…` | **0**: answered from the collector's WebSocket-fed, validated live frame |
| `history(symbol, window)` | API → collector `/private-trading/candles/:symbol` ×2 (trade + mark), pages of 1000 | 2 per page; a page that ended more than a minute ago is cached 15 min on the collector |

The contract an order EXECUTES on is always quoted with `freshQuote`: a
fill needs the observed book, and that quote also serves the same
command's valuation of that contract. Everything else only needs a mark.

## Calls per command — before this block

Every open contract quoted itself on every command (N = open contracts;
the executed contract's fresh quote is reused for its own valuation).

| Command | `instrument` | `freshQuote` | `history` | Venue REST calls at N = 30 |
| --- | --- | --- | --- | --- |
| OPEN, new contract | 1 | N + 1 | 0 | 62 (+2 instrument, cached) |
| OPEN, accumulate | 1 | N | 0 | 60 |
| CLOSE partial | 0 | N | 0 | 60 |
| Reduce-only LIMIT (rests) | 1 | N | 0 | 60 |
| CLOSE full | 0 | N | 0 | 60 |
| REFRESH, same minute | 0 | N | 0 | 60 |
| REFRESH, a minute closed | 0 | N | N (+1 per contract traded and closed inside the window) | 60 + 4·N |
| Plain read (state/account/wallet) | 0 | 0 (settle-only wallet; 1 per non-settle asset otherwise) | 0 | 0 |

At 30 contracts the 30-second refresh of ONE tab was 60 venue REST calls,
and every click 60 more — the "provider-request explosion" the old cap of 6
contracts was there to bound. The `history` column is the other cost:
one window per exposed contract per closed minute, two collector calls
each; it is unchanged by this block (see limitations).

## Calls per command — after this block

Non-target marks come from the collector's live frame in ONE call
(`marks`, ≤ 64 symbols). A contract the frame does not hold as current
(stale row, no mark, unknown to the universe), a failed frame call, or a
mark that would be older than 4 s when applied falls back to `freshQuote`
for that contract only.

| Command | `instrument` | `freshQuote` | `marks` calls (symbols) | `history` | Venue REST calls at N = 30 |
| --- | --- | --- | --- | --- | --- |
| OPEN, new contract | 1 | 1 | 1 (N) | 0 | 2 |
| OPEN, accumulate | 1 | 1 | 1 (N − 1) | 0 | 2 |
| CLOSE partial | 0 | 1 | 1 (N − 1) | 0 | 2 |
| Reduce-only LIMIT (rests) | 1 | 1 | 1 (N − 1) | 0 | 2 |
| CLOSE full | 0 | 1 | 1 (N − 1) | 0 | 2 |
| REFRESH, same minute | 0 | 0 | 1 (N) | 0 | **0** |
| REFRESH, a minute closed | 0 | 0 | 1 (N) | N (+1 as above) | 4·N |
| Plain read | 0 | 0 | 1 (non-settle assets) or 0 | 0 | 0 |

Per command at 30 contracts: **60 venue calls → 2** (a click) and
**60 → 0** (a refresh). The collector's `market_data_busy` cap of 8 parallel
venue calls is no longer reached by one account's refresh.

## Resting live LIMIT orders (block R5)

A resting live limit order fills only from an observed book (a journaled
`BOOK` instruction), never from the replayed OHLC path. The cost per
command: for each contract with a resting live order whose price the
FRESH last (frame or quote) has crossed, one checked book — the command's
own fresh quote when it is the same contract, the 2-second snapshot when
it is younger than the window, else one `freshQuote` (2 venue calls). No
crossing, no fetch. The `BOOK` is journaled only when it filled something,
cut to the levels the resting orders could take. A contract that carries
only a resting order (no position) is valued too, so an order-only
account is observed at all.

## Freshness — what did not change

- A quote or frame mark that was fresh when it answered but has left the
  window by the time every source of a valuation has answered is fetched
  once more, fresh, then left unpriced (block R8); an execution book that
  expired during the command's waits is decided again once on a fresh
  book, then refused (`quote_stale`). Replayed journal entries keep their
  event-time checks.
- `applyLatestQuotes` still refuses a mark older than 5 s (`LATEST_MARK_STALE`)
  and one from the future; a frame mark is applied only if younger than
  4 s at that moment (`NATIVE_FRAME_MARK_MAX_AGE_MS`), else the contract is
  quoted fresh — tested ("replaced by a fresh quote, never used").
- The API client keeps only frame marks whose event time, collector receive
  time and fetch time are all inside `PRIVATE_QUOTE_MAX_AGE_MS`; a stale
  row is ABSENT, never served as current — tested at both layers.
- The executed contract is never valued from the frame: its book is fetched
  fresh, checked (`assertPrivateFreshQuote`), and journaled with the
  instruction, as before.
- A collateral valuation reads a quote's MARK and the moment the venue
  produced it (`assertPrivateFreshMark`), never its book: a source that
  answers a valuation with a mark alone (the test-account wallet projection
  in `nativeTestAccounts.test.ts`) prices the holding, and a mark outside
  the freshness window at the moment of use is unpriced, not applied.
  Execution keeps the whole-book check.
- The mark's timestamp is the venue's event time when the ticker carries
  one, else the collector's receive time (the moment the observation
  existed); both are checked. Prices cross the frame as JS numbers and are
  re-serialized with `BigNumber.toFixed()`: exact for the venue's decimal
  precision (≤ 15 significant digits).

## Remaining limitations

- **History windows** are still one `history` per exposed contract per
  closed minute, two collector calls each (trade + mark candles), and the
  just-closed minute is never cached on the collector: at 30 contracts a
  30-second refresh costs up to 120 venue calls per minute per account.
  Not changed here; the honest fix is a collector-side 1-minute kline
  cache or a multi-symbol candle route, which is a separate change.
- A contract missing from the collector's universe (not streamed) is
  quoted per contract as before.
- The frame is read once per command phase (holdings valuation, position
  valuation), not once per command: two frame reads when the wallet holds
  non-settle assets. Both are memory reads on the collector.
