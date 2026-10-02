import { Link } from 'react-router-dom';
import './otc-product-tabs.css';

export function OtcProductTabs({ active }: { active: 'otc' | 'arbitrage' }) {
  return (
    <nav className="otc-product-tabs" aria-label="OTC">
      <Link to="/otc" aria-current={active === 'otc' ? 'page' : undefined}>OTC обмен</Link>
      <Link to="/arbitrage" aria-current={active === 'arbitrage' ? 'page' : undefined}>Арбитраж</Link>
    </nav>
  );
}
