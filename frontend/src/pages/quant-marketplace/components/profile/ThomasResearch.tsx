import { useEffect, useState } from "react";
import {
  Activity,
  BrainCircuit,
  ChartNoAxesCombined,
  Layers3,
  Network,
  PieChart,
  ShieldCheck,
} from "lucide-react";
import { request } from "../../../../lib/api";
import type { Strategy } from "../../types/strategy";

type Coverage =
  | { status: "unavailable" }
  | {
      status: "connected";
      assets: number;
      asOf: string;
      advancing: number;
      declining: number;
    };
const modules = [
  {
    title: "Multi-Asset Intelligence",
    icon: Network,
    detail:
      "Единая лента VOLTEX поставляет спотовые котировки. До 100 активов с актуальными данными отбираются по обороту в USDT.",
    ready: true,
  },
  {
    title: "Quantitative Research",
    icon: ChartNoAxesCombined,
    detail:
      "Рассчитывается ширина рынка: сколько отобранных активов выросло и снизилось за 24 часа.",
    ready: true,
  },
  {
    title: "Machine Learning",
    icon: BrainCircuit,
    detail:
      "Предусмотрено подключение обученных моделей и проверка их качества на данных вне обучающей выборки.",
  },
  {
    title: "Market Regime Detection",
    icon: Activity,
    detail:
      "Запланирована классификация трендовых, боковых и волатильных состояний рынка.",
  },
  {
    title: "Dynamic Risk Management",
    icon: ShieldCheck,
    detail:
      "Планируется учитывать волатильность и корреляции при распределении риска.",
  },
  {
    title: "Portfolio Optimization",
    icon: PieChart,
    detail:
      "В проекте — подбор долей активов с учётом концентрации, ликвидности и общего риска портфеля.",
  },
];
export function ThomasResearch({ summary }: { summary: string }) {
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  useEffect(() => {
    let current: AbortController | undefined;
    const refresh = () => {
      if (document.hidden) {
        current?.abort();
        return;
      }
      current?.abort();
      const controller = new AbortController();
      current = controller;
      request<Coverage>("/trading-bots/range/coverage", {
        signal: controller.signal,
      })
        .then((data) => {
          if (!controller.signal.aborted) setCoverage(data);
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setCoverage({ status: "unavailable" });
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 45_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      current?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return (
    <section className="th-panel">
      <header>
        <h2>Архитектура стратегии Thomas Quant AI</h2>
        <p>{summary}</p>
      </header>
      <div className="th-research-grid">
        {modules.map(({ title, detail, icon: Icon, ready }, i) => (
          <article key={title}>
            <Icon aria-hidden size={22} />
            <small>{ready ? "Реализовано" : "Запланировано"}</small>
            <h3>{"0" + (i + 1) + ". " + title}</h3>
            <p>{detail}</p>
          </article>
        ))}
      </div>
      <div className="th-coverage">
        <Layers3 aria-hidden size={19} />
        <div>
          <h3>Покрытие рыночных данных</h3>
          {coverage?.status === "connected" ? (
            <p>
              Активов в расчёте: {coverage.assets}. Рост за 24 ч:{" "}
              {coverage.advancing} · Снижение: {coverage.declining}. Срез на{" "}
              {new Date(coverage.asOf).toLocaleString("ru-RU")}.
            </p>
          ) : (
            <p>
              {coverage
                ? "Свежие данные общей ленты недоступны."
                : "Загрузка данных общей ленты…"}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
const fmt = (n: number) =>
  n.toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + "%";
export function ThomasPortfolio({ strategy }: { strategy: Strategy }) {
  const data = strategy.verified?.portfolio;
  return (
    <section className="th-panel">
      <header>
        <h2>Портфельная экспозиция</h2>
        <p>
          {data
            ? "Распределение по активам на " +
              new Date(data.asOf).toLocaleString("ru-RU") +
              ". Доли рассчитаны от собственного капитала."
            : "Распределение по активам и экспозиция появятся после получения подтверждённого снимка позиций стратегии."}
        </p>
      </header>
      {data && (
        <>
          <div className="th-values">
            <div>
              <small>Валовая экспозиция</small>
              <strong>{fmt(data.grossPct)}</strong>
            </div>
            <div>
              <small>Чистая экспозиция</small>
              <strong data-negative={data.netPct < 0 || undefined}>
                {fmt(data.netPct)}
              </strong>
            </div>
          </div>
          {data.weights.length ? (
            <ul className="th-holdings">
              {data.weights.map((p) => (
                <li key={p.asset}>
                  <span>{p.asset}</span>
                  <strong>{fmt(p.pct)}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p>Открытых позиций на дату снимка нет.</p>
          )}
        </>
      )}
    </section>
  );
}
