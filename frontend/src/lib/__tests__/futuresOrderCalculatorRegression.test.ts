import { readFileSync } from 'fs';
import { resolve } from 'path';

const FORM = readFileSync(resolve(__dirname, '../../components/FuturesOrderForm.tsx'), 'utf8');

describe('Futures quantity calculator and LIMIT readiness regression', () => {
  test('an untouched LIMIT price is seeded from the real last traded price', () => {
    expect(FORM).toContain("const [priceEdited, setPriceEdited] = useState(false);");
    expect(FORM).toContain("if (family !== 'LIMIT' || priceEdited || price !== '') return;");
    expect(FORM).toContain('lastPrice !== null && Number.isFinite(lastPrice) && lastPrice > 0');
    expect(FORM).toContain('setPrice(String(lastPrice));');
  });

  test('manual or order-book price selection is never overwritten by a later tick', () => {
    expect(FORM).toMatch(/if \(pickedPrice\) \{[\s\S]{0,160}setPriceEdited\(true\)/);
    expect(FORM).toMatch(/onChange=\{\(e\) => \{[\s\S]{0,120}setPriceEdited\(true\);[\s\S]{0,120}setPrice\(e\.target\.value\)/);
  });

  test('quantity drives position value and margin only from a positive real price', () => {
    expect(FORM).toContain('const notional = effectivePrice && quantity ? effectivePrice * quantityNumber : 0;');
    expect(FORM).toContain("&& quantity !== '' && Number.isFinite(quantityNumber) && quantityNumber > 0;");
    expect(FORM).toContain("orderSizeKnown ? `${formatAmount(notional)} ${quoteAsset}` : '—'");
    // The margin row is dashed for a reduce-only order as well: a close
    // posts no margin, so quoting one under it was a number nobody pays.
    expect(FORM).toContain("orderSizeKnown && !reduceOnly ? `${formatAmount(requiredMargin)} ${quoteAsset}` : '—'");
  });

  test('an empty/zero LIMIT can no longer reach the execution engine', () => {
    expect(FORM).toMatch(/const canSubmit = Boolean\(config\)[\s\S]{0,500}&& orderSizeKnown[\s\S]{0,500}&& !submitting;/);
  });
});
