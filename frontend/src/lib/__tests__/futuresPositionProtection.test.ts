import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

/**
 * Real TP/SL controls on an open futures position.
 *
 * The rule every test here exists to defend: WHAT THE ROW SHOWS IS SERVER
 * STATE. A price typed into the editor is a draft of an instruction, and a
 * draft protects nothing — so until a PUT succeeds, the chips must keep
 * showing exactly what the server last said was armed. A UI that shows
 * "SL 95000" over a position with no stop loss on it is worse than no
 * control at all.
 *
 * Driven through the repo's hook-stub harness against the REAL component.
 */

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const source = (path: string) => readFileSync(resolve(frontend, 'src', path), 'utf8');
const pending = () => new Promise<any>(() => {});
const tick = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };

/** The shape `lib/api` really throws: a message plus `status` and a parsed
 *  `body` carrying a machine-readable `code`. The component branches on the
 *  code, so a bare Error here would leave that branch untested. */
class ApiError extends Error {
  constructor(message: string, public status = 400, public body: Record<string, unknown> = {}) {
    super(message);
  }
}

const CELL = 'components/FuturesPositionProtection.tsx';
const PANEL = 'components/FuturesPositionsPanel.tsx';

const trigger = (kind: 'TAKE_PROFIT' | 'STOP_LOSS', triggerPrice: string, status = 'PENDING') => ({
  id: `p-${kind}`, kind, triggerPrice, status, lastError: null, attempts: 0,
  createdAt: '2026-09-10T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z',
});

