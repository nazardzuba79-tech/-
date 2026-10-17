import { Link } from 'react-router-dom';
import { Activity, ArrowLeft, Settings2 } from 'lucide-react';
import { LanguageSwitcher } from '../../../components/LanguageSwitcher';
import { useLanguage } from '../../../lib/i18n';
import { useStocksText } from './useStocksText';

/** Presentation from the approved archive; navigation uses the current app. */
export default function OriginalStocksHeader({ terminal = false, onSettings }: {
  terminal?: boolean; onSettings?: () => void;
}) {
  const { t } = useLanguage();
  const { s } = useStocksText();
  return <header className="vxo-original-header">
    <Link to="/" className="vxo-original-brand" aria-label={s('VOLTEX — главная')}>
      <span><Activity size={22} aria-hidden="true" /></span><strong>VOLTEX</strong>
    </Link>
    <nav aria-label={s('Навигация Stocks')}>
      <Link to="/trade">Spot</Link><Link to="/futures">{t('nav.futures')}</Link>
      <Link to="/trade?market=cfd">CFD</Link><Link to="/stocks" aria-current="page">{s('Акции')}</Link>
      <Link to="/wallet">{t('nav.wallet')}</Link>
    </nav>
    <div className="vxo-original-actions">
      {terminal && <Link className="vxo-original-back" to="/stocks"><ArrowLeft size={15} aria-hidden="true" />{s('Акции')}</Link>}
      {onSettings && <button type="button" onClick={onSettings} aria-label={s('Параметры счёта')} title={s('Параметры счёта')}><Settings2 size={17} aria-hidden="true" /></button>}
      <LanguageSwitcher />
    </div>
  </header>;
}
