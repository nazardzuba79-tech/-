import { useCallback, useMemo, useState } from 'react';
import { ArrowDownUp, BookOpen, Calculator } from 'lucide-react';
import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';
import { ArbitrageWorkspace } from './arbitrage/ArbitrageWorkspace';
import { ArbitrageDialog } from './arbitrage/ArbitrageDialog';
import { ArbitrageEducation, type Strategy } from './arbitrage/ArbitrageEducation';
import { computeArbitrage, createForm, resetForm, selectPair, type FormState, type NumericField, type Scenario } from './arbitrage/model';
import { OtcProductTabs } from './otc/OtcProductTabs';
import './arbitrage/arbitrage.css';

/** Local comparison workspace. Shared Nav/auth is retained; no market feed is mounted. */
export function ArbitragePage() {
  const [form, setForm] = useState<FormState>(() => createForm());
  const [detail, setDetail] = useState<FormState | null>(null);
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const result = useMemo(() => computeArbitrage(form), [form]);
  const update = useCallback((field: NumericField, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  }, []);
  const applyScenario = useCallback((scenario: Scenario) => {
    setForm((current) => createForm(scenario, current.budget));
  }, []);
  const closeDialog = useCallback(() => { setDetail(null); setStrategy(null); }, []);

  return <>
    <Nav active="/arbitrage" hideTicker />
    <main className="arbitrage-page" data-testid="arbitrage-page" lang="ru">
      <OtcProductTabs active="arbitrage" />
      <div className="arb-container">
        <section className="arb-hero" aria-labelledby="arb-title">
          <img className="arb-hero-globe" src="/arbitrage/voltex-globe.webp" alt="" width="1376" height="768" />
          <div className="arb-hero-copy">
            <span className="arb-eyebrow">VOLTEX · АРБИТРАЖ</span>
            <h1 id="arb-title">Арбитраж криптовалют</h1>
            <p>Сравнивайте сценарии. Учитывайте расходы.<br className="arb-desktop-break" /> Оценивайте результат.</p>
            <div className="arb-benefits">
              <span><ArrowDownUp size={17} aria-hidden="true" />Арбитражные сценарии</span>
              <span><Calculator size={17} aria-hidden="true" />Оценка результата</span>
              <span><BookOpen size={17} aria-hidden="true" />Разбор комиссий и рисков</span>
            </div>
          </div>
        </section>
        <ArbitrageWorkspace form={form} result={result} update={update}
          onPairChange={(pair) => setForm((current) => selectPair(current, pair))}
          onSelect={applyScenario} onReset={() => setForm(resetForm())}
          onScenarioDetail={(scenario) => setDetail(createForm(scenario))}
          onFormDetail={() => setDetail({ ...form })} />
        <ArbitrageEducation onStrategy={setStrategy} />
      </div>
    </main>
    <Footer />
    {(detail || strategy) && <ArbitrageDialog form={detail} strategy={strategy} onClose={closeDialog} />}
  </>;
}