function mount(file: string, overrides: Record<string, any> = {}) {
  let index = 0;
  const hooks: any[] = [];
  let effects: (() => void)[] = [];
  const components: Record<string, any> = {};
  const api = new Proxy(overrides.api ?? {}, { get: (target, key: string) => target[key] ?? pending });

  const react = { ...React, memo: (fn: any) => fn,
    useState(initial: any) {
      const i = index++;
      if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial;
      return [hooks[i], (next: any) => { hooks[i] = typeof next === 'function' ? next(hooks[i]) : next; }];
    },
    useRef(initial: any) { const i = index++; return hooks[i] ?? (hooks[i] = { current: initial }); },
    useMemo(fn: any) { return fn(); },
    useCallback(fn: any, deps: any[]) {
      const i = index++, previous = hooks[i];
      if (!previous || deps.some((v, n) => !Object.is(v, previous.deps[n]))) hooks[i] = { deps, fn };
      return hooks[i].fn;
    },
    useEffect(fn: any, deps: any[]) {
      const i = index++, previous = hooks[i];
      if (!previous || deps === undefined || deps.some((v, n) => !Object.is(v, previous.deps[n]))) {
        hooks[i] = { deps, cleanup: undefined };
        effects.push(() => { previous?.cleanup?.(); hooks[i].cleanup = fn(); });
      }
    },
  };

  const refreshes: string[][] = [];
  const futuresAccountModule = {
    useFuturesAccount: () => overrides.account,
    refreshFuturesAccount: (keys?: string[]) => { refreshes.push(keys ?? ['*']); },
  };

  const compiled = ts.transpileModule(source(file), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const output: any = {};
  new Function('require', 'exports', 'window', 'document', compiled)((name: string) => {
    if (name === 'react') return react;
    if (name === '../lib/api') return { api, ApiError };
    if (name === '../lib/useFuturesAccount') return futuresAccountModule;
    if (name === '../lib/i18n') return { useLanguage: () => ({ t: (key: string) => key }) };
    if (name.endsWith('.css')) return {};
    if (name.startsWith('./') || name.startsWith('../components/')) {
      // Keyed by the EXPORT name, not the file name: a module whose file is
      // `FuturesPositionProtection.tsx` exports `…Cell`, and a stub keyed by
      // the filename would hand back `undefined` for that import — which
      // renders as an element with no type and quietly passes any assertion
      // that only looks for the child's absence.
      return new Proxy({}, {
        get: (_t, exportName: string) =>
          components[exportName]
          ?? (components[exportName] = Object.assign(
            (props: any) => ({ type: exportName, props, stub: true }),
            { displayName: exportName }
          )),
      });
    }
    return req(name);
  }, output, {
    confirm: () => true, setTimeout, clearTimeout, setInterval, clearInterval,
    // The editor re-anchors itself on resize, so `window` needs the listener
    // pair as well as `document`. Sizes are present but unused here: there is
    // no layout in this harness, so `getBoundingClientRect` is unavailable
    // and the component takes its documented no-measurement fallback. The
    // real geometry is asserted in the browser, where it can be measured.
    innerWidth: 1440, innerHeight: 950,
    addEventListener: () => {}, removeEventListener: () => {},
  }, { addEventListener: () => {}, removeEventListener: () => {} });

  const Component = output[Object.keys(output)[0]];
  return {
    components, refreshes, api,
    render(props: any = {}) {
      index = 0;
      const tree = Component(props);
      const queued = effects; effects = [];
      queued.forEach((fn) => fn());
      return tree;
    },
  };
}

function nodes(tree: any): any[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
}
const byClass = (tree: any, cls: string) =>
  nodes(tree).filter((n) => typeof n.props?.className === 'string' && n.props.className.split(' ').includes(cls));
const text = (tree: any) => JSON.stringify(tree);
const chips = (tree: any) => byClass(tree, 'fut-tpslChip').map((n) => [n.props.children].flat(3).filter((c) => typeof c === 'string' || typeof c === 'number').join(''));
const input = (tree: any, label: string) =>
  byClass(tree, 'fut-tpslInput').find((n) => text(n).includes(label) || true) && byClass(tree, 'fut-tpslInput')[label === 'tp' ? 0 : 1];

/** Open the editor and return a fresh tree. */
function cell(overrides: { protection?: any; save?: any; clear?: any } = {}) {
  const save = overrides.save ?? jest.fn().mockResolvedValue({});
  const clear = overrides.clear ?? jest.fn().mockResolvedValue(undefined);
  const onSaved = jest.fn();
  const view = mount(CELL, {
    api: { setFuturesPositionProtection: save, clearFuturesPositionProtection: clear },
  });
  const props = {
    positionId: 'pos-1',
    protection: overrides.protection === undefined ? { takeProfit: null, stopLoss: null } : overrides.protection,
    onSaved,
  };
  const render = () => view.render(props);
  return { view, save, clear, onSaved, render, tree: render() };
}

const openEditor = (c: ReturnType<typeof cell>) => {
  byClass(c.tree, 'fut-tpslTrigger')[0].props.onClick();
  return c.render();
};
const type = (tree: any, which: 'tp' | 'sl', value: string) =>
  input(tree, which)!.props.onChange({ target: { value } });
const submitForm = async (tree: any) => {
  nodes(tree).find((n: any) => n.type === 'form').props.onSubmit({ preventDefault: () => {} });
  await tick();
};

// ── What the row shows ──────────────────────────────────────────────

describe('the row shows server state, never a draft', () => {
  it('renders the armed triggers the server reported', () => {
    const c = cell({ protection: { takeProfit: trigger('TAKE_PROFIT', '110000'), stopLoss: trigger('STOP_LOSS', '95000') } });
    expect(chips(c.tree)).toEqual(['futures.takeProfitShort 110000', 'futures.stopLossShort 95000']);
  });

  it('renders a dash when protection is UNKNOWN, not "none"', () => {
    // `null` is the payload not having said yet. Claiming "no protection"
    // over an unknown is a statement about the account nobody made.
    const c = cell({ protection: null });
    expect(chips(c.tree)).toEqual([]);
    expect(text(c.tree)).toContain('—');
    expect(text(c.tree)).not.toContain('futures.takeProfitShort');
  });

  it('renders the set-it label when the server says nothing is armed', () => {
    const c = cell({ protection: { takeProfit: null, stopLoss: null } });
    expect(chips(c.tree)).toEqual([]);
    expect(text(c.tree)).toContain('futures.tpsl');
    expect(text(c.tree)).not.toContain('—');
  });

  it('a typed but UNSAVED price does not change the chips', () => {
    const c = cell({ protection: { takeProfit: trigger('TAKE_PROFIT', '110000'), stopLoss: null } });
    let tree = openEditor(c);
    type(tree, 'sl', '95000');
    type(tree, 'tp', '999999');
    tree = c.render();
    // Still exactly what the server said. Nothing was saved.
    expect(chips(tree)).toEqual(['futures.takeProfitShort 110000']);
    expect(c.save).not.toHaveBeenCalled();
  });

  it('the editor seeds from server state each time it opens', () => {
    const c = cell({ protection: { takeProfit: trigger('TAKE_PROFIT', '110000'), stopLoss: trigger('STOP_LOSS', '95000') } });
    let tree = openEditor(c);
    expect(input(tree, 'tp')!.props.value).toBe('110000');
    expect(input(tree, 'sl')!.props.value).toBe('95000');

    // Abandon a draft, reopen: the draft is gone.
    type(tree, 'tp', '123');
    byClass(c.render(), 'fut-tpslTrigger')[0].props.onClick(); // close
    tree = openEditor(c);
    expect(input(tree, 'tp')!.props.value).toBe('110000');
  });

  it('a FAILED trigger is shown as still trying, not as gone', () => {
    // Protection that could not execute is still armed and still being
    // retried server-side, so the row must not imply it has been dropped.
    const failed = cell({ protection: { takeProfit: null, stopLoss: trigger('STOP_LOSS', '95000', 'FAILED') } });
    expect(text(byClass(failed.tree, 'fut-tpslChip')[0])).toContain('futures.protectionRetrying');

    const pending = cell({ protection: { takeProfit: null, stopLoss: trigger('STOP_LOSS', '95000', 'PENDING') } });
    expect(text(byClass(pending.tree, 'fut-tpslChip')[0])).not.toContain('futures.protectionRetrying');
  });
});

// ── Create / edit / remove ──────────────────────────────────────────

describe('creating, editing and removing protection', () => {
  it('creates a take profit only, sending an explicit null for the other side', async () => {
    const c = cell();
    const tree = openEditor(c);
    type(tree, 'tp', '110000');
    await submitForm(c.render());

    expect(c.save).toHaveBeenCalledWith('pos-1', { takeProfit: '110000', stopLoss: null });
    expect(c.onSaved).toHaveBeenCalledTimes(1);
  });

  it('creates a stop loss only', async () => {
    const c = cell();
    const tree = openEditor(c);
    type(tree, 'sl', '95000');
    await submitForm(c.render());
    expect(c.save).toHaveBeenCalledWith('pos-1', { takeProfit: null, stopLoss: '95000' });
  });

  it('creates both at once', async () => {
    const c = cell();
    const tree = openEditor(c);
    type(tree, 'tp', '110000');
    type(tree, 'sl', '95000');
    await submitForm(c.render());
    expect(c.save).toHaveBeenCalledWith('pos-1', { takeProfit: '110000', stopLoss: '95000' });
  });

  it('edits an existing level', async () => {
    const c = cell({ protection: { takeProfit: trigger('TAKE_PROFIT', '110000'), stopLoss: null } });
    const tree = openEditor(c);
    type(tree, 'tp', '115000');
    await submitForm(c.render());
    expect(c.save).toHaveBeenCalledWith('pos-1', { takeProfit: '115000', stopLoss: null });
  });

  it('removes ONE side by clearing its field', async () => {
    const c = cell({ protection: { takeProfit: trigger('TAKE_PROFIT', '110000'), stopLoss: trigger('STOP_LOSS', '95000') } });
    const tree = openEditor(c);
    type(tree, 'tp', '   ');
    await submitForm(c.render());
    // Whitespace is not a price. An empty field is "no trigger here".
    expect(c.save).toHaveBeenCalledWith('pos-1', { takeProfit: null, stopLoss: '95000' });
  });

  it('removes BOTH sides with the remove button, which only exists when there is something to remove', async () => {
    const armed = cell({ protection: { takeProfit: trigger('TAKE_PROFIT', '110000'), stopLoss: null } });
    let tree = openEditor(armed);
    byClass(tree, 'fut-tpslRemove')[0].props.onClick();
    await tick();
    expect(armed.clear).toHaveBeenCalledWith('pos-1');
    expect(armed.onSaved).toHaveBeenCalledTimes(1);

    const bare = cell();
    expect(byClass(openEditor(bare), 'fut-tpslRemove')).toHaveLength(0);
  });

  it('refreshes the SHARED account store rather than fetching on its own', async () => {
    const c = cell();
    const tree = openEditor(c);
    type(tree, 'tp', '110000');
    await submitForm(c.render());
    // The component owns no timer and no fetch of its own; protection
    // arrives on the positions payload the panel already polls.
    expect(c.onSaved).toHaveBeenCalledTimes(1);
    expect(source(CELL)).not.toContain('setInterval');
    expect(source(CELL)).not.toContain('getFuturesPositionProtection');
  });
});

// ── Failure ─────────────────────────────────────────────────────────

describe('a failed save never looks like a successful one', () => {
  it('keeps the editor open, shows the reason, and leaves the chips on server state', async () => {
    // A real ApiError, which is what `lib/api` throws — a bare Error would
    // exercise the generic fallback instead of the server-message path.
    const save = jest.fn().mockRejectedValue(
      new ApiError('stopLoss must be below the current mark price for a LONG position', 400, { code: 'INVALID_PROTECTION' })
    );
    const c = cell({ protection: { takeProfit: trigger('TAKE_PROFIT', '110000'), stopLoss: null }, save });
    const tree = openEditor(c);
    type(tree, 'sl', '150000');
    await submitForm(c.render());
    const after = c.render();

    expect(byClass(after, 'fut-tpslError')).toHaveLength(1);
    expect(text(after)).toContain('must be below the current mark price');
    // Editor still open, so the trader can correct the value.
    expect(nodes(after).some((n: any) => n.type === 'form')).toBe(true);
    // Chips unchanged: the stop loss was NOT armed.
    expect(chips(after)).toEqual(['futures.takeProfitShort 110000']);
    expect(c.onSaved).not.toHaveBeenCalled();
  });

  it('a failed remove does not clear the chips either', async () => {
    const clear = jest.fn().mockRejectedValue(new ApiError('boom', 400, { code: 'INVALID_PROTECTION' }));
    const c = cell({ protection: { takeProfit: trigger('TAKE_PROFIT', '110000'), stopLoss: null }, clear });
    const tree = openEditor(c);
    tree && byClass(tree, 'fut-tpslRemove')[0].props.onClick();
    await tick();
    const after = c.render();
    expect(chips(after)).toEqual(['futures.takeProfitShort 110000']);
    expect(c.onSaved).not.toHaveBeenCalled();
  });

  it('a save in flight cannot be submitted twice', async () => {
    let resolveSave: (v?: unknown) => void = () => {};
    const save = jest.fn(() => new Promise((r) => { resolveSave = r; }));
    const c = cell({ save });
    const tree = openEditor(c);
    type(tree, 'tp', '110000');
    const first = c.render();
    nodes(first).find((n: any) => n.type === 'form').props.onSubmit({ preventDefault: () => {} });
    await tick();
    const during = c.render();
    nodes(during).find((n: any) => n.type === 'form').props.onSubmit({ preventDefault: () => {} });
    await tick();

    expect(save).toHaveBeenCalledTimes(1);
    expect(byClass(during, 'fut-tpslSave')[0].props.disabled).toBe(true);
    resolveSave();
    await tick();
  });
});

// ── Separation and wiring ───────────────────────────────────────────

// ── Review follow-up: honest words for 409 and 503 ──────────────────

describe('a conflict and a missing mark price are told plainly, never papered over', () => {
  it('409 while a trigger is executing: the chips stay, and the row is refreshed to show the truth', async () => {
    const save = jest.fn().mockRejectedValue(
      new ApiError('stop loss is executing', 409, { code: 'PROTECTION_TRIGGERING' })
    );
    const c = cell({ protection: { takeProfit: null, stopLoss: trigger('STOP_LOSS', '95000') }, save });
    const tree = openEditor(c);
    type(tree, 'sl', '90000');
    await submitForm(c.render());
    const after = c.render();

    expect(text(after)).toContain('futures.protectionTriggering');
    // Server state, unchanged — the edit did not happen.
    expect(chips(after)).toEqual(['futures.stopLossShort 95000']);
    // The row IS refreshed, so the trader sees the trigger firing rather
    // than a frozen snapshot.
    expect(c.onSaved).toHaveBeenCalledTimes(1);
    // Still open, so the message is readable.
    expect(nodes(after).some((n: any) => n.type === 'form')).toBe(true);
  });

  it('409 on a REMOVE never reads as a successful cancellation', async () => {
    const clear = jest.fn().mockRejectedValue(
      new ApiError('take profit is executing', 409, { code: 'PROTECTION_TRIGGERING' })
    );
    const c = cell({ protection: { takeProfit: trigger('TAKE_PROFIT', '110000'), stopLoss: null }, clear });
    const tree = openEditor(c);
    byClass(tree, 'fut-tpslRemove')[0].props.onClick();
    await tick();
    const after = c.render();

    expect(text(after)).toContain('futures.protectionTriggering');
    // The chip is still there. Nothing was cancelled, and nothing pretends
    // it was.
    expect(chips(after)).toEqual(['futures.takeProfitShort 110000']);
  });

  it('503 with no mark price says so, and does not blame the trader', async () => {
    const save = jest.fn().mockRejectedValue(
      new ApiError('No authoritative mark price', 503, { code: 'MARK_PRICE_UNAVAILABLE' })
    );
    const c = cell({ save });
    const tree = openEditor(c);
    type(tree, 'tp', '110000');
    await submitForm(c.render());
    const after = c.render();

    expect(text(after)).toContain('futures.protectionNoMarkPrice');
    expect(chips(after)).toEqual([]);
    // Nothing was armed, so nothing is refreshed as though it had been.
    expect(c.onSaved).not.toHaveBeenCalled();
  });

  it('any other failure still shows the server’s own words', async () => {
    const save = jest.fn().mockRejectedValue(
      new ApiError('stopLoss must be below the current mark price for a LONG position', 400, { code: 'INVALID_PROTECTION' })
    );
    const c = cell({ save });
    const tree = openEditor(c);
    type(tree, 'sl', '150000');
    await submitForm(c.render());
    expect(text(c.render())).toContain('must be below the current mark price');
  });

  it('the component branches on the CODE, not on message text', () => {
    const code = source(CELL);
    expect(code).toContain("code === 'PROTECTION_TRIGGERING'");
    expect(code).toContain("code === 'MARK_PRICE_UNAVAILABLE'");
    // Matching on prose would break the moment a message is reworded or
    // translated. The code is the contract.
    expect(code).not.toMatch(/err\.message\.includes|message\.match\(/);
  });
});

describe('futures-only, and wired into the positions table', () => {
  it('the control never touches a spot conditional-order endpoint', () => {
    const code = source(CELL).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const spot of ['PENDING_TRIGGER', 'updateOrderTrigger', 'getMyOrders', 'placeOrder', 'ocoGroupId', 'cancelOrder']) {
      expect(code).not.toContain(spot);
    }
    // Exactly the two futures protection mutations, and nothing else.
    expect(code).toContain('api.setFuturesPositionProtection');
    expect(code).toContain('api.clearFuturesPositionProtection');
    expect(code.match(/api\.[a-zA-Z]+\(/g)).toEqual(['api.setFuturesPositionProtection(', 'api.clearFuturesPositionProtection(']);
  });

  it('the editor follows its row rather than snapping shut on a scroll', () => {
    // Momentum scrolling on a phone keeps firing after the tap that opened
    // the editor. Closing on scroll made it unopenable at 390px; it
    // re-anchors instead, and closes only once the row has left the screen.
    const code = source(CELL);
    expect(code).toContain("window.addEventListener('resize', onReflow)");
    expect(code).toContain("document.addEventListener('scroll', onReflow, true)");
    expect(code).toContain('setPlace(placeEditor())');
    // Fixed, so the positions table's own `overflow: auto` cannot clip it.
    expect(code).toContain("position: 'fixed'");
  });

  it('PriceChart is untouched by this feature', () => {
    // PR #15 removed spot conditional lines from the futures chart. Nothing
    // here puts them back or draws anything of its own.
    expect(source(CELL)).not.toContain('PriceChart');
    expect(source(CELL)).not.toContain('lightweight-charts');
    expect(source(CELL)).not.toContain('createPriceLine');
    expect(source(PANEL)).not.toContain('PriceChart');
  });

  it('the positions panel renders the control with the SERVER protection for each row', () => {
    const panelSource = source(PANEL);
    expect(panelSource).toContain('FuturesPositionProtectionCell');
    expect(panelSource).toContain('protection={p.protection ?? null}');
    // The refresh after a mutation goes through the shared store, so no new
    // polling is introduced anywhere.
    expect(panelSource).toContain("refreshFuturesAccount(['positions'])");
    expect(panelSource).not.toContain('setInterval');
  });

  it('the panel mounts the real control for a position it lists', () => {
    const account = {
      positions: { data: [{
        id: 'pos-1', symbol: 'BTC/USDT', side: 'LONG', size: '2', entryPrice: '100000', leverage: 10,
        marginType: 'ISOLATED', initialMargin: '20000', liquidationPrice: '91000', markPrice: '105000',
        unrealizedPnl: '10000', roe: '50', openedAt: '2026-09-10T00:00:00Z',
        protection: { takeProfit: trigger('TAKE_PROFIT', '110000'), stopLoss: null },
      }], loading: false, refreshing: false, failed: false, loaded: true, fetchedAt: 1 },
      positionHistory: { data: [], loading: false, refreshing: false, failed: false, loaded: true, fetchedAt: 1 },
      balances: { data: [], loading: false, refreshing: false, failed: false, loaded: true, fetchedAt: 1 },
      orders: { data: [], loading: false, refreshing: false, failed: false, loaded: true, fetchedAt: 1 },
    };
    const panel = mount(PANEL, { account, api: {} });
    const tree = panel.render({ refreshKey: 0, tab: 'open' });

    // The harness renders only the component under test, so a child appears
    // as an element whose `type` IS the stub function — matching on the
    // stub's displayName proves the panel imported the real export name
    // rather than an undefined one.
    const cellNode = nodes(tree).find((n: any) => n.type?.displayName === 'FuturesPositionProtectionCell');
    expect(cellNode).toBeTruthy();
    expect(cellNode.props.positionId).toBe('pos-1');
    expect(cellNode.props.protection.takeProfit.triggerPrice).toBe('110000');
  });
});
