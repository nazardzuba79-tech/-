import { readSource, byClass, mountComponent } from '../../../test-utils/terminalMount';

/** Prevent future mobile polish from quietly becoming a desktop redesign. */
test('the mobile sheet changes existing components only at mobile widths', () => {
  const postcss = require('postcss');
  const css = postcss.parse(readSource('pages/trade-terminal/FuturesMobile.css'));
  css.walkRules((rule: any) => {
    if (rule.parent.type === 'root') {
      // Only newly added, mobile-exclusive elements may be hidden globally.
      expect(rule.toString()).toMatch(/display:\s*none/);
      for (const selector of rule.selectors) expect(selector).toContain('futures-mobile-');
    } else {
      expect(rule.parent.name).toBe('media');
      expect(rule.parent.params).toMatch(/^\(max-width:(900|359)px\)$/);
      for (const selector of rule.selectors) expect(selector).toMatch(/^#archive-terminal-preview/);
    }
  });
});

test('mobile protection values remain the server values while an editor draft is changed', () => {
  const setProtection = jest.fn();
  const cell = mountComponent('components/FuturesPositionProtection.tsx', { execution: { setProtection } });
  const props = { positionId: 'position-1', compactTrigger: true, onSaved: jest.fn(), protection: {
    takeProfit: { triggerPrice: '85000', status: 'ARMED' }, stopLoss: { triggerPrice: '72000', status: 'ARMED' },
  } };
  let tree = cell.render(props);
  const initial = byClass(tree, 'futures-mobile-protection-values')[0];
  byClass(tree, 'fut-tpslTrigger')[0].props.onClick(); tree = cell.render(props);
  byClass(tree, 'fut-tpslInput')[0].props.onChange({ target: { value: '99999' } }); tree = cell.render(props);
  expect(byClass(tree, 'futures-mobile-protection-values')[0].props.children).toEqual(initial.props.children);
  expect(setProtection).not.toHaveBeenCalled();
});
