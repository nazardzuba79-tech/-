export const TOOL_MODES = ['pnl', 'size', 'liquidation', 'risk-reward', 'dca', 'fees'] as const;
export type ToolMode = typeof TOOL_MODES[number];
export type Market = 'spot' | 'futures';
export type Side = 'long' | 'short';
export type DcaRow = { id: number; mode: 'quantity' | 'amount'; price: string; quantity: string; amount: string; fee: string };
export const FIELD_NAMES = ['entry', 'exit', 'quantity', 'margin', 'leverage', 'feeEntry', 'feeExit', 'slipEntry', 'slipExit', 'funding', 'fixedCosts', 'capital', 'riskPercent', 'stop', 'feeStop', 'slipStop', 'budget', 'step', 'maintenanceRate', 'additionalMargin', 'costs', 'target', 'feeTarget', 'slipTarget', 'exitPrice', 'dcaExitFee', 'newPrice', 'newFee', 'targetAverage', 'notionalEntry', 'notionalExit', 'makerRate', 'takerRate', 'fundingNotional', 'fundingRate', 'fundingPeriods'] as const;
export type FieldName = typeof FIELD_NAMES[number];
export type Draft = Record<FieldName, string> & {
  side: Side; quantityMode: 'quantity' | 'margin'; inputMode: 'quantity' | 'notional';
  entryRole: 'maker' | 'taker'; exitRole: 'maker' | 'taker';
  includeExit: boolean; fundingEnabled: boolean; dcaExitEnabled: boolean; targetEnabled: boolean;
  rows: DcaRow[]; touched: string[];
};

export function emptyDraft(): Draft {
  const numeric = Object.fromEntries(FIELD_NAMES.map((key) => [key, ''])) as Record<FieldName, string>;
  return { ...numeric, leverage: '1', feeEntry: '0', feeExit: '0', feeStop: '0', feeTarget: '0', slipEntry: '0', slipExit: '0', slipStop: '0', slipTarget: '0', funding: '0', fixedCosts: '0', additionalMargin: '0', costs: '0', dcaExitFee: '0', newFee: '0', side: 'long', quantityMode: 'quantity', inputMode: 'quantity', entryRole: 'taker', exitRole: 'taker', includeExit: true, fundingEnabled: false, dcaExitEnabled: false, targetEnabled: false, rows: [{ id: 1, mode: 'quantity', price: '', quantity: '', amount: '', fee: '0' }], touched: [] };
}

export function exampleDraft(mode: ToolMode, market: Market): Draft {
  const common = { ...emptyDraft(), entry: '60000', exit: '66000', quantity: '0.1', margin: '600', leverage: market === 'spot' ? '1' : '10', feeEntry: '0.05', feeExit: '0.05' };
  if (mode === 'size') return { ...common, capital: '10000', riskPercent: '1', entry: '50000', stop: '49000', feeEntry: '0', feeStop: '0', leverage: '5', step: '0.001' };
  if (mode === 'liquidation') return { ...common, entry: '50000', quantity: '0.2', leverage: '10', maintenanceRate: '0.5' };
  if (mode === 'risk-reward') return { ...common, entry: '50000', stop: '49000', target: '52000', feeEntry: '0', feeStop: '0', feeTarget: '0' };
  if (mode === 'dca') return { ...common, rows: [{ id: 1, mode: 'quantity', price: '50000', quantity: '0.1', amount: '', fee: '0.1' }, { id: 2, mode: 'quantity', price: '40000', quantity: '0.15', amount: '', fee: '0.1' }], exitPrice: '48000', newPrice: '35000', targetAverage: '40000' };
  if (mode === 'fees') return { ...common, entry: '50000', exit: '55000', quantity: '0.2', notionalEntry: '10000', notionalExit: '11000', makerRate: '0.02', takerRate: '0.06', fundingNotional: '10000', fundingRate: '0.01', fundingPeriods: '3' };
  return common;
}
