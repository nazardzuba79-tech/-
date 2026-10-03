import './otc-product-tabs.css';

export function OtcProductTabs({ active }: { active: 'otc' | 'arbitrage' }) {
  return (
    <nav className="otc-product-tabs" aria-label="OTC">
      <a href="/otc" aria-current={active === 'otc' ? 'page' : undefined}>OTC обмен</a>
      <a href="/arbitrage" aria-current={active === 'arbitrage' ? 'page' : undefined}>Арбитраж</a>
    </nav>
  );
}
