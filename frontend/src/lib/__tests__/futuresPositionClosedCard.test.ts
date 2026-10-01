import { byClass, mountComponent, readSource, tick } from '../../../test-utils/terminalMount';

/**
 * «Позиция закрыта» (owner, 2026-10-01, variant B): a market close leaves a
 * card bottom right with the contract, the filled quantity and price, and
 * the realized P&L. Every figure is what the engine reported — the fill
 * from the close itself, the P&L from the position history — and a figure
 * that is not known is left out or waits, never estimated.
 */

const PANEL = 'components/FuturesPositionsPanel.tsx';
const CARD = 'components/FuturesPositionClosedCard.tsx';

const settled = <T,>(data: T) => ({ data, loading: false, refreshing: false, failed: false, loaded: true, fetchedAt: 0 });
const openPosition = (id: string) => ({
  id, symbol: 'BTC/USDT', side: 'LONG', size: '0.5', entryPrice: '80000', leverage: 10,
  marginType: 'CROSS', initialMargin: '4000', liquidationPrice: '72000', markPrice: '81000',
  unrealizedPnl: '500', realizedPnl: '0', roe: '12.5', openedAt: '2026-01-01T00:00:00Z',
  protection: { takeProfit: null, stopLoss: null },
});

function setup(closePosition: jest.Mock, props: Record<string, unknown> = { tab: 'open', refreshKey: 0 }) {
  const account = { balances: settled([]), positions: settled([openPosition('p1')]), positionHistory: settled([] as any[]), orders: settled([]) };
  const wants: unknown[] = [];
  const mounted = mountComponent(PANEL, {
    execution: { closePosition },
    modules: {
      '../lib/useFuturesAccount': {
        useFuturesAccount: (w: unknown) => { wants.push(w); return account; },
        refreshFuturesAccount: () => {},
      },
    },
  });
  const render = () => mounted.render(props);
  render();
  const card = () => mounted.components.FuturesPositionClosedCard;
  // The stubbed card is called with its props on every render it is present in.
  const notice = (tree: any) => {
    const nodes = (t: any): any[] => Array.isArray(t) ? t.flatMap(nodes) : t && typeof t === 'object' ? [t, ...nodes(t.props?.children)] : [];
    return nodes(tree).find((n) => n.type === card())?.props ?? null;
  };
  // «Рыночный», not «Лимитный»: both buttons share the row's close class.
  const closeMarket = (tree: any) => byClass(tree, 'futures-position-close').find((b) => b.props.children === 'futures.closeMarket').props.onClick();
  return { account, wants, render, notice, closeMarket };
}

