import { SHORT_HISTORY_RIGHT_PADDING, SHORT_HISTORY_SLOTS, dataBoundsFromEdges, initialLogicalRange, logicalToX, safeBottomMargin } from '../chartViewport';

describe('the first view of a loaded series', () => {
  it('shows the newest window when there is more history than the window', () => {
    expect(initialLogicalRange(520, 300)).toEqual({ from: 220, to: 519 });
    expect(initialLogicalRange(121, 120)).toEqual({ from: 1, to: 120 });
  });
  it('lays a short history over at least sixty slots at the right, so one weekly bar is a bar and not a wall', () => {
    const one = initialLogicalRange(1, 120)!;
    expect(one.to - one.from + 1).toBe(SHORT_HISTORY_SLOTS);
    expect(one.to).toBe(SHORT_HISTORY_RIGHT_PADDING);
    expect(one.from).toBeLessThan(0);
    const twentyTwo = initialLogicalRange(22, 300)!;
    expect(twentyTwo.to - twentyTwo.from + 1).toBe(SHORT_HISTORY_SLOTS);
    expect(twentyTwo.to).toBe(21 + SHORT_HISTORY_RIGHT_PADDING);
    // Enough bars to fill the slots: all of them stay in view with the right padding.
    expect(initialLogicalRange(100, 120)).toEqual({ from: 0, to: 103 });
    expect(initialLogicalRange(263, 300)).toEqual({ from: 0, to: 266 });
  });
  it('has nothing to show for an empty series', () => {
    expect(initialLogicalRange(0, 120)).toBeNull();
  });
});

describe('a positive-price axis never extends below zero', () => {
  it('reads the bars back from the pane edges with the margins in force', () => {
    // Bars 2 → 22 inside [0.3, 0.9] of a pane: the axis runs −8 → 25.333…
    const edges = dataBoundsFromEdges(22 + 20 * 0.1 / 0.6, 2 - 20 * 0.3 / 0.6, 0.1, 0.3);
    expect(edges.lo).toBeCloseTo(2, 9);
    expect(edges.hi).toBeCloseTo(22, 9);
  });
  it('keeps the wanted margin when the lowest bar is far above zero and shrinks it only as far as needed otherwise', () => {
    expect(safeBottomMargin(85000, 86000, 0.1, 0.06)).toBe(0.06);
    // A listing at 2 → 22 with a 0.3 margin would show −8: the margin drops to just under 2·0.9/22.
    const young = safeBottomMargin(2, 22, 0.1, 0.3);
    expect(young).toBeLessThan(0.3);
    expect(young).toBeGreaterThan(0.07);
    expect(2 - 20 * young / (1 - 0.1 - young)).toBeGreaterThanOrEqual(0);
    // A thousandfold mover (0.01 → 10) keeps a sliver of margin and a non-negative axis.
    const mover = safeBottomMargin(0.01, 10.1, 0.1, 0.06);
    expect(mover).toBeGreaterThanOrEqual(0);
    expect(0.01 - 10.09 * mover / (1 - 0.1 - mover)).toBeGreaterThanOrEqual(0);
  });
  it('leaves bars at or below zero alone: an oscillator or a percent scale may be negative', () => {
    expect(safeBottomMargin(-30, 70, 0.1, 0.3)).toBe(0.3);
    expect(safeBottomMargin(0, 10, 0.1, 0.3)).toBe(0.3);
  });
});

describe('a drawing anchor between two bars', () => {
  // Lightweight Charts 5.2 TimeScale.indexToCoordinate: whole bars only, 0 for anything else.
  const width = 800, barSpacing = 12, rightOffset = 4, baseIndex = 24;
  const library = (index: number) => (index % 1 === 0 ? width - (baseIndex + rightOffset - index + 0.5) * barSpacing - 1 : 0);

  it('is placed between them, not on the plot\'s left edge', () => {
    // AITH/USDT 4h, 2026-10-17: a ruler drawn on 1h read an hour after bar 0 and bar 13.
    expect(library(0.25)).toBe(0);
    expect(logicalToX(0.25, library)).toBeCloseTo(library(0) + 3, 9);
    expect(logicalToX(13.25, library)).toBeCloseTo(library(13) + 3, 9);
    expect(logicalToX(13.25, library)! - logicalToX(0.25, library)!).toBeCloseTo(13 * barSpacing, 9);
  });
  it('keeps whole bars exactly where the chart paints them', () => {
    for (const index of [-3, 0, 7, 24, 30]) expect(logicalToX(index, library)).toBe(library(index));
  });
  it('projects before the first bar and past the last one at the same spacing', () => {
    expect(logicalToX(-0.5, library)).toBeCloseTo(library(0) - 6, 9);
    expect(logicalToX(26.5, library)).toBeCloseTo(library(26) + 6, 9);
  });
  it('has no position when the chart has none', () => {
    expect(logicalToX(3.5, () => null)).toBeNull();
    expect(logicalToX(Number.NaN, library)).toBeNull();
    expect(logicalToX(Number.POSITIVE_INFINITY, library)).toBeNull();
  });
});
