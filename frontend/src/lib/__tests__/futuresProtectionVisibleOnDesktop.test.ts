import { readSource, mountComponent, nodes } from '../../../test-utils/terminalMount';

/**
 * A saved TP/SL must be VISIBLE in the position row on desktop.
 *
 * 2026-10-13 audit (browser, 1440×900, real engine): after «Тейк-профит /
 * стоп-лосс» was saved and the server confirmed it (`GET …/protection`
 * returned both triggers), the desktop row still read «+ TP/SL» — the
 * compact trigger meant for the phone, whose levels block the mobile sheet
 * shows only at ≤900px. A trader looking at the table could not tell an
 * armed stop from none. The compact trigger now follows the phone layout,
 * not the archive design, which is also the desktop one.
 */

const position = {
  id: 'p1', symbol: 'BTC/USDT', side: 'LONG', size: '0.01', entryPrice: '83381.9',
  leverage: 25, marginType: 'ISOLATED', initialMargin: '33.35', liquidationPrice: '80380.15',
  markPrice: '83358.82', unrealizedPnl: '-0.23', roe: '-0.69', openedAt: '2026-10-13T20:00:00.000Z',
  protection: { takeProfit: { triggerPrice: '87507', status: 'ARMED' }, stopLoss: { triggerPrice: '79173', status: 'ARMED' } },
};
const resource = (data: unknown) => ({ data, loading: false, refreshing: false, failed: false, loaded: true, fetchedAt: 1 });
const account = {
  balances: resource([{ asset: 'USDT', available: '1000', locked: '33.35' }]),
  positions: resource([position]), orders: resource([]), positionHistory: resource([]),
};

/** The mount helper stubs each child module under its file name. */
const protectionCells = (panel: { components: Record<string, unknown> }, tree: any) =>
  nodes(tree).filter(n => n?.type === panel.components.FuturesPositionProtection);

describe('the position row shows the armed protection where the trader is looking', () => {
  test('desktop archive layout: the cell renders the chips, not the phone-only compact trigger', () => {
    const panel = mountComponent('components/FuturesPositionsPanel.tsx', { account });
    const cells = protectionCells(panel, panel.render({ refreshKey: 0, tab: 'open', archive: true }));
    expect(cells).toHaveLength(1);
    expect(cells[0].props.protection).toEqual(position.protection);
    expect(cells[0].props.compactTrigger).toBe(false);
  });

  test('phone layout: the compact trigger with the levels block underneath', () => {
    const panel = mountComponent('components/FuturesPositionsPanel.tsx', { account });
    const cells = protectionCells(panel, panel.render({ refreshKey: 0, tab: 'open', archive: true, mobile: true }));
    expect(cells).toHaveLength(1);
    expect(cells[0].props.compactTrigger).toBe(true);
  });

  test('the cell itself: chips carry both trigger prices when not compact; compact hides them in the trigger', () => {
    const cell = mountComponent('components/FuturesPositionProtection.tsx', { execution: { setProtection: jest.fn() } });
    const chips = (tree: any) => nodes(tree).filter(n => typeof n?.props?.className === 'string' && n.props.className.split(' ').includes('fut-tpslChip'))
      .map(n => JSON.stringify(n.props.children));
    const desktop = chips(cell.render({ positionId: 'p1', protection: position.protection, onSaved: jest.fn() }));
    expect(desktop).toHaveLength(2);
    expect(desktop[0]).toContain('87507');
    expect(desktop[1]).toContain('79173');
    const phone = cell.render({ positionId: 'p1', protection: position.protection, onSaved: jest.fn(), compactTrigger: true });
    expect(chips(phone)).toHaveLength(0);
    expect(nodes(phone).some(n => n?.props?.className === 'futures-mobile-protection-values')).toBe(true);
  });

  test('the page hands the panel the phone media query, and the levels block is phone-only CSS', () => {
    const page = readSource('pages/FuturesPage.tsx');
    expect(page).toContain('const compact = useMediaQuery(MOBILE_TERMINAL_QUERY)');
    expect(page).toMatch(/<FuturesPositionsPanel\s+archive=\{archivePreview\}\s+mobile=\{compact\}/);
    expect(readSource('components/FuturesPositionsPanel.tsx')).toContain('compactTrigger={archive && mobile}');
    const mobileCss = readSource('pages/trade-terminal/FuturesMobile.css');
    expect(mobileCss).toMatch(/\.futures-mobile-protection-values[^{]*\{ display:none; \}/);
    expect(mobileCss).toContain('#archive-terminal-preview .futures-mobile-protection-values { display:flex;');
    expect(readSource('pages/trade-terminal/ArchiveTerminalPreview.css')).toContain('#archive-terminal-preview .fut-tpslChip');
  });
});
