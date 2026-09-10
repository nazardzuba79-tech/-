# Register / Wallet Tailwind ownership — audit

Audited on `main` **42a154691af173d755eab2810f8ad09dd48feab8** (the PR #17 merge).
Phase 1 only: find out where the Tailwind utilities these two routes use
actually come from, and change nothing that a user is not currently losing by.

## Verdict

| Route | Verdict | Why |
| --- | --- | --- |
| `/register` | **A — owns everything it renders** | Uses no Tailwind utility at all. Its whole vocabulary is `vx-auth-*`, hand-written in `auth-shell/auth-shell.css`, which `AuthShell.tsx` declares and `RegisterPage.tsx` imports. |
| `/wallet` | **B — works only because the eager homepage stylesheet happens to carry the same utilities** | `wallet-v3/wallet.css` carries no `@tailwind` directive and the built `WalletPage-*.css` contains none of the 293 utilities the page uses. They arrive only via `index-*.css`. |

Neither route is **C**. Both render correctly today, at 1440 and 390, on a cold
first navigation, with no page errors, no console errors and no horizontal
overflow.

## How the emission actually works here

Tailwind writes its generated layer into whichever stylesheet carries
`@tailwind utilities`. `content` decides *what* is generated, never *where* it
lands. On this commit exactly three stylesheets carry a directive:

| Stylesheet | Imported by | Route eagerness | Config |
| --- | --- | --- | --- |
| `pages/home/home-tailwind-utilities.css` | `HomePage.tsx` | **eager** | shared `tailwind.config.js` |
| `pages/settings-arctic/tailwind-utilities.css` | `SettingsPage.tsx` | lazy | shared `tailwind.config.js` |
| `pages/crypto-card-final/crypto-card.css` | `CardPage.tsx` | lazy | **scoped** — `@config "../../../tailwind.crypto-card.config.js"` |

The first two are filled with the **union** of everything the shared config
scans — Settings, Home, Register, WalletPage and `wallet-v3` — so each is a
near-copy of the other. The third is not: its `@config` points at a config
that scans only `crypto-card-final/**` with a `vc-` prefix, so `CardPage-*.css`
carries none of the shared union. **That is the existing precedent for giving a
route its own layer without duplicating everyone else's.**

`corePlugins: { preflight: false }` is unchanged and asserted; no global element
reset ships anywhere.

## Evidence

### Static

- Class extraction over `src/pages/register/**` yields **0** Tailwind
  utilities — 17 class names, all `vx-auth-*`.
- Class extraction over `WalletPage.tsx` + `wallet-v3/**` yields **293**
  Tailwind utilities, including responsive and arbitrary values
  (`lg:grid-cols-[minmax(0,1fr)_350px]`, `xl:grid-cols-[minmax(0,1fr)_390px]`,
  `max-h-[calc(92vh-136px)]`, `bg-[#101828]/35`).
- All 293 are emitted in exactly two chunks: `index-*.css` and
  `SettingsPage-*.css`. **0** of them are in `WalletPage-*.css`,
  `TradePage-*.css`, `TradeTerminal-*.css` or `CardPage-*.css`.
- 194 of the 293 are not used by the homepage at all, so they are in the eager
  stylesheet purely as a side effect of the shared `content` list.

### Cold-navigation browser tests (production build)

Fresh context per test, visiting the route and nothing else — never `/`,
Settings, Crypto Card, Trade or Futures. Assertions on **computed style**, not
class strings.

`/register` @1440 and @390 — one CSS request (`index-*.css`); the full
approved two-column shell renders; `.vx-auth-form` → `flex/column`,
`.vx-auth-input` → `solid 1px`, h=50px, `.vx-auth-submit` → h=52px, r=8px; no
Tailwind utility class is present in the live DOM at all; 0 page errors,
0 console errors, no horizontal overflow.

`/wallet` @1440 and @390 — four CSS requests (`index`, `WalletPage`,
`TradeTerminal`, `TradePage`); `.gap-3` → `12px`, `.rounded-wlg` → `8px`,
`.text-ink-3` → `rgb(102,112,133)`, `.bg-panel` → `rgb(255,255,255)`, the
holdings grid → `962px 390px` at 1440 and a single `358px` column at 390;
0 page errors, 0 console errors, no horizontal overflow.

### The isolation experiment

The 291 plain-class utility rules Wallet uses were deleted **from the shipped
`index-*.css` itself** (93 275 → 80 225 bytes). Nothing else was touched — the
app chrome in `index.css`, `home.css`, `auth-shell.css` and Wallet's own
`wallet.css` all stayed byte-identical, and no rebuild was involved.

A cold `/wallet` against that build collapsed exactly the way the homepage
collapsed before PR #17:

| Probe | Shipped build | Utilities removed |
| --- | --- | --- |
| `.flex` | `flex` | `block` |
| `.grid` | `grid` (390) | `block` |
| `.gap-3` | `12px` | `normal` |
| `.rounded-wlg` | `8px` | `0px` |
| `.bg-panel` | `rgb(255,255,255)` | transparent |
| `.text-ink-3` | `rgb(102,112,133)` | inherited `rgb(17,19,24)` |
| holdings grid | `962px 390px` | `none` |

A cold `/register` against the same stripped build was **byte-for-byte
identical** to the normal build on every probe. That is the whole verdict in
one experiment: Wallet is standing on the homepage's layer, Register is not.

## What it would cost to fix

Measured on this build. Raw sizes in Vite's kB (÷1000).

| Chunk today | raw | gzip |
| --- | --- | --- |
| `index-*.css` (eager) | 93.28 kB | 19.59 kB |
| `SettingsPage-*.css` | 44.61 kB | 8.52 kB |
| `CardPage-*.css` (scoped config) | 30.20 kB | 5.62 kB |
| `WalletPage-*.css` | 2.50 kB | 0.78 kB |

The union utilities layer itself is **+43.94 kB raw / +8.37 kB gzip**, measured
as PR #17's before/after delta on the eager stylesheet. Split by page (plain
single-class rules only, so these are lower bounds — compound selectors like
`.group:hover .group-hover\:…` and `space-y-*` are excluded):

