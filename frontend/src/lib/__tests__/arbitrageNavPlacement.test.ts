import { readFileSync } from 'fs';
import { resolve } from 'path';

const frontend = resolve(__dirname, '../../..');
const nav = readFileSync(resolve(frontend, 'src/components/Nav.tsx'), 'utf8').replace(/\r\n/g, '\n');

describe('Arbitrage navigation placement', () => {
  it('keeps Arbitrage inside Trade beside Spot/CFD, not as a primary product link', () => {
    expect(nav).not.toContain("{to:'/arbitrage',label:t('nav.arbitrage')}");
    expect(nav.match(/to="\/arbitrage"/g)).toHaveLength(2);
    expect(nav).toContain("const tradeSectionActive = active === '/trade' || active === '/arbitrage' || active === '/tools';");
    expect(nav).toContain(">{t('trade.cfdTab')}</Link><Link to=\"/arbitrage\"");
    expect(nav).toContain("active==='/arbitrage'?styles.linkActive");
  });

  it('keeps Banking & Earn stable on terminal pages', () => {
    expect(nav).toContain("{to:'/banking',label:'Banking & Earn'}");
    expect(nav).not.toContain("terminalCopy?terminalLabels.earn:'Banking & Earn'");
  });
});
