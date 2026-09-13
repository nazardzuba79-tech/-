import { cfdMarketCopy } from '../lib/cfdPresentation';
import { useLanguage } from '../lib/i18n';

export function CfdPositionsPanel(_props:{refreshKey:number}){
  const{lang}=useLanguage(),copy=cfdMarketCopy(lang);
  return <section className="cfd-data-coverage" aria-label={copy.dataCoverage}>
    <div className="cfd-data-coverage-title"><strong>{copy.dataCoverage}</strong><span>{copy.instrumentsMulti}</span></div>
    <div className="cfd-data-coverage-grid">
      <div><b>{copy.metals}</b><span>XAU · XAG · XPT · XPD</span></div>
      <div><b>{copy.energy}</b><span>WTI · Brent</span></div>
      <div><b>{copy.fxMajors}</b><span>EUR · GBP · JPY · AUD · CAD · CHF · NZD</span></div>
      <div><b>{copy.resilience}</b><span>{copy.primaryReserve}</span></div>
    </div>
    <p>{copy.displayOnly}</p>
  </section>;
}
