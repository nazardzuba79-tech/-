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
    const field = rule('#archive-terminal-preview :is(.fo-priceInputRow,.fo-qtyInputRow,.order-family-input)');
    expect(field).toContain('background:#1e2126');
    // Transparent, not removed: the control keeps its exact outer size.
    expect(field).toContain('border:1px solid transparent');
    expect(field).toContain('border-radius:5px');
    const select = rule('#archive-terminal-preview .fo-mlTrigger');
    expect(select).toContain('background:#1e2126');
    expect(select).toContain('border:1px solid transparent');
  });

  it('still lights the frame on focus, so the keyboard affordance survives', () => {
    expect(rule('#archive-terminal-preview :is(.fo-priceInputRow,.fo-qtyInputRow,.order-family-input):focus-within'))
      .toContain('border-color:var(--accent)');
  });

  it('marks the active order type by colour and weight, with no underline', () => {
    const active = rule('#archive-terminal-preview .order-family-tabs button.active');
    expect(active).toContain('font-weight:700');
    expect(active).toContain('border-bottom-color:transparent');
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

  it('leaves the shared heading band at one height beside the chart', () => {
    // Стакан/Сделки share this band with the chart's own tabs; changing the
    // book's alone would put two different header heights side by side.
    expect(CSS).toContain('#archive-terminal-preview :is(.terminal-chart-heading,.rb-tabs,.bottom-tabs,.terminal-account-header) { background:var(--panel); border-color:var(--border); height:40px;');
  });
});
