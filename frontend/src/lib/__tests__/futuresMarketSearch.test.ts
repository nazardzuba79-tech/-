import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The Futures market rail's search.
 *
 * The behaviour — instant open, local filtering, Escape, rapid toggling, no
 * layout shift — is proven in a real browser by
 * `scripts/qa-futures-market-search.cjs`, which counts every API request the
 * page makes and compares the search window against an idle one. What is
 * pinned HERE is the structure that makes those properties possible, so a
 * later edit cannot quietly reintroduce the thing that was removed.
 */

const root = resolve(__dirname, '../../../..');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8').replace(/\r\n/g, '\n');
const list = read('frontend/src/components/FuturesPairList.tsx');
const bar = read('frontend/src/components/FuturesTickerBar.tsx');
const css = read('frontend/src/components/FuturesPairList.css');
/** Comments explain the rules; they must not be able to satisfy them. */
const code = list.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('the permanent search field is gone', () => {
  it('no longer renders the full-width input above the list', () => {
    expect(code).not.toContain('className="pairs-search"');
    // The Spot sidebar keeps its own; this is about the Futures rail only.
    expect(read('frontend/src/components/PairListSidebar.tsx')).toContain('searchPairPlaceholder');
  });

  it('shows «Рынки» with a magnifier instead, in one fixed-height row', () => {
    expect(code).toContain("className={`pairs-head${searchOpen ? ' searching' : ''}`}");
    expect(code).toContain("className=\"pairs-head-title\"");
    expect(code).toContain('className="pairs-head-search"');
    expect(code).toContain("t('nav.markets')");
    // A fixed height on the row is what keeps the list from moving when the
    // field replaces the title.
    const rule = css.slice(css.indexOf('.trade-terminal .pairs-head {'));
    expect(rule.slice(0, rule.indexOf('}'))).toMatch(/height:\s*34px/);
  });

  it('keeps the button a control, not a chip: no background until hover', () => {
    const rest = css.slice(css.indexOf('.trade-terminal .pairs-head-search {'));
    expect(rest.slice(0, rest.indexOf('}'))).toMatch(/background:\s*transparent/);
    expect(css).toContain('.trade-terminal .pairs-head-search:hover');
  });
});

describe('opening search cannot reach the network', () => {
  it('is a state flip and a focus, with no request in the path', () => {
    const open = code.slice(code.indexOf('const openSearch'), code.indexOf('const closeSearch'));
    expect(open).toContain('setSearchOpen(true)');
    expect(open).toContain('searchRef.current?.focus()');
    // Nothing that could block or fetch.
    expect(open).not.toMatch(/await|fetch|api\.|setTimeout|Promise/);
  });

  it('focuses on mount rather than a frame later', () => {
    // A requestAnimationFrame here cost a frame of dead input and made the
    // button read as unresponsive on a slower machine.
    expect(code).toContain('autoFocus');
    expect(code).not.toContain('requestAnimationFrame(() => searchRef');
  });

  it('filters the rows already in memory, with no debounce', () => {
    // The filter is a plain predicate over the symbols prop inside the same
    // memo that builds the rows — no effect, no timer, no request.
    expect(code).toContain('.filter((s) => s.toLowerCase().replace(\'/\', \'\').includes(search');
    expect(code).not.toMatch(/debounce|setTimeout\(\s*\(\)\s*=>\s*setSearch/);
  });

  it('keeps any animation visual and short', () => {
    const match = /animation:\s*pairs-head-reveal\s+(\d+)ms/.exec(css);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeLessThanOrEqual(150);
    // Opacity only — nothing that could reflow the panel while it plays.
    const frames = css.slice(css.indexOf('@keyframes pairs-head-reveal'));
    expect(frames.slice(0, frames.indexOf('}') + 2)).not.toMatch(/width|height|transform/);
  });
});

describe('Escape closes the field, and only the field', () => {
  it('prevents the default so a mobile <dialog> does not close with it', () => {
    const handler = code.slice(code.indexOf('onKeyDown={(e) => {'), code.indexOf('placeholder={t(\'trade.searchPair\')}'));
    expect(handler).toContain("e.key !== 'Escape'");
    expect(handler).toContain('e.preventDefault()');
    expect(handler).toContain('e.stopPropagation()');
    expect(handler).toContain('closeSearch()');
  });

  it('clears the query as it closes, so reopening starts clean', () => {
    // Anchored on the call, not the identifier — `useImperativeHandle` also
    // appears in the import line above.
    const close = code.slice(code.indexOf('const closeSearch'), code.indexOf('focusSearch: openSearch'));
    expect(close).toContain('setSearchOpen(false)');
    expect(close).toContain("setSearch('')");
  });

  it('makes the icon a toggle, so a second press closes it too', () => {
    expect(code).toContain('onClick={() => (searchOpen ? closeSearch() : openSearch())}');
    expect(code).toContain('aria-expanded={searchOpen}');
  });
});

describe('two ways in, both reaching the same search', () => {
  it('the ticker bar keeps its pair caret', () => {
    expect(bar).toContain('className="pair-selector"');
    expect(bar).toContain('className="pair-arrow"');
  });

  it('and gains an explicit list button beside it', () => {
    expect(bar).toContain('className="pair-markets-btn"');
    expect(bar).toContain('<ListIcon size={16} />');
    // Same handler as the caret — one behaviour, not a second code path.
    const button = bar.slice(bar.indexOf('className="pair-markets-btn"'), bar.indexOf('className="pair-selector"'));
    expect(button).toContain('onClick={onSelectSymbol}');
  });

  it('routes the page’s own entry point through the same open', () => {
    expect(code).toContain('useImperativeHandle(ref, () => ({ focusSearch: openSearch })');
    expect(read('frontend/src/pages/FuturesPage.tsx')).toContain('pairListRef.current?.focusSearch()');
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
