# Deposit wallets — evidence

The header's «Депозит» button now opens every configured deposit wallet at
once. It used to open a network dropdown and show one address at a time.

Produced by `node scripts/qa-deposit-wallets.cjs` against the normal
production build, on loopback fixtures. **Every address in these frames is an
obvious placeholder (`QA-ONLY-…-NOT-A-VALID-DEPOSIT-ADDRESS-000n`) and is not
a spendable destination.** No production account, database, treasury or
external request is involved, and the harness serves reads only.

| file | what it shows |
|---|---|
| `current-1440.png`, `current-390.png` | the screen as it renders against the current API, which carries each chain's address in the config envelope — one request for the whole list |
| `fallback-1440.png`, `fallback-390.png` | the same screen against an API that has **not** shipped that field, so each address is resolved through `/deposit-address/:chain`. Byte-identical to `current-*`: the deploy window cannot show the user a different set of wallets |
| `degraded-1440.png`, `degraded-390.png` | one chain (Solana) has no address anywhere. It is absent from the list and the screen says an address could not be loaded — it is never rendered blank |
| `metrics.json` | the measured result of each run: addresses read back, modal width, scroll overflow, `<select>` count, copy-button count, and how many copy buttons sit under a floating overlay |

## What the run asserts

- all six wallets printed in full, none abbreviated or truncated, at 1440×900 and 390×844;
- no `<select>` anywhere in the modal, and the «Сеть» label gone;
- one copy button per wallet, each labelled with its network for screen readers;
- copy puts the **full** address on the clipboard, and only the pressed button
  confirms — six buttons reporting «Скопировано» at once would be a lie;
- the combined network/asset warning renders once, with no unsubstituted `{…}`;
- the minimum appears only once the real figure has arrived;
- **0 copy buttons covered by a floating overlay**, measured with the modal
  scrolled to its end. The support launcher does stack above the modal
  (`z-index` 999 against the overlay's 100) but does not reach a button at
  either viewport — measured, not assumed, and now guarded.

## Not verified

No production check and no production login. Non-RU locales were checked for
key presence, not laid out in a browser.
