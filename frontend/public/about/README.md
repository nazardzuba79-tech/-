# About-page assets

These files are presentation assets for `/legal/about`, not live market data.
All photos are served locally, in responsive WebP variants; visiting the page
does not contact an external image provider.

## Photography

| Files | Original source | Use |
| --- | --- | --- |
| `hero-{wide,small}.webp` | [Vitaly Gariev / Pexels 36712834](https://www.pexels.com/photo/business-professionals-discussing-outside-office-36712834/) | Daylight conversation outside a modern office |
| `portrait-{wide,small}.webp` | [Alena Darmel / Pexels 8133947](https://www.pexels.com/photo/a-woman-using-a-laptop-while-working-at-the-office-8133947/) | Person working at a laptop |
| `lifestyle-{wide,small}.webp` | [Pexels 6476349](https://www.pexels.com/photo/6476349/) | Everyday business setting |

The [Pexels license](https://www.pexels.com/license/) permits use and adaptation.
People pictured are illustrative models, not represented as VOLTEX employees,
founders, customers or endorsers. No corporate facts are inferred from a photo.

The owner-supplied `project-bolt-sb1-tpmko8tu.zip` is the composition reference.
Its original hero did not match the daylight brief, and one working-person photo
contained another exchange's screen. Those photos were replaced. No reference
mockup's fabricated financial values, bank cards, ratings or partner claims are
used.

## Product screens

`terminal-desktop.webp` and `terminal-mobile.webp` are screenshots of the actual
VOLTEX frontend rendered with local deterministic QA fixtures. They are labelled
as interface examples, not real-time quotes, account balances, investment returns
or evidence of exchange activity. They contain no production account or personal
data. CSS device frames do not add any product capabilities.

Capture provenance: frontend tree from main
`ca69d47eaccccf18a1bd7e45e34452fcd60e9e91` (built source
`30713576a3f8f57338eaa194be8a72bd2d0547a8`), BTC/USDT, 1h, 520 fixture OHLC
bars; full 1440×900 and 390×844 viewports. No account initialization or financial
write was made; external network access was blocked. Export uses WebP format
conversion only, without changing the UI in the screenshot.

The About page embeds these static files only: it never initializes a trading
session, subscribes to market prices or executes a financial operation to render
the illustrations.
