import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as actions from '../futuresPositionActions';

const req = createRequire(resolve(__dirname, '../../../package.json'));
const React = req('react');
const btc = { id: 'btc', symbol: 'BTC/USDT', side: 'LONG', size: '1.26895192' };
const eth = { id: 'eth', symbol: 'ETH/USDT', side: 'SHORT', size: '2.50' };
function nodes(node: any): any[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return node && typeof node === 'object' ? [node, ...nodes(node.props?.children)] : [];
}
function harness(positions = [btc, eth]) {
  const account = { positions: { data: positions as any, failed: false } };
  const execution = { ready: true, engine: 'REAL', closePosition: jest.fn().mockResolvedValue(undefined), refresh: jest.fn() };
  const hooks: any[] = [];
  let index = 0;
  const react = { ...React, useEffect() {},
    useRef(value: any) { const i = index++; return hooks[i] ?? (hooks[i] = { current: value }); },
    useState(value: any) { const i = index++; if (!(i in hooks)) hooks[i] = value;
      return [hooks[i], (next: any) => { hooks[i] = next; }]; },
  };
  const compiled = ts.transpileModule(readFileSync(resolve(__dirname, '../../components/FuturesCloseAllPositions.tsx'), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const output: any = {};
  new Function('require', 'exports', compiled)((name: string) => {
    if (name === 'react') return react;
    if (name.endsWith('/i18n')) return { useLanguage: () => ({ lang: 'ru', t: (key: string) => key }) };
    if (name.endsWith('/useFuturesAccount')) return { useFuturesAccount: () => account };
    if (name.endsWith('/futuresExecution')) return { useFuturesExecution: () => execution };
    if (name.endsWith('/futuresPositionActions')) return actions;
    if (name.endsWith('/futuresOrderErrors')) return { futuresOrderErrorMessage: () => 'Close failed' };
    return req(name);
  }, output);
  const render = () => { index = 0; return output.FuturesCloseAllPositions({ visible: true }); };
  const button = (label: string) => nodes(render()).find(n => n.type === 'button' && n.props.children === label);
  const open = () => button('Закрыть все').props.onClick();
  return { account, execution, render, button, open };
}

test('BTC displays three decimals, without mutating the position used for execution', () => {
  expect(actions.formatPositionQuantity(btc.size, btc.symbol)).toBe('1.269');
  expect(btc.size).toBe('1.26895192');
  expect(actions.formatPositionQuantity('0.45', btc.symbol)).toBe('0.450');
  expect(actions.formatPositionQuantity('bad', btc.symbol)).toBe('—');
  expect(actions.formatPositionQuantity('2.501234', eth.symbol)).toBe('2.501234');
});
test('opening and cancelling confirmation never closes positions', () => {
  const f = harness(); f.open();
  expect(JSON.stringify(f.render())).toContain('BTC/USDT');
  f.button('futures.cancel').props.onClick();
  expect(f.execution.closePosition).not.toHaveBeenCalled();
});
test('changed exposure, failed account reads and unavailable engine block confirmation', async () => {
  for (const mutate of [
    (f: any) => { f.account.positions.data = [btc]; },
    (f: any) => { f.account.positions.data = [{ ...btc, size: '3' }, eth]; },
    (f: any) => { f.account.positions.failed = true; },
    (f: any) => { f.execution.ready = false; },
  ]) {
    const f = harness(); f.open(); const confirm = f.button('Подтвердить закрытие').props.onClick;
    mutate(f); f.render(); await confirm();
    expect(f.execution.closePosition).not.toHaveBeenCalled();
  }
});
test('confirmed closes are sequential and duplicate clicks do not submit twice', async () => {
  const f = harness(); let finish!: () => void;
  f.execution.closePosition.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  f.open(); const confirm = f.button('Подтвердить закрытие').props.onClick;
  const pending = confirm(); await confirm();
  expect(f.execution.closePosition.mock.calls).toEqual([['btc']]);
  expect(f.button('futures.cancel').props.disabled).toBe(true);
  finish(); await pending;
  expect(f.execution.closePosition.mock.calls).toEqual([['btc'], ['eth']]);
  expect(f.execution.refresh).toHaveBeenCalledWith(['positions', 'positionHistory', 'balances']);
  expect(JSON.stringify(f.render())).toContain('Закрыто позиций');
});
test('partial failure is reported, without retrying an uncertain close or hiding remaining positions', async () => {
  const f = harness(); f.execution.closePosition.mockRejectedValueOnce(new Error('network'));
  f.open(); await f.button('Подтвердить закрытие').props.onClick();
  expect(f.execution.closePosition.mock.calls).toEqual([['btc'], ['eth']]);
  expect(JSON.stringify(f.render())).toContain('Close failed');
  expect(f.account.positions.data).toHaveLength(2);
  expect(f.button('Подтвердить закрытие')).toBeUndefined();
});
test('a later position changed during execution is not closed under old consent', async () => {
  const f = harness();
  f.execution.closePosition.mockImplementationOnce(async () => {
    f.account.positions.data = [btc, { ...eth, size: '8' }]; f.render();
  });
  f.open(); await f.button('Подтвердить закрытие').props.onClick();
  expect(f.execution.closePosition.mock.calls).toEqual([['btc']]);
  expect(JSON.stringify(f.render())).toContain('Позиция изменилась');
});
