# Wallet deposit modal — evidence

Produced by `node scripts/qa-wallet-deposit-select.cjs` against the normal
production build, on loopback fixtures. **Every address in these frames is an
obvious placeholder (`QA-ONLY-…-NOT-A-VALID-DEPOSIT-ADDRESS-000n`).** Reads
only; no production account, database, treasury or external request.

## What the owner reported, and what was actually wrong

"Не перелистує на другий актив, як би зависає для вибору іншого актива."

Reproduced first. **There was no functional hang**: picking a different
network did change the address and the asset list, and picking a different
asset did work. What made it read as stuck is that the screen asked for the
NETWORK first, and on most chains the asset list that followed held exactly
one entry — Bitcoin credits BTC only, TRC-20 credits USDT only. Opening it
changed nothing.

So the fix is the owner's own suggestion: **asset first, then the networks
that carry it.** Now the second list is the one with somewhere to go — USDT
offers TRC-20 and ERC-20 — and the first list is the question the user
actually has.

One real defect did turn up while reproducing: **Escape closed the whole
dialog instead of the open dropdown**, because the modal also listens for
Escape on `document` and registered first. The dropdown now listens in the
capture phase and stops propagation.

| file | what it shows |
|---|---|
| `1-opened.png` | asset above network, first asset preselected |
| `2-usdt.png` | USDT chosen; the network list holds exactly the two chains that credit it |
| `3-usdt-ethereum.png` | same asset, other network — the address follows |
| `4-btc.png` | BTC chosen; the network list narrows to Bitcoin and the address follows the asset |
| `steps.json` | what the modal reported at every step, plus any page errors |

## What the run asserts

- the asset picker sits **above** the network picker;
- the asset list is exactly the assets some wallet credits — none invented;
- USDT offers two networks, and switching between them changes the address;
- BTC narrows the network list to one, and the address follows the asset
  rather than staying on the previous chain;
- Escape closes the list and leaves the dialog open (the run cannot reach
  its later steps otherwise);
- zero page errors.

## Not verified

No production check. Non-RU locales were checked for key presence, not laid
out in a browser.
