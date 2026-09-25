import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * THE OWNER'S VISUAL-POLISH BRIEF FOR THE TRADING PANEL AND THE ORDER BOOK.
 *
 * VOLTEX_FUTURES_CLAUDE_REFERENCE_PACK (2026-09-22) asked for the reference
 * terminal's visual treatment of two areas, and was just as explicit about
 * what must NOT come with it. The browser half — screenshots at every width,
 * the order POST compared byte-for-byte with main's, clipping, overflow,
 * grouping, Стакан/Сделки, price click, idle request count — is
 * `scripts/qa-futures-visual-polish.cjs`. What is pinned HERE is the part a
 * later edit could quietly undo: the "do not copy" list, and the rule that
 * this was paint, not a redesign.
 */

const frontend = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(resolve(frontend, 'src', path), 'utf8').replace(/\r\n/g, '\n');
/** Comments explain the rules; they must not be able to satisfy them. */
const strip = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

const SHEET = read('pages/trade-terminal/ArchiveTerminalPreview.css');
const CSS = strip(SHEET);
const PAGE = strip(read('pages/FuturesPage.tsx'));
const TABS = strip(read('components/OrderFamilyPresentation.tsx'));

/** One declaration block for an exact selector, outside any media query. */
const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(CSS);
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1];
};
/** Every declaration block for an exact selector, joined — for a selector the sheet declares more than once. */
const everyRule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...CSS.matchAll(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`, 'g'))].map(m => m[1]).join(';');
};

describe('1. what the brief said NOT to copy', () => {
  it('keeps the current order types — no duplicated «Лимитный», nothing added or renamed', () => {
    // The archive terminal maps its four families to four labels; the
    // reference's Лимитный · Рыночный · Лимитный is not reproduced.
    expect(TABS).toContain("family === 'TAKE_PROFIT' ? 'Take Profit'");
    expect(TABS).toContain("family === 'LIMIT' ? t('futures.closeLimit')");
    expect(TABS).toContain("family === 'MARKET' ? t('futures.closeMarket')");
    expect(TABS).toContain("!archive || family !== 'OCO'");
  });

  it('keeps the Calculator as the ONLY control in the trading heading', () => {
    const heading = PAGE.slice(PAGE.indexOf('<div className="archive-trading-heading">'));
    const block = heading.slice(0, heading.indexOf('</div>'));
    expect(block.match(/<button/g)).toHaveLength(1);
    expect(block).toContain('data-open-calculator="true"');
    expect(block).toContain('<Calculator size={19} />');
  });

  it('brings no Bybit orange and no Bybit wording into the sheet', () => {
    // Read from the RULES, not the comments — the sheet's own comment says
    // "no Bybit orange", which is the point, not a violation of it.
    expect(CSS.toLowerCase()).not.toContain('#f7a600');
    expect(CSS).not.toMatch(/\bbybit\b/i);
    // VOLTEX's own gold is the accent everywhere this work touched.
    expect(rule('#archive-terminal-preview .order-family-tabs button.active')).toContain('color:var(--accent)');
  });
});

describe('2. the trading panel takes the reference hierarchy', () => {
  it('draws fields and selects as flat filled surfaces with no permanent frame', () => {
    // The fill is the raised token (2026-09-24, the lighter palette); the
    // shape — flat, no permanent frame — is what this test is about.
    const field = rule('#archive-terminal-preview :is(.fo-priceInputRow,.fo-qtyInputRow,.order-family-input)');
    expect(field).toContain('background:var(--panel-alt)');
    // Transparent, not removed: the control keeps its exact outer size.
    expect(field).toContain('border:1px solid transparent');
    expect(field).toContain('border-radius:5px');
    const select = rule('#archive-terminal-preview .fo-mlTrigger');
    expect(select).toContain('background:var(--panel-alt)');
    expect(select).toContain('border:1px solid transparent');
  });

  it('still lights the frame on focus, so the keyboard affordance survives', () => {
    expect(rule('#archive-terminal-preview :is(.fo-priceInputRow,.fo-qtyInputRow,.order-family-input):focus-within'))
      .toContain('border-color:var(--accent)');
  });

  it('marks the active order type by colour, weight and a gold underline', () => {
    // The reference marked it by colour and weight alone; on 2026-09-24 the
    // owner asked for the chosen type to stand out more, so it also carries a
    // 2px underline in the same gold. Colour and weight are unchanged.
    const active = rule('#archive-terminal-preview .order-family-tabs button.active');
    expect(active).toContain('font-weight:700');
    expect(active).toContain('border-bottom-color:var(--accent)');
    expect(rule('#archive-terminal-preview .order-family-tabs button')).toContain('border-bottom:2px solid transparent');
  });

  it('gives the size slider a SOLID thumb and keeps all five preset buttons', () => {
    expect(rule('#archive-terminal-preview .percent-slider-track input::-webkit-slider-thumb')).toContain('background:var(--accent)');
    expect(rule('#archive-terminal-preview .percent-slider-track input::-moz-range-thumb')).toContain('background:var(--accent)');
    // The presets are buttons that set the size, so they are restyled, not removed.
    expect(read('components/PercentSlider.tsx')).toContain('presets.map(pct => <button');
  });

  it('turns the order-figures card into a section separated by a hairline', () => {
    const info = rule('#archive-terminal-preview .fo-infoBox');
    expect(info).toContain('border:0');
    expect(info).toContain('border-top:1px solid var(--border)');
  });
});

/**
 * 2026-09-24: the owner put this panel beside a Bybit screenshot (2000px
 * wide) and asked for that book 1:1 — "більш насичений", with the figures
 * moving more slowly. The numbers below are read off that image: a 26px bar
 * in a 28px row, 13px white figures with only the price coloured, ask bars
 * at about .30 and bid bars at about .18 over the panel, no rule lines
 * around a 48px centre band, the arrow leading the last price and the mark
 * price under a flag. The .12–.20 bars this section used to pin came from
 * the earlier Binance recording and are superseded by that request.
 */
describe('3. the order book takes the reference treatment, and only its paint', () => {
  const alpha = (selector: string) => Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(rule(selector))![1]);

  it('draws depth bars at the reference weight: asks about .30, bids about .18', () => {
    expect(alpha('#archive-terminal-preview .rb-row.ask .rb-depth')).toBeGreaterThanOrEqual(0.26);
    expect(alpha('#archive-terminal-preview .rb-row.ask .rb-depth')).toBeLessThanOrEqual(0.34);
    expect(alpha('#archive-terminal-preview .rb-row.bid .rb-depth')).toBeGreaterThanOrEqual(0.15);
    expect(alpha('#archive-terminal-preview .rb-row.bid .rb-depth')).toBeLessThanOrEqual(0.22);
    // Separate bars, not one block: a 1px gap above and below each bar.
    expect(rule('#archive-terminal-preview .rb-row .rb-depth')).toContain('inset:1px 0');
  });

  it('leads each row with its price, in the side colour, and the other two figures in white', () => {
    expect(rule('#archive-terminal-preview .rb-row.ask > span:first-of-type')).toContain('font-weight:500');
    expect(rule('#archive-terminal-preview .rb-row.bid > span:first-of-type')).toContain('font-weight:500');
    const row = rule('#archive-terminal-preview .rb-row');
    expect(row).toContain('font-size:13px');
    expect(row).toMatch(/color:#f[0-9a-f]{5}/);
  });

  it('draws the centre band without rule lines, the mark price under a flag in the accent', () => {
    const center = rule('#archive-terminal-preview .rb-center');
    expect(center).toContain('border-top:0');
    expect(center).toContain('border-bottom:0');
    expect(center).toContain('min-height:var(--book-center-height)');
    // The mark price was drawn in the accent like the reference; on
    // 2026-09-24 the owner found the centre row noisy and asked for the mark
    // to be smaller and calmer, so it is the tertiary grey at 12px.
    const mark = rule('#archive-terminal-preview .rb-mark');
    expect(mark).toContain('color:var(--text-tertiary)');
    expect(mark).toContain('font-size:12px');
    const book = strip(read('components/FuturesReferenceBook.tsx'));
    expect(book.indexOf('className="rb-arrow"')).toBeLessThan(book.indexOf('className="rb-last"'));
  });

  it('sizes the header last price to the reference proportion, below the pair name', () => {
    // Owner, 2026-09-24: the 17px price looked «чуть великий» beside Bybit's.
    // 15px sits under the 16px pair name, as Bybit's price sits under its symbol.
    expect(rule('#archive-terminal-preview .ticker-bar .value.price')).toContain('font-size:15px');
    expect(rule('#archive-terminal-preview .ticker-bar .pair-name')).toContain('font-size:16px');
  });

  it('keeps the pitch the depth window is computed from in one place, per design', () => {
    // Row count = panel height ÷ the pitch, and the CSS reads the same
    // number back through --book-row-height. The other designs keep the
    // 20px the owner chose earlier; the archive terminal takes the
    // reference's 28px and 48px band, passed in by the page.
    const lib = read('lib/referenceBook.ts');
    expect(lib).toContain('export const REFERENCE_ROW_HEIGHT = 20;');
    expect(lib).toContain('export const ARCHIVE_ROW_HEIGHT = 28;');
    expect(lib).toContain('export const ARCHIVE_CENTER_HEIGHT = 48;');
    const book = strip(read('components/FuturesReferenceBook.tsx'));
    expect(book).toContain('const rowHeight = archive ? ARCHIVE_ROW_HEIGHT : REFERENCE_ROW_HEIGHT;');
    expect(book).toContain('const centerHeight = archive ? ARCHIVE_CENTER_HEIGHT : REFERENCE_CENTER_HEIGHT;');
    expect(PAGE).toContain('archive={archivePreview}');
    expect(PAGE).toContain('markPrice={archivePreview ? reference.get(symbol)?.markPrice ?? null : undefined}');
  });

  it('holds the archive book to one repaint a second, and only the archive book', () => {
    expect(read('lib/referenceBook.ts')).toContain('export const ARCHIVE_BOOK_HOLD_MS = 1000;');
    const book = strip(read('components/FuturesReferenceBook.tsx'));
    expect(book).toContain('const holdMs = archive ? ARCHIVE_BOOK_HOLD_MS : 0;');
    // The hold is the frame the feed published, not a smoothing of it.
    expect(book).toContain('useHeldFrame(');
    expect(book).not.toMatch(/transition/);
  });
});

describe('4. this is polish, not a redesign — and not a mobile redesign', () => {
  it('keeps every geometry change inside the desktop media query', () => {
    const desktop = /@media \(min-width:901px\) \{([\s\S]*?)\n\}/.exec(CSS);
    expect(desktop).not.toBeNull();
    for (const moved of ['.fo-form > .fo-mlWrap', '.order-family-tabs { margin-top:50px', '.fo-panel { padding:14px 14px 18px']) {
      expect(desktop![1]).toContain(moved);
    }
    // Outside it, the panel keeps main's own padding and form rhythm.
    expect(rule('#archive-terminal-preview .fo-panel')).toContain('padding:10px 14px 14px');
    expect(rule('#archive-terminal-preview .fo-form')).toContain('gap:14px; padding:12px 0 0');
  });

  it('compacts the unified account card only where the support tab is docked', () => {
    // 2026-09-24, owner: the card should take less height. Below 1025px the
    // support launcher floats over the column, so the shared 48px foot that
    // keeps Deposit/Transfer clear of it must stay there.
    const docked = /@media \(min-width:1025px\) \{([\s\S]*?)\n\}/.exec(CSS);
    expect(docked).not.toBeNull();
    expect(docked![1]).toContain('.futures-account-summary { padding:12px 14px 14px !important; gap:10px !important; }');
    expect(docked![1]).toContain('.futures-account-actions button { height:32px; min-height:32px; }');
    expect(CSS.replace(docked![0], '')).not.toMatch(/\.futures-account-summary \{[^}]*padding/);
  });

  it('leaves the shared heading band at one height beside the chart', () => {
    // Стакан/Сделки share this band with the chart's own tabs; changing the
    // book's alone would put two different header heights side by side.
    expect(CSS).toContain('#archive-terminal-preview :is(.terminal-chart-heading,.rb-tabs,.bottom-tabs,.terminal-account-header) { background:var(--panel); border-color:var(--border); height:40px;');
  });
});

describe('5. text contrast at the reference level', () => {
  it('draws figures and headings in white, and leaves the captions grey', () => {
    // Owner, 2026-09-24: «шрифт більш контрастний, всюди, де це є у байбіта».
    expect(everyRule('#archive-terminal-preview')).toContain('--text-primary:#ffffff');
    expect(rule('#archive-terminal-preview :is(.reference-order-heading,.fcd-title)')).toContain('color:var(--text-primary)');
    expect(rule('#archive-terminal-preview .rb-row > span:not(:first-of-type)')).toContain('color:var(--text-primary)');
    expect(CSS).not.toMatch(/#archive-terminal-preview \{[^}]*--archive-label:#fff/);
  });

  it('gives units their figure\'s colour and size (the margin\'s «USDT» excepted, § 6), and LONG / SHORT the reference colours at full strength', () => {
    const units = CSS.match(/#archive-terminal-preview :is\(\.futures-position-unit,\.futures-account-stat \.fa-unit,\.fcd-unit\) \{([^}]*)\}/);
    expect(units).not.toBeNull();
    expect(units![1]).toContain('color:inherit');
    expect(units![1]).toContain('font-size:inherit');
    // The later rule wins: the last .buy / .sell / :disabled declarations in the sheet.
    const last = (selector: string) => {
      const all = [...CSS.matchAll(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`, 'g'))];
      return all[all.length - 1][1];
    };
    expect(last('#archive-terminal-preview .fo-submitPair .buy')).toContain('background:#1ace88');
    expect(last('#archive-terminal-preview .fo-submitPair .sell')).toContain('background:#f55065');
    expect(last('#archive-terminal-preview .fo-submitPair button:disabled')).toContain('opacity:1');
    expect(last('#archive-terminal-preview .fo-submitPair button')).toContain('height:48px');
  });

  it('brightens the terminal chart axis to the reference tone', () => {
    const chart = read('components/PriceChart.tsx');
    // The terminal tone is the fallback; a terminal's sheet may restate it
    // as a token (§ 8: the Futures terminal draws its axis white).
    expect(chart).toContain("textColor: token('--voltex-axis-text', terminal ? '#f3f4f6' : '#a3adba')");
  });
});

