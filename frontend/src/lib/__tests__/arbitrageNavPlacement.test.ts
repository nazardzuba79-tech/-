import { readFileSync } from 'fs';
import { resolve } from 'path';

const frontend = resolve(__dirname, '../../..');
const read = (path:string) => readFileSync(resolve(frontend, path), 'utf8').replace(/\r\n/g, '\n');
const nav = read('src/components/Nav.tsx');
const home = read('src/pages/home/HomeHeader.tsx');
const footer = read('src/pages/home/HomeFooter.tsx');
const arctic = read('src/pages/settings-arctic/ArcticTopNav.tsx');
const otc = read('src/pages/OtcPage.tsx');
const arbitrage = read('src/pages/ArbitragePage.tsx');
const tabs = read('src/pages/otc/OtcProductTabs.tsx');

describe('Arbitrage navigation placement', () => {
  it('belongs to OTC, not Trade or the top-level product row', () => {
    expect(nav).toContain("const otcSectionActive = active === '/otc' || active === '/arbitrage';");
    expect(nav).not.toContain("const tradeSectionActive = active === '/trade' || active === '/arbitrage'");
    expect(nav.match(/links=\{OTC_LINKS\}/g)).toHaveLength(2);
    const dropdown = read('src/components/HeaderDropdown.tsx');
    expect(dropdown.split('export const OTC_LINKS')[1].split('export const KNOWLEDGE_LINKS')[0]).toContain("to: '/arbitrage'");
    expect(dropdown.split('export const TRADING_LINKS')[1].split('export const MARKET_LINKS')[0]).not.toContain('/arbitrage');
    expect(home).not.toContain("{ to: '/arbitrage', labelKey: 'nav.arbitrage' }");
    expect(footer).not.toContain("{ labelKey: 'nav.arbitrage', to: '/arbitrage' }");
    expect(arctic).not.toContain("{ to: '/arbitrage', key: 'nav.arbitrage' }");
  });

  it('shows OTC exchange and Arbitrage as sibling tabs inside the OTC area', () => {
    expect(tabs).toContain('<a href="/otc"');
    expect(tabs).toContain('<a href="/arbitrage"');
    expect(otc).toContain('<OtcProductTabs active="otc" />');
    expect(arbitrage).toContain('<OtcProductTabs active="arbitrage" />');
  });

  it('keeps Banking & Earn stable on terminal pages', () => {
    expect(nav).toContain("{to:'/banking',label:'Banking & Earn'}");
    expect(nav).not.toContain("terminalCopy?terminalLabels.earn:'Banking & Earn'");
  });
});
