export function CfdPositionsPanel({_refreshKey}:{refreshKey:number}){
  return <section className="cfd-data-coverage" aria-label="Market data coverage">
    <div className="cfd-data-coverage-title"><strong>Market data coverage</strong><span>13 instruments · multi-source</span></div>
    <div className="cfd-data-coverage-grid">
      <div><b>Metals</b><span>XAU · XAG · XPT · XPD</span></div>
      <div><b>Energy</b><span>WTI · Brent</span></div>
      <div><b>FX majors</b><span>EUR · GBP · JPY · AUD · CAD · CHF · NZD</span></div>
      <div><b>Resilience</b><span>Primary + reserve + last verified quote</span></div>
    </div>
    <p>Prices are display data only. VOLTEX switches sources automatically and never fills a missing quote with an estimated value.</p>
  </section>;
}
