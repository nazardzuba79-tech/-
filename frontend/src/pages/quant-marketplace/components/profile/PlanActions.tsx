import { useState } from "react";
import { validBotBudget } from "../../../../lib/tradingBotsPresentation";
import type { Strategy } from "../../types/strategy";
const favoritesKey = "voltex.bot-catalogue.favorites.v1";
function favorites(): string[] {
  try {
    const data: unknown = JSON.parse(
      localStorage.getItem(favoritesKey) ?? "[]",
    );
    return Array.isArray(data) ? data.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
export function PlanActions({ strategy }: { strategy: Strategy }) {
  const [saved, setSaved] = useState(() => favorites().includes(strategy.id));
  const [budget, setBudget] = useState(String(strategy.minInvestmentUsdt));
  const [open, setOpen] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const valid = validBotBudget(budget, strategy.minInvestmentUsdt);
  function favorite() {
    const items = new Set(favorites());
    if (items.has(strategy.id)) items.delete(strategy.id);
    else items.add(strategy.id);
    try {
      localStorage.setItem(favoritesKey, JSON.stringify([...items]));
      setSaved(items.has(strategy.id));
    } catch {}
  }
  return (
    <div className="quant-filter">
      <button type="button" aria-pressed={saved} onClick={favorite}>
        {saved ? "★ В избранном" : "☆ В избранное"}
      </button>
      {Number.isFinite(strategy.minInvestmentUsdt) && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          Личный план
        </button>
      )}
      {open && (
        <div>
          <label>
            Планируемая инвестиция{" "}
            <input
              inputMode="decimal"
              value={budget}
              onChange={(e) => {
                setBudget(e.target.value);
                setConfirmed(false);
              }}
            />{" "}
            USDT
          </label>
          <button
            type="button"
            disabled={!valid}
            onClick={() => setConfirmed(true)}
          >
            Рассчитать
          </button>
          {confirmed && (
            <p>
              {strategy.name} · {budget} USDT · локальный план без исполнения
            </p>
          )}
        </div>
      )}
    </div>
  );
}
