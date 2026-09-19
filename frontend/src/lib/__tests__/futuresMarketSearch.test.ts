import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The Futures market search.
 *
 * The behaviour — instant open, local filtering, Escape, outside click,
 * rapid toggling, no layout shift — is proven in a real browser by
 * `scripts/qa-futures-market-search.cjs`, which counts every API request the
 * page makes and compares the search window against an idle one. What is
 * pinned HERE is the structure that makes those properties possible, so a
 * later edit cannot quietly reintroduce what was removed.
 *
 * This file previously pinned an earlier shape of the same feature: search
 * as a magnifier in a fixed-height «Рынки» header above the rail. That row
 * is gone — the owner asked for the rail to start at the favourites filter
 * and for search to be a temporary chooser hanging under the BTC/USDT
 * selector instead — so the eight assertions describing the header control
 * were REPLACED, not deleted, by the eight below that describe the chooser.
 * Everything those assertions were protecting (no request on open, focus in
 * the mounting commit, local filtering, one shared handler, the rail's own
 * sorting/favourites/windowing) is still pinned.
 */

const root = resolve(__dirname, '../../../..');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8').replace(/\r\n/g, '\n');
const list = read('frontend/src/components/FuturesPairList.tsx');
const bar = read('frontend/src/components/FuturesTickerBar.tsx');
const page = read('frontend/src/pages/FuturesPage.tsx');
const css = read('frontend/src/components/FuturesPairList.css');
const studio = read('frontend/src/pages/trade-terminal/FuturesStudio.css');
/** Comments explain the rules; they must not be able to satisfy them. */
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
const code = strip(list);
const pageCode = strip(page);

describe('the rail carries no search row at all', () => {
  it('renders neither the old full-width field nor the header that replaced it', () => {
    expect(code).not.toContain('className="pairs-search"');
    expect(code).not.toContain('pairs-head');
    // The Spot sidebar keeps its own; this is about the Futures rail only.
    expect(read('frontend/src/components/PairListSidebar.tsx')).toContain('searchPairPlaceholder');
  });

  it('leaves nothing behind that could hold the height open', () => {
    // No open/closed state means no row to collapse, no spacer to forget
    // and no hidden input still occupying a line.
    expect(code).not.toMatch(/searchOpen/);
    expect(css).not.toContain('.pairs-head');
    expect(css).not.toContain('pairs-head-reveal');
    expect(code).not.toMatch(/visibility:\s*hidden|display:\s*none/);
  });

  it('starts the rail at the favourites row, and the page passes no field to it', () => {
    // The first thing the list renders after the optional field is the
    // favourites/count row.
    const body = code.slice(code.indexOf('return ('));
    expect(body.indexOf('className="pairs-tabs"')).toBeGreaterThan(-1);
    // The rail's own instance is rendered WITHOUT `searchable`.
    const rail = pageCode.slice(pageCode.indexOf('reference-market-sidebar'), pageCode.indexOf('futures-market-chooser'));
    expect(rail).toContain('<FuturesPairList symbols={symbols}');
    expect(rail).not.toContain('searchable');
  });

  it('gates the field behind the prop, so only a chooser can show one', () => {
    expect(code).toContain('searchable = false');
    expect(code).toContain('{searchable && (');
    expect(code).toContain('className="market-chooser-input"');
  });
});

