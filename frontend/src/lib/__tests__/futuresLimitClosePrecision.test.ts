import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { limitClosePrecision, quantityText, shareOfPosition } from '../futuresLimitClose';

describe('limit-close quantity precision without contract rules (the real engine)', () => {
  test('a 0.01 BTC position can be half- and quarter-closed; the ± keys still move by 0.01', () => {
    const p = limitClosePrecision('0.01', null);
    expect(p).toEqual({ qtyDecimals: 5, step: 0.00001, nudgeStep: 0.01 });
    expect(shareOfPosition('0.01', 50, p)).toBe('0.005');
    expect(shareOfPosition('0.01', 25, p)).toBe('0.0025');
    expect(shareOfPosition('0.01', 75, p)).toBe('0.0075');
    expect(shareOfPosition('0.01', 100, p)).toBe('0.01');
  });
  test('whole-unit sizes keep whole-unit nudges and exact shares (the AKE 15 000 000 case)', () => {
    const p = limitClosePrecision('15000000', null);
    expect(p).toEqual({ qtyDecimals: 3, step: 0.001, nudgeStep: 1 });
    expect(shareOfPosition('15000000', 25, p)).toBe('3750000');
    expect(shareOfPosition('15000000', 50, p)).toBe('7500000');
    expect(shareOfPosition('15000000', 33, p)).toBe('4950000');
  });
  test('an odd size rounds its share DOWN onto the grid, never above what exists', () => {
    const p = limitClosePrecision('1.5', null);
    expect(shareOfPosition('1.5', 25, p)).toBe('0.375');
    expect(Number(shareOfPosition('0.0003', 33, limitClosePrecision('0.0003', null)))).toBeLessThanOrEqual(0.0003 * 0.33);
    expect(shareOfPosition('0.0003', 33, limitClosePrecision('0.0003', null))).toBe('0.000099');
  });
  test('the precision is capped at eight decimals', () => {
    const p = limitClosePrecision('0.00000123', null);
    expect(p.qtyDecimals).toBe(8); expect(p.nudgeStep).toBe(0.00000001);
  });
});

describe('limit-close quantity precision with the contract rules', () => {
  test('follows the contract step for shares, validation and nudges alike', () => {
    const p = limitClosePrecision('0.02', '0.001');
    expect(p).toEqual({ qtyDecimals: 3, step: 0.001, nudgeStep: 0.001 });
    expect(shareOfPosition('0.02', 25, p)).toBe('0.005');
    expect(shareOfPosition('0.0255', 50, p)).toBe('0.012');
  });
  test('quantity text drops trailing zeros but keeps the precision', () => {
    expect(quantityText(0.005, 5)).toBe('0.005'); expect(quantityText(3750000, 3)).toBe('3750000'); expect(quantityText(0.1 + 0.2, 3)).toBe('0.3');
  });
});

test('the dialog derives its precision and shares from this module', () => {
  const src = readFileSync(resolve(__dirname, '../../components/FuturesLimitCloseDialog.tsx'), 'utf8');
  expect(src).toContain("from '../lib/futuresLimitClose'");
  expect(src).toContain('limitClosePrecision(p.size, rules?.qtyStep ?? null)');
  expect(src).toContain('shareOfPosition(p.size, pct, precision)');
  expect(src).not.toMatch(/decimalsOf\(p\.size\)/);
});