describe('6. the bottom panel as on the reference: darker, seamless, quiet captions', () => {
  // Owner, 2026-09-24: «чуть чорнішою… як у байбіт», «безшовну», «і ці
  // перегородки у байбіт не видні», «usdt сірим в точності як у байбіт».
  // Approved on the live preview before it came to the exchange.
  it('paints the whole panel one darker surface, with the panels\' hairline above it', () => {
    const panel = rule('#archive-terminal-preview .bottom-panel');
    expect(panel).toContain('--panel:#101014');
    // 2026-09-25, beside a Bybit screenshot: «зроби більш видими перегородку
    // цієї панелі, не прям яскраво, просто чуть замітна» — the near-black
    // seam had vanished into the gradient; the panel now sits under the
    // same hairline as every other panel (§ 8 pins its strength).
    expect(panel).toContain('border-top:1px solid var(--border)');
    expect(panel).not.toContain('#08090c');
    // The dialogs the rows open float over the whole terminal and keep its surface.
    expect(everyRule('#archive-terminal-preview')).toContain('--terminal-panel:var(--panel)');
    expect(rule('#archive-terminal-preview .bottom-panel dialog')).toContain('--panel:var(--terminal-panel)');
    expect(rule('#archive-terminal-preview .futures-position-row:hover td')).toContain('--pos-cell-bg:#1a1b21');
  });

  it('draws no line inside it: not under the tabs, not between rows, not beside «Закрыть как»', () => {
    expect(rule('#archive-terminal-preview .bottom-panel .terminal-account-header')).toContain('border-bottom-color:transparent');
    // The 1px stays, transparent, so the 64px row does not move.
    expect(CSS).toContain('#archive-terminal-preview .futures-positions-table tbody td { border-top:1px solid transparent !important; }');
    expect(CSS).not.toContain('border-top:1px solid var(--panel-alt) !important');
    expect(CSS).not.toMatch(/\[data-hidden-end=true\] \.futures-positions-table :is\(th,td\):last-child \{[^}]*box-shadow/);
    // The figures still fade out under the pinned column.
    expect(CSS).toMatch(/\[data-hidden-end=true\] \.futures-positions-table :is\(th,td\):last-child::before \{[^}]*linear-gradient/);
  });

  it('keeps tab titles and headings the reference grey, «Все рынки» bright', () => {
    expect(rule('#archive-terminal-preview .bottom-tabs .bottom-tab')).toContain('color:#71757a');
    expect(rule('#archive-terminal-preview .bottom-tabs .bottom-tab.active')).toContain('color:#fff');
    expect(rule('#archive-terminal-preview .futures-positions-table th')).toContain('color:#71757a !important');
    expect(rule('#archive-terminal-preview .archive-pair-filter')).toContain('color:#eaecef');
  });

  it('draws the margin\'s «USDT» grey and smaller, the quantity\'s and P&L\'s units in their figure\'s colour', () => {
    const quote = rule('#archive-terminal-preview .futures-positions-table td:not(.text-buy):not(.text-sell) .futures-position-unit');
    expect(quote).toContain('color:#71757a');
    expect(quote).toContain('font-size:.85em');
    expect(quote).toContain('font-weight:400');
    // The quantity cell is the one carrying the side colour — that is what the selector leaves out.
    expect(read('components/FuturesPositionsPanel.tsx')).toContain("className={`mono ${p.side === 'LONG' ? 'text-buy' : 'text-sell'}`}");
    // The later of the sheet's two ::after rules is the one that wins.
    expect(everyRule('#archive-terminal-preview .futures-positions-table :is(.futures-position-money,.futures-position-realized)[data-unit]::after').split(';').filter(d => /color:/.test(d)).pop()).toContain('color:inherit');
  });
});

