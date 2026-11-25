import { useId, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Strategy, TimeframeKey } from "../../types/strategy";

const money = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("ru-RU", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const terms = [
  [1, "Месяц"],
  [3, "Три месяца"],
  [12, "Год"],
  [24, "Два года"],
] as const;
const windows: TimeframeKey[] = ["7D", "30D", "90D", "1Y", "ALL"];
import { scenarioCapital } from "../../../../lib/thomasScenario";
export function ThomasCalculator({ strategy }: { strategy: Strategy }) {
  const [principal, setPrincipal] = useState("5000"),
    [rate, setRate] = useState("1"),
    [months, setMonths] = useState(12);
  const [mode, setMode] = useState<"scenario" | "history">("scenario"),
    [period, setPeriod] = useState<TimeframeKey>("30D");
  const id = useId().replace(/:/g, "");
  const initial = Number(principal),
    historical = mode === "history" && !!strategy.verified;
  const record = historical ? strategy.verified?.periods[period] : null;
  const calculated =
    record && principal.trim() && Number.isFinite(initial) && initial >= 0.01
      ? record.series.map((r, i) => ({
          label:
            i === 0
              ? "Старт"
              : (record.observationDates?.[i - 1] ?? "Шаг " + i),
          capital: initial * (1 + r / 100),
        }))
      : !historical && rate.trim() && principal.trim()
        ? scenarioCapital(initial, Number(rate.replace(",", ".")), months)
        : [];
  const series = calculated.every(point => Number.isFinite(point.capital)) ? calculated : [];
  const closing = series[series.length - 1]?.capital,
    delta = closing === undefined ? null : closing - initial;
  return (
    <section
      className="th-panel th-calculator"
      aria-label="Инвестиционный калькулятор"
    >
      <header>
        <h2>Инвестиционный калькулятор</h2>
        <p>
          Оцените потенциальный результат при различных сценариях доходности.
        </p>
      </header>
      {strategy.verified && (
        <div className="th-options">
          {(["scenario", "history"] as const).map((m) => (
            <button
              key={m}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              {m === "scenario" ? "Сценарий" : "Подтверждённая история"}
            </button>
          ))}
        </div>
      )}
      <div className="th-calc-grid">
        <div className="th-controls">
          <label>
            Сумма инвестиции, USDT
            <input
              inputMode="decimal"
              type="number"
              min="0.01"
              step="any"
              value={principal}
              onChange={(e) => setPrincipal(e.target.value)}
            />
          </label>
          <div className="th-options">
            {[2500, 5000, 10000, 25000, 50000].map((n) => (
              <button
                key={n}
                aria-pressed={initial === n}
                onClick={() => setPrincipal(String(n))}
              >
                {money.format(n)}
              </button>
            ))}
          </div>
          <span className="th-label">Период</span>
          <div className="th-options">
            {historical
              ? windows.map((k) => (
                  <button
                    key={k}
                    aria-pressed={period === k}
                    onClick={() => setPeriod(k)}
                  >
                    {k}
                  </button>
                ))
              : terms.map(([n, t]) => (
                  <button
                    key={n}
                    aria-pressed={months === n}
                    onClick={() => setMonths(n)}
                  >
                    {t}
                  </button>
                ))}
          </div>
          {!historical && (
            <label>
              Предполагаемая доходность в месяц, %
              <input
                type="number"
                inputMode="decimal"
                min="-100"
                step="any"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </label>
          )}
          <small>
            Минимальная сумма подключения стратегии —{" "}
            {money.format(strategy.minInvestmentUsdt)} USDT. Калькулятор
            доступен для любой суммы от 0,01 USDT.
          </small>
        </div>
        <div className="th-output">
          <div className="th-values" aria-live="polite">
            {[
              ["Начальный капитал", series.length ? initial : null],
              ["Расчётный результат", delta],
              ["Конечный капитал", closing],
            ].map(([label, n]) => (
              <div key={label}>
                <small>{label}</small>
                <strong
                  data-negative={(typeof n === "number" && n < 0) || undefined}
                >
                  {typeof n === "number"
                    ? (label === "Расчётный результат" && n > 0 ? "+" : "") +
                      money.format(n)
                    : "—"}
                </strong>
                <small>USDT</small>
              </div>
            ))}
          </div>
          {series.length > 0 ? (
            <div
              role="img"
              aria-label="График изменения капитала"
              className="th-capital-chart"
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={series}
                  margin={{ top: 12, right: 16, bottom: 0, left: 0 }}
                >
                  <defs>
                    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="#35836b"
                        stopOpacity={0.27}
                      />
                      <stop
                        offset="100%"
                        stopColor="#35836b"
                        stopOpacity={0.025}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    vertical={false}
                    stroke="var(--chart-grid)"
                    strokeDasharray="3 4"
                  />
                  <XAxis
                    dataKey="label"
                    minTickGap={40}
                    tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
                  />
                  <YAxis
                    domain={["auto", "auto"]}
                    width={56}
                    tickFormatter={(n) => compact.format(n)}
                    tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
                  />
                  <Tooltip
                    formatter={(n) => [
                      money.format(Number(n)) + " USDT",
                      "Капитал",
                    ]}
                    contentStyle={{
                      background: "var(--bg-surface)",
                      color: "var(--text-primary)",
                      borderColor: "var(--border-subtle)",
                    }}
                  />
                  <Area
                    type="linear"
                    dataKey="capital"
                    stroke="var(--text-teal)"
                    strokeWidth={2.5}
                    fill={"url(#" + id + ")"}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p role="status">
              Проверьте сумму, ставку и числовой диапазон результата. Минимальная сумма — 0,01 USDT, минимальная ставка — −100%.
            </p>
          )}
        </div>
      </div>
      {record ? (
        <small>
          Исторический расчёт за {record.firstDate} — {record.lastDate}.{" "}
          {strategy.verified?.marketScope === "XRP/USDT"
            ? "Источник за этот период — XRP/USDT. "
            : ""}
          К начальному капиталу применён дневной индекс TWR с реинвестированием,
          без пополнений. Комиссии исходной истории:{" "}
          {record.fees === null
            ? "разбивка недоступна"
            : money.format(record.fees) + " USDT"}
          . Дополнительные комиссии и налоги не начисляются.
        </small>
      ) : (
        <small>
          Иллюстрация по вашей ставке с ежемесячным реинвестированием. Комиссии,
          налоги и пополнения исключены. Фактическая доходность может
          отличаться.
        </small>
      )}
    </section>
  );
}
