import React, { useState } from 'react';
import { Header } from './components/Header';
import { PageIntro } from './components/PageIntro';
import { DerivativesStrip, MarketKpiStrip } from './components/SummaryStrips';
import { MarketRegime } from './components/MarketRegime';
import { MarketNarrative } from './components/MarketNarrative';
import { LiquidationMap } from './components/LiquidationMap';
import { LiquidityClusters, NearestStructure } from './components/LiquidityStructure';
import { CascadeRisk, FundingPressure, LeveragePressure, LongShortRatio, OpenInterestStructure } from './components/DerivativesPanels';
import { PriceOpenInterest } from './components/PriceOpenInterest';
import { FuturesBasis, LargeLiquidationsTable, MarketBreadth, MarketStructurePanel, Volatility } from './components/StructurePanels';
import { FundingRates } from './components/FundingRates';
import { EtfFlows, ExchangeFlows, WhaleActivity } from './components/FlowPanels';
import { Anomalies, CorrelationMatrix, FearGreed, Movers, Sectors } from './components/MarketContextPanels';
import { SectionLabel } from './components/SectionLabel';
import { largeLiquidations } from './data/liquidations';

export function App() {
  const [context, setContext] = useState('Обзор');
  return (
    <div className="min-h-full w-full bg-canvas">
      <Header />
      <main className="mx-auto max-w-[1560px] px-6 pb-16 pt-8">
        <PageIntro context={context} onContextChange={setContext} />
        <div className="mt-4 space-y-4">
          <MarketKpiStrip /><DerivativesStrip /><MarketRegime /><MarketNarrative />
          <SectionLabel label="Ликвидность и ликвидации" note="Окно 12ч · ±4% вокруг цены" />
          <LiquidationMap />
          <div className="grid gap-4 lg:grid-cols-3"><NearestStructure /><div className="lg:col-span-2"><LiquidityClusters /></div></div>
          <LargeLiquidationsTable rows={largeLiquidations} />
          <SectionLabel label="Деривативы и леверидж" note="Источник: CoinGlass" />
          <div className="grid gap-4 lg:grid-cols-3"><OpenInterestStructure /><FundingPressure /><CascadeRisk /></div>
          <div className="grid gap-4 lg:grid-cols-3"><div className="lg:col-span-2"><PriceOpenInterest /></div><div className="grid gap-4"><LongShortRatio /><LeveragePressure /></div></div>
          <SectionLabel label="Структура рынка" note="Источник: CoinGecko" />
          <div className="grid gap-4 lg:grid-cols-4"><div className="lg:col-span-2"><MarketStructurePanel /></div><Volatility /><MarketBreadth /></div>
          <div className="grid gap-4 lg:grid-cols-4"><FuturesBasis /><div className="lg:col-span-3"><FundingRates /></div></div>
          <SectionLabel label="Потоки капитала" note="ETF · биржи · крупные держатели" />
          <div className="grid gap-4 lg:grid-cols-3"><EtfFlows /><ExchangeFlows /><WhaleActivity /></div>
          <SectionLabel label="Контекст рынка" />
          <div className="grid gap-4 lg:grid-cols-3"><div className="lg:col-span-2"><CorrelationMatrix /></div><FearGreed /></div>
          <div className="grid gap-4 lg:grid-cols-3"><div className="lg:col-span-2"><Sectors /></div><Movers /></div>
          <Anomalies />
        </div>
      </main>
    </div>
  );
}