describe('7. the order ticket prints figures by the terminal\'s rules; TP/SL never under the pinned column', () => {
  // Owner, 2026-09-25: «7007265.22 без розділювачів, поруч 797,810.19 —
  // роби, як по правилам правильно», and the «+ Добавить» pill cut by the
  // pinned «Закрыть как».
  const FORM = strip(read('components/FuturesOrderForm.tsx'));
  const PANEL = strip(read('components/FuturesPositionsPanel.tsx'));
  const infoBox = FORM.slice(FORM.indexOf('<div className="fo-infoBox">'), FORM.indexOf("{t('futures.maxPosition')}") + 400);

  it('groups money to cents and prints prices at their precision, in every info row', () => {
    expect(FORM).toContain("import { formatAmount, formatPrice } from '../lib/formatNumber';");
    expect(infoBox).toContain('formatAmount(maxPositionNotional)');
    expect(infoBox).toContain('formatAmount(notional)');
    expect(infoBox).toContain('formatAmount(requiredMargin)');
    expect(infoBox).toContain('formatPrice(liqPreviewLong)');
    expect(infoBox).toContain('formatPrice(liqPreviewShort)');
    expect(infoBox).toContain('formatAmount(orderCosting.feeReserve, 4)');
    // No figure in the box is spelled raw any more.
    expect(infoBox).not.toMatch(/\.toFixed\(/);
  });

  it('spells the figures the way the account panel beside them does', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { formatAmount, formatPrice } = require('../formatNumber');
    expect(formatAmount(7007265.22)).toBe('7,007,265.22');
    expect(formatAmount(797810.19)).toBe('797,810.19');
    expect(formatAmount(0.12344, 4)).toBe('0.1234');
    expect(formatPrice(70118.2)).toBe('70,118.20');
    expect(formatPrice(0.046193)).toBe('0.046193');
  });

  it('merges TP/SL into the pinned column whenever the wide row does not fit — measured, not a fixed breakpoint', () => {
    expect(PANEL).not.toContain('NARROW_ACTIONS_PX');
    expect(PANEL).toContain('if (!layout.narrow) layout.wide = region.scrollWidth;');
    expect(PANEL).toContain('const compact = archive && region.clientWidth >= 901 && region.clientWidth < layout.wide - 1;');
    expect(PANEL).toContain("if (tab === 'open') setNarrow(previous => previous === compact ? previous : compact);");
  });
});

