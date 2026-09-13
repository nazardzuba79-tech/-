# Futures terminal interface study

The most consequential mismatch was typography, not the darkness of the background. The VOLTEX header used DM Sans, its branding used Manrope, and the trading workspace forced Arial. Market statistics also inherited weights of 650 and 680 and a negative tracking value. The inspected Bybit interface uses Inter for navigation, market information and order controls. A consistent font, predictable weights and aligned controls produce a closer match than additional shadows or darker backgrounds.

## Reference and method

The reference is the current public [Bybit BTCUSDT perpetual terminal](https://www.bybit.com/en/trade/usdt/BTCUSDT), inspected on 13 September 2026, together with the supplied authenticated Bybit screenshot. The public page is logged out: its Sign Up/Log In actions are not a reference for trading actions in an authenticated account. The supplied screenshot remains the reference for the paired Long/Short actions.

Computed styles were read from visible navigation links, market labels, order tabs, inputs and margin controls. These measurements describe that page and state, not an undocumented claim about every Bybit breakpoint. The implementation preserves VOLTEX contract selection, permanent left search, supported controls, translations and financial behavior.

| Area | Observed Bybit reference | VOLTEX correction |
|---|---|---|
| Navigation | Inter, 14px, weight 400; 48px header | Inter, 14px/400, 48px desktop header; existing mobile navigation retained |
| Market labels | Inter, 12px/400 with a compact label/value rhythm | One font; 12px labels, 14px/500 values; no inherited 650/680 weights |
| Main price | Stronger focal emphasis than surrounding statistics | 22px/600, normal tracking and tabular numbers |
| Order tabs | Inter, 14px/500, 20px line height | Same typography, restrained active underline |
| Margin trigger | 12px/500, 18px line height, compact dark surface | Matching typography, 36px trigger, consistent chevron and states |
| Numeric inputs | 14px/500, 22px line height; dark contained fields | Same font/weight, contained price label, integrated price action and currency suffix |
| Order actions | Paired rounded Long/Short buttons in supplied screenshot | Equal-width actions, 14px/600, existing enabled/disabled and financial guards |
| Secondary controls | Restrained borders and predictable selection states | Unified margin modes, leverage presets, stepper, custom setting and focus styles |
| Workspace | Chart, book and trading rail read as one tool | Thin boundaries, aligned bands, preserved narrower book and quick-access list |

The main price retains 22px to fit VOLTEX's persistent sidebar and translated contract header. The trigger height and input layout are adapted to this composition. This is a measured adaptation, not a claim that every pixel of a different product or its private chart integration is identical.

## Font delivery

Inter is bundled locally with its [SIL Open Font License](../../../frontend/public/fonts/inter/OFL.txt). The font originates from [Google Fonts' Inter distribution](https://github.com/google/fonts/tree/main/ofl/inter), whose license attributes the Inter Project Authors. Latin and Cyrillic variable subsets cover the current English/Russian interface and ordinary Ukrainian characters; Latin/Cyrillic extended subsets cover additional characters. Other scripts retain system fallbacks.

The four WOFF2 files total 178,032 bytes. Unicode ranges prevent all subsets from being downloaded for ordinary Latin-only text. Font display uses swap, weights 400–700 come from the variable font, and the family is scoped as Inter Terminal to avoid a competing remote Inter declaration. The site's unrelated pages and approved VOLTEX wordmark are not restyled.

## TradingView integration

The site uses the hosted Advanced Chart embed, not the licensed Advanced Charts library. The [official hosted-widget configuration](https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart/) exposes background, grid, theme, legend and toolbar visibility. The implementation uses those supported fields: a restrained grid and the native instrument/OHLC legend on Futures. The legend restores useful chart context without inventing a parent timeframe label or market values.

The native toolbar, drawing tools, volume, attribution and logo remain intact. Futures keeps BYBIT perpetual symbol mappings; Spot and CFD keep their existing symbol mappings, backgrounds and legend behavior. The expanded palette tests assert this boundary.

The [Advanced Charts library constructor](https://www.tradingview.com/charting-library-docs/latest/configuration/Widget-Constructor/) has additional font/style customization. Those library capabilities must not be represented as available to the hosted embed. No unsupported font override, iframe scaling, clipping, hidden branding or cross-origin DOM alteration is used here.

## Full-tab review

The review includes global navigation, contract/market strip, asset search and signed changes, native chart and legend, book labels/rows, order tabs, margin and leverage menus, numeric inputs, size presets, reduce-only control, financial estimates, paired actions, account visibility/margin/balance groups, lower tabs and empty/error states, bottom tape and support access.

The desktop support control remains outside the account rail. Position headers remain visible for unknown or empty accounts, while unknown account values remain dashes. There are no fabricated balances or prices, new trading options, or financial submissions in visual QA. Public quote delays and unavailable private accounts in the read-only preview are reported honestly and are not masked to improve screenshots.

## Acceptance evidence

The `research-*.jpg` images show this implementation at measured viewport sizes; `bybit-current-reference.jpg` records the public reference. `research-leverage.jpg` includes the expanded custom control. `research-browser.json` records layout, font delivery, clipping and single-chart checks. Full-page captures exclude the browser scrollbar. All screenshot prices are supplied by the existing public feeds or the hosted chart; they are not fixtures.

The final seven-width pass records zero page overflow, zero clipped book values or signed changes, a single chart and equal-width order actions. Narrow desktop book columns allocate more room to quantity and totals; the font scales to 12px in the 228px book so numbers remain readable instead of ellipsized. At 390px the long funding label has its own row. Keyboard Enter opens and closes the native Indicators dialog; margin/leverage selection, custom controls, price entry and Limit/Market switching were also checked without submitting an order.

TypeScript/build and focused preservation results are recorded in the adjacent README. Eight earlier focused suites and two additional header suites identify existing baseline failures rather than suppressing assertions. This report assesses presentation and interaction preservation; it does not certify production account connectivity or guarantee a subjective numeric design score.