| Subset | rules | raw | gzip |
| --- | --- | --- | --- |
| union (all scanned pages) | 706 | 36.34 kB | 7.22 kB |
| home only | 376 | 19.36 kB | 4.30 kB |
| wallet only | 291 | 13.05 kB | 3.03 kB |
| settings only | 275 | 12.78 kB | 3.15 kB |

**Option 1 — add `@tailwind utilities;` to `wallet-v3/wallet.css`.** One line.
`WalletPage-*.css` goes 2.50 → ~46.4 kB raw / ~9.2 kB gzip: the whole union.
Of the 752 classes in that union, 459 are ones Wallet never uses, and all of
it duplicates what the eager stylesheet already sent. This is the "duplicate
~90 kB into several chunks" outcome, and it is the reason not to reach for the
directive reflexively.

**Option 2 — a scoped `@config`, following Crypto Card.** A
`tailwind.wallet.config.js` scanning only `WalletPage.tsx` + `wallet-v3/**`,
referenced by `@config` at the top of `wallet.css`. `WalletPage-*.css` goes
2.50 → roughly 16–18 kB raw / ~3.9 kB gzip with zero dead weight, and Wallet
stops depending on any other route. It is still a duplicate of what the eager
layer sends *unless* the shared config's `content` is also narrowed to the
homepage — which would take ~24 kB raw off the eager stylesheet but means
re-verifying Home, Settings and Register against a changed shared config, and
`tailwind.config.js` is fingerprinted by `cryptoCardProductionPromotion`.

**Neither is implemented here.** There is no current user-facing failure, and
Option 2 done properly is the build restructuring this PR was told to stay out
of. What ships instead is the test suite below, so the dependency fails loudly
instead of silently.

## Regression tests

`frontend/src/lib/__tests__/registerWalletTailwindOwnership.test.ts`, 11 tests.
The load-bearing ones, each proven to fail when its invariant is broken:

- **`/register` uses no Tailwind utility.** Adding `mt-4 flex gap-2` to
  `RegisterPanel.tsx` fails it, naming the three classes.
- **HomePage must stay eager.** Converting it to `lazy(() => import(…))` in
  `App.tsx` fails it. This is the single line the whole Wallet route silently
  depends on.
- **A cold `/wallet` downloads every utility it uses.** Checked against the
  eager stylesheet ∪ `WalletPage-*.css` — deliberately indifferent to which of
  the two supplies them, so it keeps passing if Wallet is later given a layer
  of its own, and fails the moment neither does. Pointed at the stripped build,
  it fails and lists the 262 missing classes.

Plus: exactly three stylesheets carry a directive and they are named;
Crypto Card's scoped `@config` is pinned as the precedent; the config still
scans Wallet; preflight stays false; and no preflight reset reaches the built
eager CSS.

## Separate finding — `shadow-panel` renders a white shadow (not fixed here)

Found during the audit; unrelated to ownership, and **not fixed**, because the
fix has to edit `tailwind.config.js`, whose hash is pinned by
`cryptoCardProductionPromotion`, and re-taking a preservation fingerprint is
the owner's call.

Tailwind builds `shadow-*` from **both** `theme.boxShadow` and `theme.colors`.
`panel` exists in both — `boxShadow.panel: '0 1px 2px 0 rgba(16,24,40,0.04)'`
and `colors.panel.DEFAULT: '#ffffff'` — so `.shadow-panel` is emitted twice:

```css
.shadow-panel{--tw-shadow: 0 1px 2px 0 rgba(16,24,40,.04); …}
.shadow-panel{--tw-shadow-color: #ffffff; --tw-shadow: var(--tw-shadow-colored)}
```

The colour rule is emitted second and wins. Live on `/wallet`, all four panels
that carry the class compute `box-shadow: rgb(255,255,255) 0px 1px 2px 0px` —
a white shadow on a white panel, invisible against the `#f6f7f9` workspace. The
subtle panel edge the design specifies has never rendered.

`panel` is the only key present in both scales. The minimal fix is to rename
the box-shadow key so it cannot collide — `wpanel`, matching the same
discipline the neighbouring `borderRadius` block already documents for `w` /
`wsm` / `wlg` — and update the five call sites in `wallet-v3/`
(`PortfolioStrip`, `PortfolioAllocation`, `AssetLedger` ×2,
`TransactionHistory`). It changes what Wallet looks like, so it wants an
explicit yes.