describe('opening search cannot reach the network, or wait for anything', () => {
  it('is a state flip, with no request, timer or frame in the path', () => {
    const open = pageCode.slice(pageCode.indexOf('const openMarkets'), pageCode.indexOf('useEffect(() => { if (!desktopMarkets)'));
    expect(open).toContain('setChooserOpen(open => !open)');
    expect(open).not.toMatch(/await|fetch|api\.|setTimeout|requestAnimationFrame|Promise/);
  });

  it('focuses in the commit that mounts the field, not a frame later', () => {
    expect(code).toContain('autoFocus');
    expect(code).not.toMatch(/requestAnimationFrame\(\s*\(\)\s*=>\s*searchRef/);
  });

  it('filters the rows already in memory, with no debounce and no refetch', () => {
    // A plain predicate over the symbols prop inside the same memo that
    // builds the rows — no effect, no timer, no request. Case and slash are
    // normalised on both sides, so btc / BTC / BTCUSDT / BTC/USDT all hit.
    expect(code).toContain(".filter((s) => s.toLowerCase().replace('/', '').includes(search");
    expect(code).toContain(".trim().toLowerCase().replace('/', '')");
    expect(code).not.toMatch(/debounce|setTimeout\(\s*\(\)\s*=>\s*setSearch/);
    // The universe is fetched by the page, never by a keystroke.
    const memo = code.slice(code.indexOf('const rows: Row[] = useMemo'), code.indexOf('const windowed ='));
    expect(memo).not.toMatch(/api\.|fetch/);
  });
});

describe('two ways in, one handler, one piece of state', () => {
  it('the ticker bar keeps its pair caret and its list button', () => {
    expect(bar).toContain('className="pair-selector"');
    expect(bar).toContain('className="pair-arrow"');
    expect(bar).toContain('className="pair-markets-btn"');
    expect(bar).toContain('<ListIcon size={16} />');
  });

  it('routes both of them through the same prop, with no second code path', () => {
    const button = bar.slice(bar.indexOf('className="pair-markets-btn"'), bar.indexOf('className="pair-selector"'));
    expect(button).toContain('onClick={onSelectSymbol}');
    const selector = bar.slice(bar.indexOf('className="pair-selector"'), bar.indexOf('<CryptoIcon'));
    expect(selector).toContain('onClick={onSelectSymbol}');
    // Exactly one handler is wired in from the page.
    expect(page).toContain('onSelectSymbol={openMarkets}');
    expect(page.match(/onSelectSymbol=\{/g)).toHaveLength(1);
  });

  it('marks both as entry points so the outside click cannot swallow a press', () => {
    // Without this the outside handler closed the chooser on pointerdown
    // and the button's own click re-opened it, so the control that opened
    // it could never close it.
    expect(bar.match(/data-market-entry/g)!.length).toBeGreaterThanOrEqual(2);
    expect(pageCode).toContain("target?.closest?.('[data-market-entry]')");
  });

  it('reports its state to both controls', () => {
    expect(bar).toContain('aria-expanded={marketsOpen}');
    expect(page).toContain('marketsOpen={chooserOpen}');
  });
});

describe('the chooser is a temporary layer, not another rail', () => {
  it('overlays the rail cell instead of taking part in the flow', () => {
    const rule = css.slice(css.indexOf('.trade-terminal .futures-market-chooser {'));
    const block = rule.slice(0, rule.indexOf('}'));
    // Two grid items in one cell overlap; they do not displace each other.
    expect(block).toMatch(/grid-column:\s*1/);
    expect(block).toMatch(/grid-row:\s*2 \/ 4/);
    expect(block).toMatch(/z-index:\s*\d+/);
    expect(block).toMatch(/align-self:\s*start/);
    // Bounded, so it cannot grow into a full-height second sidebar — and
    // bounded by an explicit height rather than only a maximum, because a
    // shrink-wrapping flex column gave the rows inside it zero height.
    expect(block).toMatch(/\bheight:\s*min\(/);
  });

  it('holds the field above the same list, not a copy of it', () => {
    const chooser = pageCode.slice(pageCode.indexOf('futures-market-chooser'), pageCode.indexOf('<div className="chart-area"'));
    expect(chooser).toContain('<FuturesPairList');
    expect(chooser).toContain('searchable');
    // Picking a contract selects it and dismisses the layer.
    expect(chooser).toContain('onChange={next => { setSymbol(next); setChooserOpen(false); }}');
  });

  it('closes on Escape and on a click outside, from one effect', () => {
    const effect = pageCode.slice(pageCode.indexOf('if (!chooserOpen) return;'), pageCode.indexOf('}, [chooserOpen]);'));
    expect(effect).toContain("event.key === 'Escape'");
    expect(effect).toContain('setChooserOpen(false)');
    expect(effect).toContain("document.addEventListener('pointerdown'");
    expect(effect).toContain('chooserRef.current?.contains');
    // Attached from an effect, so the click that opened it has already been
    // dispatched and cannot close what it just opened.
    expect(effect).toContain("document.removeEventListener('pointerdown'");
  });

  it('cannot leave a desktop layer over a mobile layout', () => {
    expect(pageCode).toContain('useEffect(() => { if (!desktopMarkets) setChooserOpen(false); }, [desktopMarkets]);');
    // Mobile keeps the existing dialog, with the field focused on open.
    expect(pageCode).toContain('marketDialogRef.current?.showModal()');
    expect(pageCode).toContain('pairListRef.current?.focusSearch()');
  });
});

describe('Escape in the field asks the container to close, exactly once', () => {
  it('prevents the default so a mobile <dialog> cannot close behind our back', () => {
    const handler = code.slice(code.indexOf('onKeyDown={(e) => {'), code.indexOf("placeholder={t('trade.searchPair')}"));
    expect(handler).toContain("e.key !== 'Escape'");
    expect(handler).toContain('e.preventDefault()');
    expect(handler).toContain('e.stopPropagation()');
    expect(handler).toContain('onDismiss?.()');
    // The query is dropped with it, so reopening starts clean.
    expect(handler).toContain("setSearch('')");
  });
});

describe('the instrument row starts at the far-left edge', () => {
  it('spans the rail column, and the rail begins under it', () => {
    const grid = studio.slice(studio.indexOf('@media(min-width:1025px)'));
    expect(grid).toMatch(/\.ticker-bar \{ grid-column:1 \/ 4; grid-row:1;/);
    expect(grid).toMatch(/\.reference-market-sidebar \{ grid-column:1; grid-row:2 \/ 4; \}/);
    // The order book and the order ticket keep the columns they had.
    expect(grid).toMatch(/\.order-form-area \{ grid-row:1 \/ 4; \}/);
  });
});

describe('everything the rail already did still works', () => {
  it('keeps both sortable columns wired to the existing sort', () => {
    expect(code).toContain("onClick={() => toggleSort('price')}");
    expect(code).toContain("onClick={() => toggleSort('change')}");
    expect(code).toContain("t('trade.price')");
    expect(code).toContain("t('markets.change24h')");
    // The sort itself was not rewritten: still descending → ascending → default.
    expect(code).toContain("setSort(current => current?.field !== field ? { field, dir: -1 }");
  });

  it('keeps favourites, the count and row selection', () => {
    expect(code).toContain('setFavoritesOnly((v) => !v)');
    expect(code).toContain('className="pairs-count"');
    expect(code).toContain('onClick={() => onChange(r.symbol)}');
  });

  it('does not touch the windowing that keeps hundreds of rows cheap', () => {
    expect(code).toContain('useWindowedRows(rows.length)');
    expect(code).toContain('windowed.padTop');
  });
});