describe('the «Позиция закрыта» card after a market close', () => {
  it('shows the contract, the filled quantity and price, then the realized P&L from the history', async () => {
    const closePosition = jest.fn().mockResolvedValue({ quantity: '0.5', averagePrice: '84037' });
    const s = setup(closePosition);
    s.closeMarket(s.render());
    await tick();
    let props = s.notice(s.render());
    expect(props.notice).toMatchObject({
      kind: 'closed',
      contract: 'BTCUSDT · futures.long 10.00x',
      quantity: '0.500 BTC',
      price: '84,037.00',
    });
    // The history has not answered yet: the P&L waits, it is not estimated.
    expect(props.notice.pnl).toBeUndefined();
    // While it waits, the panel asks for the history (one load, no timer).
    expect(s.wants[s.wants.length - 1]).toEqual({ positions: 10_000, positionHistory: 0 });

    s.account.positionHistory = { ...settled([{ id: 'p1', symbol: 'BTC/USDT', side: 'LONG', leverage: 10, marginType: 'CROSS', entryPrice: '80000', realizedPnl: '2018.5', status: 'CLOSED', openedAt: '', closedAt: '' }]), fetchedAt: Date.now() };
    props = s.notice(s.render());
    expect(props.notice.pnl).toEqual({ text: '+2,018.50 USDT', positive: true });
  });

  it('a loss is a loss: signed and coloured as one', async () => {
    const s = setup(jest.fn().mockResolvedValue({ quantity: '0.5', averagePrice: '79000' }));
    s.closeMarket(s.render());
    await tick();
    s.account.positionHistory = { ...settled([{ id: 'p1', realizedPnl: '-512.4' }]), fetchedAt: Date.now() };
    expect(s.notice(s.render()).notice.pnl).toEqual({ text: '-512.40 USDT', positive: false });
  });

  it('no reported fill: no price line, the quantity is the position the row held', async () => {
    const s = setup(jest.fn().mockResolvedValue(undefined));
    s.closeMarket(s.render());
    await tick();
    expect(s.notice(s.render()).notice).toMatchObject({ price: null, quantity: '0.500 BTC' });
  });

  it('a history that answered without the position leaves the P&L line out', async () => {
    const s = setup(jest.fn().mockResolvedValue({ quantity: '0.5', averagePrice: '84037' }));
    s.closeMarket(s.render());
    await tick();
    s.account.positionHistory = { ...settled([]), fetchedAt: Date.now() + 1 };
    expect(s.notice(s.render()).notice.pnl).toBeNull();
  });

  it('a refused close shows the red card with the reason, and keeps the inline error', async () => {
    const s = setup(jest.fn().mockRejectedValue(new Error('refused')));
    s.closeMarket(s.render());
    await tick();
    const tree = s.render();
    expect(s.notice(tree).notice).toMatchObject({ kind: 'failed', reason: 'futures.closePositionError', contract: 'BTCUSDT · futures.long 10.00x' });
    expect(JSON.stringify(tree)).toContain('futures.closePositionError');
    // A failed close does not ask for the history.
    expect(s.wants[s.wants.length - 1]).toEqual({ positions: 10_000 });
  });

  it('closing the card removes it; the history wish goes with it', async () => {
    const s = setup(jest.fn().mockResolvedValue({ quantity: '0.5', averagePrice: '84037' }));
    s.closeMarket(s.render());
    await tick();
    s.notice(s.render()).onDismiss();
    expect(s.notice(s.render())).toBeNull();
    expect(s.wants[s.wants.length - 1]).toEqual({ positions: 10_000 });
  });

  it('«История позиций»: the page\'s tab when the page hands one over, the panel\'s own tab when standalone', async () => {
    const onShowHistory = jest.fn();
    const page = setup(jest.fn().mockResolvedValue(undefined), { tab: 'open', refreshKey: 0, onShowHistory });
    page.closeMarket(page.render());
    await tick();
    expect(page.notice(page.render()).onShowHistory).toBe(onShowHistory);

    const controlledWithout = setup(jest.fn().mockResolvedValue(undefined), { tab: 'open', refreshKey: 0 });
    controlledWithout.closeMarket(controlledWithout.render());
    await tick();
    expect(controlledWithout.notice(controlledWithout.render()).onShowHistory).toBeUndefined();

    const standalone = setup(jest.fn().mockResolvedValue(undefined), { refreshKey: 0 });
    standalone.closeMarket(standalone.render());
    await tick();
    expect(typeof standalone.notice(standalone.render()).onShowHistory).toBe('function');
  });

  it('Close All keeps its one summary and opens no card per position', () => {
    const source = readSource(PANEL);
    const runCloseAll = source.slice(source.indexOf('async function runCloseAll'), source.indexOf('async function runCloseAll') + 1600);
    expect(runCloseAll).not.toContain('setClosed(');
  });
});

describe('the card itself', () => {
  const source = readSource(CARD);
  it('stays six seconds (eight for a refusal), pauses on hover and focus, and has a dismiss button', () => {
    expect(source).toContain('const SHOWN_MS = 6000;');
    expect(source).toContain('const FAILED_MS = 8000;');
    expect(source).toContain('onMouseEnter={() => setPaused(true)}');
    expect(source).toContain('onFocus={() => setPaused(true)}');
    expect(source).toContain("aria-label={t('futures.closedDismiss')}");
  });
  it('announces itself politely, a refusal assertively', () => {
    expect(source).toContain("role={failed ? 'alert' : 'status'}");
  });
  it('does not repeat the generic refusal under the same title', () => {
    expect(source).toContain('notice.reason && notice.reason !== title &&');
  });
});