describe('8. the TradingView surface (owner, 2026-09-25)', () => {
  // «Зроби нашу біржу у такому фоні», then «вверх чуть темнішим», «поля
  // видими», «синій колір ні — обєм залишаємо як і зараз».
  const CHART = read('components/PriceChart.tsx');

  it('runs one vertical gradient behind the terminal, darker at the top, into the bottom panel\'s own surface', () => {
    const surface = everyRule('#archive-terminal-preview');
    expect(surface).toContain('background: linear-gradient(180deg, #1f2229 0%, #1b1d24 22%, #15161b 50%, #101014 74%, #08080a 100%) !important');
    expect(CSS).toMatch(/:is\(\.terminal, \.ticker-bar, \.chart-area, \.terminal-chart-shell[^)]*\.fo-panel[^)]*\) \{\s*background: transparent !important;/);
    // The shared navigation has the owner's approved solid graphite surface.
    expect(everyRule('#archive-terminal-preview .global-header')).toContain('background:var(--h-bg-1)');
    // The bottom panel keeps its approved flat surface (§ 6).
    expect(rule('#archive-terminal-preview .bottom-panel')).toContain('--panel:#101014');
  });

  it('mutes the header captions and draws the funding line in one orange', () => {
    // «зроби в нас на біржі цей текст таким же приглушеним, а 0.0100% /
    // 03:06:32 (8h) таким же кольором» (Bybit screenshot). The chart's own
    // orange, so § 1's «no Bybit orange» still holds.
    // The later of the sheet's caption rules is the one that wins.
    const captions = everyRule('#archive-terminal-preview .ticker-bar .label').split(';').map(d => d.trim());
    expect(captions.filter(d => d.startsWith('color:')).pop()).toBe('color:#71757a');
    expect(captions.filter(d => d.startsWith('font-weight:')).pop()).toBe('font-weight:400');
    const funding = rule('#archive-terminal-preview .ticker-bar .futures-funding-values > :is(.value,.label)');
    expect(funding).toContain('color:#ff9800 !important');
    expect(funding).toContain('font-size:13px');
    // Rate, slash and countdown are the three children that rule reaches.
    const bar = read('components/FuturesTickerBar.tsx');
    expect(bar).toContain('<span className="label"> / </span>');
    expect(bar).toContain('<NextFundingCountdown intervalHours={fundingIntervalHours} />');
  });

  it('draws the lines between the panels just visibly, as on Bybit', () => {
    // «зроби більш видими перегородку цієї панелі, не прям яскраво, просто
    // чуть замітна»: a white hairline at .12 — .07 vanished into the
    // gradient, and anything past ~.15 starts to read as a frame.
    const surface = everyRule('#archive-terminal-preview');
    expect(surface).toContain('--border: rgba(255,255,255,.12)');
    expect(surface).not.toContain('--border: rgba(255,255,255,.07)');
    for (const panel of ['.orderbook-area', '.order-form-area']) {
      expect(rule(`#archive-terminal-preview ${panel}`)).toContain('border-left:1px solid var(--border)');
    }
  });

  it('lets the chart show the gradient, with clean white / orange candles and a white axis', () => {
    const shell = everyRule('#archive-terminal-preview .terminal-chart-shell');
    expect(shell).toContain('--voltex-plot-background: rgba(0,0,0,0)');
    expect(shell).toContain('--voltex-candle-up: #ffffff');
    expect(shell).toContain('--voltex-candle-down: #ff9800');
    expect(shell).toContain('--voltex-axis-text: #ffffff');
    // The chart reads them, with every other chart's values as fallbacks.
    expect(CHART).toContain("const candleUp = token('--voltex-candle-up', '#eaecef');");
    expect(CHART).toContain("const candleDown = token('--voltex-candle-down', '#f7a600');");
    expect(CHART).toContain("borderColor: token('--voltex-axis-border', '#292c34')");
  });

  it('keeps the volume bars the exchange\'s own colours — no blue', () => {
    expect(CHART).toContain("color: c.close >= c.open ? 'rgba(234,236,239,0.5)' : 'rgba(247,166,0,0.5)',");
    expect(CHART.toLowerCase()).not.toContain('#2962ff');
  });

  it('outlines the ticket\'s fields so they read on any part of the gradient, gold while typing', () => {
    expect(CSS).toMatch(/:is\(\.fo-mlTrigger, \.fo-priceInputRow, \.fo-qtyInputRow[^)]*\) \{\s*background: rgba\(255,255,255,\.06\) !important; border: 1px solid rgba\(255,255,255,\.13\) !important;/);
    expect(CSS).toMatch(/:is\(\.fo-priceInputRow, \.fo-qtyInputRow, \.order-family-input\):focus-within,[\s\S]{0,200}\{\s*border-color: var\(--accent\) !important;/);
  });

  it('sets the row\'s ticker, margin line and ROI at the figures\' 13px, as the reference does', () => {
    expect(rule('#archive-terminal-preview .futures-position-ticker b')).toContain('font-size:13px');
    expect(everyRule('#archive-terminal-preview .futures-position-contract small')).toContain('font-size:13px');
    expect(rule('#archive-terminal-preview .futures-position-roi')).toContain('font-size:13px');
  });
});
