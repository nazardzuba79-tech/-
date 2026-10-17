import { SHORT_HISTORY_RIGHT_PADDING, SHORT_HISTORY_SLOTS, dataBoundsFromEdges, initialLogicalRange, safeBottomMargin } from '../chartViewport';

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
