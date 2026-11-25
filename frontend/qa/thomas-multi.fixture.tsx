// Browser-only fixture. This entry is not part of the application or its routes.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { catalogue } from "../src/pages/quant-marketplace/data/catalogue";
import { FlagshipThomasSection } from "../src/pages/quant-marketplace/components/marketplace/FlagshipThomasSection";
import { StrategyProfileView } from "../src/pages/quant-marketplace/components/profile/StrategyProfileView";

const original = catalogue(0, {}, false).find((s) => s.id === "range")!;
const months = original.monthly24.map((m, i) => ({
  ...m,
  returnPct: i === 23 ? 310 : 306,
}));
const cumulative = months.reduce<number[]>(
  (a, m) => [...a, a[a.length - 1] + m.returnPct],
  [0],
);
const history = cumulative.map((value, i) => ({
  date: "Месяц " + i,
  value,
  drawdown: 0,
}));
function Fixture() {
  const [winRate, setRate] = useState(97.1);
  const strategy = {
    ...original,
    winRate,
    monthly24: months,
    return30d: 310,
    return1yArithmetic: 3676,
    returnAllArithmetic: cumulative[24],
    series: {
      ...original.series,
      "7D": original.series["7D"].map((p) => ({
        ...p,
        value: (p.value * 310) / original.return30d,
      })),
      "30D": original.series["30D"].map((p) => ({
        ...p,
        value: (p.value * 310) / original.return30d,
      })),
      "90D": history
        .slice(-4)
        .map((p) => ({ ...p, value: p.value - history[21].value })),
      "1Y": history
        .slice(-13)
        .map((p) => ({ ...p, value: p.value - history[12].value })),
      ALL: history,
    },
  };
  return (
    <main className="quant-skin light" data-quant-theme="light">
      <h1>Изолированная проверка числового формата</h1>
      {[95.3, 97.1, 98.2].map((x) => (
        <button key={x} onClick={() => setRate(x)}>
          {x}
        </button>
      ))}
      <FlagshipThomasSection strategy={strategy} leads30d={false} onOpenProfile={() => {}} />
      <StrategyProfileView
        strategy={strategy}
        allStrategies={[strategy]}
        onBack={() => {}}
        onSelectStrategy={() => {}}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
