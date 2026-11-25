import { ThomasCalculator } from "./ThomasCalculator";
import { ThomasPortfolio, ThomasResearch } from "./ThomasResearch";
import { ThomasAuthor } from "./ThomasAuthor";
import { PlanActions } from "./PlanActions";
import { numberText, percent } from "../../data/catalogue";
import React, { useMemo, useState } from "react";
import {
  ArrowLeft,
  Award,
  BarChart3,
  Calendar,
  FileText,
  Info,
  Layers,
  ShieldCheck,
  User,
} from "lucide-react";
import type { Strategy, TimeframeKey } from "../../types/strategy";
import {
  DistributionChart,
  MonthlyBarChart,
  TerminalPerformanceChart,
} from "../charts/StrategyCharts";
import { StrategyLogo } from "../logos/StrategyLogos";
import { NeuralWebOverlay } from "../background/NeuralWebOverlay";

type ProfileTab = "overview" | "statistics" | "monthly" | "about" | "author";

interface StrategyProfileViewProps {
  readOnly?: boolean;
  strategy: Strategy;
  allStrategies: Strategy[];
  onBack: () => void;
  onSelectStrategy: (strategyId: string) => void;
}

const PERIOD_KEYS: TimeframeKey[] = ["7D", "30D", "90D", "1Y", "ALL"];

export const StrategyProfileView: React.FC<StrategyProfileViewProps> = ({
  strategy,
  allStrategies,
  onBack,
  onSelectStrategy,
  readOnly = false,
}) => {
  const [activeTab, setActiveTab] = useState<ProfileTab>("overview");
  const [chartPeriod, setChartPeriod] = useState<TimeframeKey>("30D");
  const [selectedYear, setSelectedYear] = useState<1 | 2>(2);
  const [showBenchmark, setShowBenchmark] = useState(true);

  const isThomas = strategy.id === "range";
  const activeSeries = strategy.series[chartPeriod];
  const periodStats = strategy.verified?.periods[chartPeriod];
  const [calendarYear, setCalendarYear] = useState<number | null>(null);
  const years = strategy.verified?.monthly.years ?? [];
  const currentYear =
    calendarYear !== null && years.includes(calendarYear)
      ? calendarYear
      : years[years.length - 1];
  const calendarEntries = strategy.monthly24.filter(
    (m) => m.year === currentYear,
  );
  const yearTotal = strategy.verified?.monthly.cells[String(currentYear)];

  const currentPeriodReturn =
    activeSeries[activeSeries.length - 1]?.value ?? NaN;

  const months1 = useMemo(
    () => strategy.monthly24.filter((m) => m.year === 1),
    [strategy.monthly24],
  );
  const months2 = useMemo(
    () => strategy.monthly24.filter((m) => m.year === 2),
    [strategy.monthly24],
  );

  const yearStats = useMemo(() => {
    const calc = (list: typeof months1) => {
      const arith = list.reduce((acc, m) => acc + m.returnPct, 0);

      const positive = list.filter((m) => m.returnPct > 0).length;
      const best = Math.max(...list.map((m) => m.returnPct));
      const worst = Math.min(...list.map((m) => m.returnPct));
      const trades = list.reduce((acc, m) => acc + m.tradesCount, 0);
      const maxDd = Math.min(...list.map((m) => m.maxDrawdownPct));
      return {
        arith: Math.round(arith * 100) / 100,
        positive,
        best,
        worst,
        trades,
        maxDd,
      };
    };
    return {
      y1: calc(months1),
      y2: calc(months2),
    };
  }, [months1, months2]);

  const activeYearEntries = selectedYear === 2 ? months2 : months1;
  const activeYearSummary = selectedYear === 2 ? yearStats.y2 : yearStats.y1;

  const otherStrategies = allStrategies
    .filter((s) => s.id !== strategy.id)
    .slice(0, 3);

  const tabs: { id: ProfileTab; label: string; icon: React.ReactNode }[] = [
    {
      id: "overview",
      label: "Обзор",
      icon: <Layers className="w-3.5 h-3.5" />,
    },
    {
      id: "statistics",
      label: "Статистика",
      icon: <BarChart3 className="w-3.5 h-3.5" />,
    },
    {
      id: "monthly",
      label: "Помесячная доходность",
      icon: <Calendar className="w-3.5 h-3.5" />,
    },
    {
      id: "about",
      label: "О стратегии",
      icon: <FileText className="w-3.5 h-3.5" />,
    },
    { id: "author", label: "Автор", icon: <User className="w-3.5 h-3.5" /> },
  ];

  const getHeatmapStyle = (val: number) => {
    if (val >= 9)
      return "bg-[#D4AF6A]/20 dark:bg-[#D4AF6A]/25 border-[#B88933]/50 dark:border-[#D4AF6A]/55 text-[#7A5614] dark:text-[#F5DFB0]";
    if (val >= 5)
      return "bg-emerald-500/15 dark:bg-[#10B981]/22 border-emerald-600/35 dark:border-[#10B981]/45 text-emerald-800 dark:text-[#6EE7B7]";
    if (val >= 0)
      return "bg-teal-500/10 dark:bg-[#2DD4BF]/12 border-teal-600/25 dark:border-[#2DD4BF]/30 text-teal-800 dark:text-[#99F6E4]";
    if (val > -3)
      return "bg-red-500/10 dark:bg-[#EF4444]/14 border-red-500/25 dark:border-[#EF4444]/30 text-red-700 dark:text-[#FCA5A5]";
    return "bg-red-500/18 dark:bg-[#EF4444]/26 border-red-600/40 dark:border-[#EF4444]/50 text-red-800 dark:text-[#FECACA]";
  };

  return (
    <div className="max-w-[1600px] mx-auto px-3 sm:px-6 py-5 sm:py-7">
      {/* Top Breadcrumb / Back Action */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Назад к маркетплейсу</span>
        </button>

        <div className="text-xs text-[var(--text-muted)]">
          <span>VOLTEX Quant Marketplace</span>
          <span className="mx-1.5 opacity-40">/</span>
          <span className="text-[var(--text-primary)] font-medium">
            {strategy.name}
          </span>
        </div>
      </div>

      {/* Institutional Strategy Header */}
      <div
        className={`relative rounded-2xl overflow-hidden border shadow-xs mb-6 ${
          isThomas
            ? "border-[var(--border-gold)]"
            : "bg-[var(--bg-surface)] border-[var(--border-subtle)]"
        }`}
        style={
          isThomas
            ? {
                background:
                  "linear-gradient(135deg, var(--bg-thomas-from) 0%, var(--bg-thomas-via) 55%, var(--bg-thomas-to) 100%)",
              }
            : undefined
        }
      >
        <NeuralWebOverlay variant={isThomas ? "gold" : "teal"} />
        {isThomas && (
          <div className="relative z-10 h-[2px] w-full bg-gradient-to-r from-[#C59B47] via-[#14B8A6] to-[#C59B47]/30" />
        )}

        <div className="relative z-10 p-4 sm:p-6 lg:p-7">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex items-start gap-4 min-w-0">
              <StrategyLogo
                strategyId={strategy.logoId ?? strategy.id}
                customLogo={strategy.logoUrl}
                size={64}
                className="shrink-0 shadow-sm"
              />
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {strategy.isFeatured && (
                    <span className="inline-flex items-center gap-1 font-semibold text-[var(--text-gold)]">
                      <Award className="w-3.5 h-3.5" />
                      <span>Избранная стратегия</span>
                    </span>
                  )}
                  {strategy.isFeatured && (
                    <span className="text-[var(--text-muted)] opacity-50">
                      ·
                    </span>
                  )}
                  {strategy.isVip && (
                    <>
                      <span className="inline-flex items-center gap-1 text-[var(--text-teal)] font-medium">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>VIP-статус</span>
                      </span>
                      <span className="text-[var(--text-muted)] opacity-50">
                        ·
                      </span>
                    </>
                  )}
                  <span className="font-mono text-[var(--text-primary)] font-medium">
                    {strategy.market}
                  </span>
                  <span className="text-[var(--text-muted)] opacity-50">·</span>
                  <span className="text-[var(--text-secondary)]">
                    {strategy.category}
                  </span>
                  <span className="text-[var(--text-muted)] opacity-50">·</span>
                  <span className="text-[var(--text-muted)]">
                    Риск: {strategy.risk}
                  </span>
                </div>

                <h1 className="font-display text-2xl sm:text-3xl font-bold text-[var(--text-primary)]">
                  {strategy.name}
                </h1>

                <p className="text-xs sm:text-sm text-[var(--text-secondary)] max-w-3xl leading-relaxed">
                  {strategy.shortDescription}
                </p>
              </div>
            </div>

            {/* Creator Profile Mini-Lockup + Min Investment */}
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-4 lg:gap-6 shrink-0 pt-3 lg:pt-0 border-t lg:border-t-0 border-[var(--border-subtle)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#D4AF6A]/30 to-[#14B8A6]/20 border border-[var(--border-gold)] flex items-center justify-center font-display font-bold text-sm text-[var(--text-gold)]">
                  {strategy.avatar ? (
                    <img
                      src={strategy.avatar}
                      alt=""
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        borderRadius: "50%",
                      }}
                    />
                  ) : (
                    strategy.author.charAt(0)
                  )}
                </div>
                <div>
                  <div className="text-[11px] text-[var(--text-muted)]">
                    Автор стратегии
                  </div>
                  <div className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                    <span>{strategy.author}</span>
                    {strategy.isVip && (
                      <span className="text-[10px] font-mono text-[var(--text-gold)]">
                        VIP
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="h-8 w-px bg-[var(--border-subtle)] hidden sm:block" />

              <div>
                <div className="text-[11px] text-[var(--text-muted)]">
                  Мин. инвестиция
                </div>
                <div className="font-mono text-base font-semibold text-[var(--text-primary)] tabular-nums">
                  {numberText(strategy.minInvestmentUsdt, 0)} USDT
                </div>
              </div>
            </div>
          </div>

          {!readOnly && <div className="text-xs text-[var(--text-secondary)]">
            {strategy.source === "verified"
              ? "Подтверждённая торговая история"
              : strategy.source === "model"
                ? "Модельная статистика"
                : "История отсутствует"}
          </div>}
          {!readOnly && <PlanActions strategy={strategy} />}
          {/* 5 Analytics Terminal Tabs */}
          <div className="mt-6 pt-4 border-t border-[var(--border-subtle)] flex items-center gap-1.5 overflow-x-auto pb-1">
            {tabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-[13px] font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    active
                      ? "bg-[#D4AF6A]/18 text-[var(--text-gold)] border border-[var(--border-gold)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] border border-transparent"
                  }`}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* TAB 1: ОБЗОР */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* 6 KPI Blocks */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4">
              <div className="text-[11px] text-[var(--text-muted)]">
                Доходность за 30 дней
              </div>
              <div className="font-mono text-xl font-bold text-[var(--text-teal)] tabular-nums mt-1">
                {percent(strategy.return30d, true)}
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-1">
                {strategy.source === "model"
                  ? "Модельное окно 30Д"
                  : "Период 30Д"}
              </div>
            </div>

            <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4">
              <div className="text-[11px] text-[var(--text-muted)]">
                Годовой результат
              </div>
              <div className="font-mono text-xl font-bold text-[var(--text-gold)] tabular-nums mt-1">
                {percent(strategy.return1yArithmetic, true)}
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-1">
                {strategy.source === "model"
                  ? "Сумма условных месяцев"
                  : "ROI за год"}
              </div>
            </div>

            <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4">
              <div className="text-[11px] text-[var(--text-muted)]">
                Результат за весь период
              </div>
              <div className="font-mono text-xl font-bold text-[var(--text-primary)] tabular-nums mt-1">
                {percent(strategy.returnAllArithmetic, true)}
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-1">
                {strategy.source === "model"
                  ? "Сумма условных месяцев"
                  : "ROI с начала стратегии"}
              </div>
            </div>

            <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4">
              <div className="text-[11px] text-[var(--text-muted)]">
                Максимальная просадка
              </div>
              <div className="font-mono text-xl font-bold text-[var(--text-crimson)] tabular-nums mt-1">
                {percent(strategy.maxDrawdown, false)}
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-1">
                Пик-дно модели
              </div>
            </div>

            <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4">
              <div className="text-[11px] text-[var(--text-muted)]">
                Прибыльные сделки
              </div>
              <div className="font-mono text-xl font-bold text-[var(--text-emerald)] tabular-nums mt-1">
                {percent(strategy.winRate, false)}
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-1">
                Win Rate модели
              </div>
            </div>

            <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4">
              <div className="text-[11px] text-[var(--text-muted)]">
                Количество сделок
              </div>
              <div className="font-mono text-xl font-bold text-[var(--text-primary)] tabular-nums mt-1">
                {numberText(strategy.tradesCount, 0)}
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-1">
                За 30 дней
              </div>
            </div>
          </div>

          {/* Main Interactive Performance Terminal Chart */}
          <div className="relative overflow-hidden rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-xs p-4 sm:p-6">
            <NeuralWebOverlay variant="subtle" />
            <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
              <div>
                <div className="text-xs text-[var(--text-muted)]">
                  Динамика доходности ({strategy.market})
                </div>
                <div className="flex items-baseline gap-3 mt-1">
                  <span className="font-mono text-2xl sm:text-3xl font-bold tabular-nums text-[var(--text-teal)]">
                    <output
                      data-period={chartPeriod}
                      data-count={activeSeries.length}
                      data-return={currentPeriodReturn}
                    >
                      {percent(currentPeriodReturn, true)}
                    </output>
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    за период {chartPeriod} · {strategy.behaviorTag}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  hidden={!activeSeries.some((p) => p.benchmark !== undefined)}
                  onClick={() => setShowBenchmark((v) => !v)}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition-colors cursor-pointer ${
                    showBenchmark
                      ? "border-[var(--border-strong)] bg-[var(--bg-subtle)] text-[var(--text-primary)]"
                      : "border-[var(--border-subtle)] text-[var(--text-muted)]"
                  }`}
                >
                  {showBenchmark
                    ? "Скрыть ориентир рынка"
                    : "Показать ориентир рынка"}
                </button>

                <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
                  {PERIOD_KEYS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={chartPeriod === p}
                      onClick={() => setChartPeriod(p)}
                      className={`px-2.5 py-1 rounded text-xs font-mono font-medium transition-colors cursor-pointer ${
                        chartPeriod === p
                          ? "bg-[var(--bg-surface)] text-[var(--text-gold)] border border-[var(--border-gold)] shadow-xs"
                          : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="relative z-10">
              <TerminalPerformanceChart
                data={activeSeries}
                accentColor={strategy.accentColor}
                secondaryColor={strategy.secondaryColor}
                showBenchmark={showBenchmark}
                height={340}
              />
            </div>

            <div className="relative z-10 mt-4 pt-3 border-t border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
              {!readOnly && <span>
                {strategy.verified
                  ? "Подтверждённая история. ROI учитывает денежные потоки. Данные на " +
                    strategy.verified.asOf.slice(0, 10) +
                    " UTC."
                  : strategy.source === "model"
                    ? "Иллюстративная модель. Для длинных периодов Thomas отображается сумма условных месячных результатов."
                    : "Данные отсутствуют."}
              </span>}
              <button
                type="button"
                onClick={() => setActiveTab("monthly")}
                className="text-[var(--text-gold)] hover:underline font-medium self-start sm:self-auto cursor-pointer"
              >
                Перейти к помесячной матрице →
              </button>
            </div>
          </div>

          {/* Quick 2-column Summary below chart */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-5">
              <h3 className="font-display text-base font-semibold text-[var(--text-primary)] mb-2">
                Логика модели и рыночный фокус
              </h3>
              <p className="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed mb-4">
                {strategy.methodologySummary}
              </p>
              <ul className="space-y-2 text-xs text-[var(--text-secondary)]">
                {strategy.architecturePoints.map((pt, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="font-mono text-[var(--text-gold)] font-semibold">
                      0{i + 1}.
                    </span>
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-5">
              <h3 className="font-display text-base font-semibold text-[var(--text-primary)] mb-2">
                Ключевые коэффициенты риска
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
                <div className="p-3 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
                  <div className="text-[11px] text-[var(--text-muted)]">
                    Sharpe Ratio
                  </div>
                  <div className="font-mono text-base font-semibold text-[var(--text-teal)] tabular-nums mt-0.5">
                    {numberText(strategy.statistics.sharpeRatio)}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
                  <div className="text-[11px] text-[var(--text-muted)]">
                    Sortino Ratio
                  </div>
                  <div className="font-mono text-base font-semibold text-[var(--text-primary)] tabular-nums mt-0.5">
                    {numberText(strategy.statistics.sortinoRatio)}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
                  <div className="text-[11px] text-[var(--text-muted)]">
                    Profit Factor
                  </div>
                  <div className="font-mono text-base font-semibold text-[var(--text-gold)] tabular-nums mt-0.5">
                    {numberText(strategy.statistics.profitFactor)}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
                  <div className="text-[11px] text-[var(--text-muted)]">
                    Calmar Ratio
                  </div>
                  <div className="font-mono text-base font-semibold text-[var(--text-primary)] tabular-nums mt-0.5">
                    {numberText(strategy.statistics.calmarRatio)}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
                  <div className="text-[11px] text-[var(--text-muted)]">
                    Recovery Factor
                  </div>
                  <div className="font-mono text-base font-semibold text-[var(--text-primary)] tabular-nums mt-0.5">
                    {numberText(strategy.statistics.recoveryFactor)}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
                  <div className="text-[11px] text-[var(--text-muted)]">
                    Волатильность (год)
                  </div>
                  <div className="font-mono text-base font-semibold text-[var(--text-secondary)] tabular-nums mt-0.5">
                    {percent(strategy.statistics.annualizedVolatility)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isThomas && activeTab === "overview" && <ThomasCalculator strategy={strategy}/>}
      {isThomas && activeTab === "statistics" && <ThomasPortfolio strategy={strategy}/>}
      {periodStats && activeTab === "overview" && (
        <div className="quant-data">
          Чистый PnL за {chartPeriod} · {numberText(periodStats.netPnl)} USDT ·
          Комиссии {numberText(periodStats.fees)} USDT · Закрытые сделки{" "}
          {periodStats.trades}
        </div>
      )}
      {activeTab === "statistics" && (
        <div className="quant-data">
          Чистый PnL за всё время ·{" "}
          {strategy.netPnl === null
            ? "—"
            : numberText(strategy.netPnl) + " USDT"}
        </div>
      )}
      {/* TAB 2: СТАТИСТИКА */}
      {activeTab === "statistics" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Financial Statistics Table */}
          <div className="lg:col-span-7 relative overflow-hidden rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-5">
            <NeuralWebOverlay variant="subtle" />
            <h2 className="relative z-10 font-display text-lg font-semibold text-[var(--text-primary)] mb-1">
              Финансовая статистика
            </h2>
            <p className="relative z-10 text-xs text-[var(--text-muted)] mb-4">
              Коэффициенты отображаются при наличии данных для расчёта.
            </p>

            <div className="relative z-10 divide-y divide-[var(--border-subtle)] text-xs sm:text-sm">
              {[
                {
                  label: "Коэффициент Шарпа (Sharpe)",
                  val: numberText(strategy.statistics.sharpeRatio),
                  accent: "text-[var(--text-teal)]",
                },
                {
                  label: "Коэффициент Сортино (Sortino)",
                  val: numberText(strategy.statistics.sortinoRatio),
                  accent: "text-[var(--text-primary)]",
                },
                {
                  label: "Коэффициент Калмара (Calmar)",
                  val: numberText(strategy.statistics.calmarRatio),
                  accent: "text-[var(--text-primary)]",
                },
                {
                  label: "Фактор прибыли (Profit Factor)",
                  val: numberText(strategy.statistics.profitFactor),
                  accent: "text-[var(--text-gold)]",
                },
                {
                  label: "Фактор восстановления (Recovery Factor)",
                  val: numberText(strategy.statistics.recoveryFactor),
                  accent: "text-[var(--text-primary)]",
                },
                {
                  label: "Годовая модельная волатильность",
                  val: `${percent(strategy.statistics.annualizedVolatility)}`,
                  accent: "text-[var(--text-secondary)]",
                },
                {
                  label: "Средняя прибыльная сделка",
                  val: `${percent(strategy.statistics.avgWinPct)}`,
                  accent: "text-[var(--text-emerald)]",
                },
                {
                  label: "Средняя убыточная сделка",
                  val: `${percent(strategy.statistics.avgLossPct)}`,
                  accent: "text-[var(--text-crimson)]",
                },
                {
                  label: "Математическое ожидание на сделку",
                  val: `${percent(strategy.statistics.expectancyPct)}`,
                  accent: "text-[var(--text-teal)]",
                },
                {
                  label: "Макс. серия прибыльных сделок",
                  val: `${numberText(strategy.statistics.maxConsecutiveWins, 0)}`,
                  accent: "text-[var(--text-primary)]",
                },
                {
                  label: "Макс. серия убыточных сделок",
                  val: `${numberText(strategy.statistics.maxConsecutiveLosses, 0)}`,
                  accent: "text-[var(--text-crimson)]",
                },
              ].map((row) => (
                <div
                  key={row.label}
                  className="py-2.5 flex items-center justify-between gap-4"
                >
                  <span className="text-[var(--text-secondary)]">
                    {row.label}
                  </span>
                  <span
                    className={`font-mono font-semibold tabular-nums ${row.accent}`}
                  >
                    {row.val}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Performance Distribution */}
          <div className="lg:col-span-5 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-5 flex flex-col justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-[var(--text-primary)] mb-1">
                Распределение месячных результатов
              </h2>
              <p className="text-xs text-[var(--text-muted)] mb-4">
                Распределение месяцев по доходности.
              </p>
              {strategy.distribution.length ? (
                <DistributionChart
                  buckets={strategy.distribution}
                  height={240}
                />
              ) : (
                <p>Нет данных для распределения.</p>
              )}
            </div>

            <div className="rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)] p-4 text-xs text-[var(--text-secondary)] space-y-2">
              <div className="flex items-center justify-between">
                <span>Доля прибыльных сделок</span>
                <span className="font-mono font-semibold text-[var(--text-emerald)] tabular-nums">
                  {percent(strategy.winRate, false)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Соотношение Avg Win / Avg Loss</span>
                <span className="font-mono font-semibold text-[var(--text-gold)] tabular-nums">
                  {"—"}x
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: ПОМЕСЯЧНАЯ ДОХОДНОСТЬ */}
      {activeTab === "monthly" &&
        (strategy.source !== "model" || !strategy.monthly24.length) && (
          <section className="quant-data">
            <h2>Помесячная доходность</h2>
            {strategy.monthly24.length ? (
              <>
                <label>
                  Год{" "}
                  <select
                    value={currentYear}
                    onChange={(e) => setCalendarYear(Number(e.target.value))}
                  >
                    {years.map((y) => (
                      <option key={y}>{y}</option>
                    ))}
                  </select>
                </label>
                <p>Годовой ROI · {percent(yearTotal?.roi, true)}</p>
                <MonthlyBarChart entries={calendarEntries} height={270} />
                <table>
                  <thead>
                    <tr>
                      <th>Месяц</th>
                      <th>ROI</th>
                      <th>Сделки</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calendarEntries.map((m) => (
                      <tr key={m.monthFull}>
                        <td>{m.monthFull}</td>
                        <td>{percent(m.returnPct)}</td>
                        <td>{numberText(m.tradesCount, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <p>Нет данных за этот период.</p>
            )}
          </section>
        )}
      {activeTab === "monthly" &&
        strategy.source === "model" &&
        strategy.monthly24.length > 0 && (
          <div className="space-y-6">
            {/* Top Arithmetic vs Compounded vs PnL Clarification Banner */}
            <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-gold)] p-4 flex items-start gap-3">
              <Info className="w-4 h-4 text-[var(--text-gold)] shrink-0 mt-0.5" />
              <div className="text-xs text-[var(--text-secondary)] leading-relaxed">
                <strong className="text-[var(--text-gold)] font-semibold">
                  Методология расчёта:
                </strong>{" "}
                Годовые и общие итоги на этой странице представлены как{" "}
                <span className="text-[var(--text-primary)] font-medium">
                  арифметическая сумма месячных модельных результатов
                </span>{" "}
                (например,{" "}
                {yearStats.y1.arith > 0
                  ? `+${yearStats.y1.arith}%`
                  : `${yearStats.y1.arith}%`}{" "}
                за первый условный год и +{yearStats.y2.arith}% за второй
                условный год = {percent(strategy.returnAllArithmetic, true)} за
                24 месяца). Арифметическая сумма отличается от{" "}
                <span className="text-[var(--text-teal)] font-medium">
                  сложного процента (Compounded ROI)
                </span>{" "}
                и не равна фактическому денежному PnL, который зависит от
                размера позиции, комиссий, проскальзывания и момента входа.
              </div>
            </div>

            {/* Summary KPI strip for 24M */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4">
                <div className="text-[11px] text-[var(--text-muted)]">
                  Год 1 (арифметическая сумма)
                </div>
                <div className="font-mono text-xl font-bold text-[var(--text-primary)] tabular-nums mt-1">
                  +{yearStats.y1.arith.toFixed(2)}%
                </div>
                <div className="text-[11px] text-[var(--text-muted)] mt-1 tabular-nums"></div>
              </div>

              <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4">
                <div className="text-[11px] text-[var(--text-muted)]">
                  Год 2 (арифметическая сумма)
                </div>
                <div className="font-mono text-xl font-bold text-[var(--text-gold)] tabular-nums mt-1">
                  +{yearStats.y2.arith.toFixed(2)}%
                </div>
                <div className="text-[11px] text-[var(--text-muted)] mt-1 tabular-nums"></div>
              </div>

              <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-gold)] p-4">
                <div className="text-[11px] text-[var(--text-muted)]">
                  За весь период · 24 месяца (арифм.)
                </div>
                <div className="font-mono text-xl font-bold text-[var(--text-teal)] tabular-nums mt-1">
                  {percent(strategy.returnAllArithmetic, true)}
                </div>
                <div className="text-[11px] text-[var(--text-muted)] mt-1">
                  Модельная сводка без комиссий
                </div>
              </div>

              <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4">
                <div className="text-[11px] text-[var(--text-muted)]">
                  Прибыльных месяцев (24М)
                </div>
                <div className="font-mono text-xl font-bold text-[var(--text-emerald)] tabular-nums mt-1">
                  {yearStats.y1.positive + yearStats.y2.positive} / 24
                </div>
                <div className="text-[11px] text-[var(--text-muted)] mt-1 tabular-nums">
                  {Math.round(
                    ((yearStats.y1.positive + yearStats.y2.positive) / 24) *
                      100,
                  )}
                  % положительных месяцев
                </div>
              </div>
            </div>

            {/* Interactive Monthly Bar Chart with Year Selector */}
            <div className="rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="font-display text-lg font-semibold text-[var(--text-primary)]">
                    Помесячная динамика ({selectedYear})
                  </h2>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    Арифметический итог за {selectedYear} год:{" "}
                    <span className="font-mono font-semibold text-[var(--text-gold)] tabular-nums">
                      +{activeYearSummary.arith.toFixed(2)}%
                    </span>{" "}
                    · Сделок:{" "}
                    <span className="font-mono text-[var(--text-primary)]">
                      {numberText(activeYearSummary.trades, 0)}
                    </span>
                  </p>
                </div>

                <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)] self-start">
                  {([1, 2] as const).map((yr) => (
                    <button
                      key={yr}
                      type="button"
                      aria-pressed={selectedYear === yr}
                      onClick={() => setSelectedYear(yr)}
                      className={`px-3.5 py-1.5 rounded-md text-xs font-mono font-medium transition-colors cursor-pointer ${
                        selectedYear === yr
                          ? "bg-[var(--bg-surface)] text-[var(--text-gold)] border border-[var(--border-gold)] shadow-xs"
                          : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      Год {yr}
                    </button>
                  ))}
                </div>
              </div>

              <MonthlyBarChart entries={activeYearEntries} height={270} />
            </div>

            {/* 24-Month Heatmap Matrix */}
            <div className="relative overflow-hidden rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4 sm:p-6">
              <NeuralWebOverlay variant="teal" />
              <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                <div>
                  <h3 className="font-display text-lg font-semibold text-[var(--text-primary)]">
                    Тепловая карта доходности (24 месяца)
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    Модельные результаты по каждому месяцу двух условных лет с
                    годовыми арифметическими итогами.
                  </p>
                </div>
              </div>

              <div className="relative z-10 space-y-4">
                {[
                  {
                    year: 1 as const,
                    entries: months1,
                    arith: yearStats.y1.arith,
                  },
                  {
                    year: 2 as const,
                    entries: months2,
                    arith: yearStats.y2.arith,
                  },
                ].map((block) => (
                  <div
                    key={block.year}
                    className="rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)] p-3 sm:p-4"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-mono text-sm font-semibold text-[var(--text-primary)]">
                        {block.year} год
                      </span>
                      <span className="text-xs text-[var(--text-muted)]">
                        Арифметический итог:{" "}
                        <strong className="font-mono text-[var(--text-gold)] tabular-nums">
                          +{block.arith.toFixed(2)}%
                        </strong>
                      </span>
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-6 xl:grid-cols-12 gap-2">
                      {block.entries.map((m) => (
                        <div
                          data-month={m.monthIndex + 1}
                          data-year={m.year}
                          data-return={m.returnPct}
                          key={`${m.year}-${m.monthIndex}`}
                          className={`rounded-lg border p-2.5 text-center transition-transform hover:-translate-y-0.5 ${getHeatmapStyle(
                            m.returnPct,
                          )}`}
                        >
                          <div className="text-[10px] opacity-85">
                            {m.monthShort}
                          </div>
                          <div className="font-mono text-xs sm:text-[13px] font-bold tabular-nums mt-0.5">
                            {percent(m.returnPct, true)}
                          </div>
                          <div className="text-[9px] opacity-70 font-mono mt-0.5 tabular-nums">
                            {numberText(m.tradesCount, 0)} сд.
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Year-over-Year Comparison Table */}
            <div className="rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4 sm:p-6">
              <h3 className="font-display text-lg font-semibold text-[var(--text-primary)] mb-1">
                Сравнение условных лет
              </h3>
              <p className="text-xs text-[var(--text-muted)] mb-4">
                Сопоставление ключевых модельных метрик между двумя 12-месячными
                циклами.
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-[var(--text-muted)]">
                      <th className="py-2.5 pr-4 font-medium">Показатель</th>
                      <th className="py-2.5 px-4 text-right font-mono font-medium">
                        1
                      </th>
                      <th className="py-2.5 px-4 text-right font-mono font-medium">
                        2
                      </th>
                      <th className="py-2.5 pl-4 text-right font-mono font-medium">
                        Изменение
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    <tr>
                      <td className="py-3 pr-4 text-[var(--text-secondary)]">
                        Годовой итог (арифметическая сумма)
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-[var(--text-primary)] tabular-nums">
                        +{yearStats.y1.arith.toFixed(2)}%
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-[var(--text-gold)] tabular-nums">
                        +{yearStats.y2.arith.toFixed(2)}%
                      </td>
                      <td className="py-3 pl-4 text-right font-mono text-[var(--text-teal)] tabular-nums">
                        {yearStats.y2.arith - yearStats.y1.arith >= 0
                          ? "+"
                          : ""}
                        {(yearStats.y2.arith - yearStats.y1.arith).toFixed(1)}{" "}
                        п.п.
                      </td>
                    </tr>

                    <tr>
                      <td className="py-3 pr-4 text-[var(--text-secondary)]">
                        Прибыльные месяцы
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-[var(--text-primary)] tabular-nums">
                        {yearStats.y1.positive} / 12
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-[var(--text-primary)] tabular-nums">
                        {yearStats.y2.positive} / 12
                      </td>
                      <td className="py-3 pl-4 text-right font-mono text-[var(--text-muted)] tabular-nums">
                        {yearStats.y2.positive - yearStats.y1.positive >= 0
                          ? "+"
                          : ""}
                        {yearStats.y2.positive - yearStats.y1.positive} мес.
                      </td>
                    </tr>
                    <tr>
                      <td className="py-3 pr-4 text-[var(--text-secondary)]">
                        Лучший месяц
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-[var(--text-emerald)] tabular-nums">
                        +{yearStats.y1.best.toFixed(1)}%
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-[var(--text-emerald)] tabular-nums">
                        +{yearStats.y2.best.toFixed(1)}%
                      </td>
                      <td className="py-3 pl-4 text-right font-mono text-[var(--text-muted)] tabular-nums">
                        {(yearStats.y2.best - yearStats.y1.best).toFixed(1)}{" "}
                        п.п.
                      </td>
                    </tr>
                    <tr>
                      <td className="py-3 pr-4 text-[var(--text-secondary)]">
                        Худший месяц
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-[var(--text-crimson)] tabular-nums">
                        {yearStats.y1.worst.toFixed(1)}%
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-[var(--text-crimson)] tabular-nums">
                        {yearStats.y2.worst.toFixed(1)}%
                      </td>
                      <td className="py-3 pl-4 text-right font-mono text-[var(--text-muted)] tabular-nums">
                        {(yearStats.y2.worst - yearStats.y1.worst).toFixed(1)}{" "}
                        п.п.
                      </td>
                    </tr>
                    <tr>
                      <td className="py-3 pr-4 text-[var(--text-secondary)]">
                        Внутримесячная просадка (макс.)
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-[var(--text-crimson)] tabular-nums">
                        {percent(yearStats.y1.maxDd)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-[var(--text-crimson)] tabular-nums">
                        {percent(yearStats.y2.maxDd)}
                      </td>
                      <td className="py-3 pl-4 text-right font-mono text-[var(--text-muted)] tabular-nums">
                        {numberText(yearStats.y2.maxDd - yearStats.y1.maxDd)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

      {/* TAB 4: О СТРАТЕГИИ */}
      {activeTab === "about" && isThomas && <ThomasResearch summary={strategy.methodologySummary}/>}
      {activeTab === "about" && !isThomas && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 relative overflow-hidden rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-5 sm:p-6 space-y-5">
            <NeuralWebOverlay variant="subtle" />
            <div className="relative z-10">
              <h2 className="font-display text-lg font-semibold text-[var(--text-primary)] mb-2">
                Архитектура и методология {strategy.name}
              </h2>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                {strategy.methodologySummary}
              </p>
            </div>

            <div className="relative z-10">
              <h3 className="text-xs font-semibold text-[var(--text-gold)] mb-2.5">
                Ключевые элементы алгоритма
              </h3>
              <ul className="space-y-2.5 text-xs sm:text-sm text-[var(--text-primary)]">
                {strategy.architecturePoints.map((item, idx) => (
                  <li
                    key={idx}
                    className="p-3 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)] flex items-start gap-3"
                  >
                    <span className="font-mono text-[var(--text-gold)] font-semibold">
                      0{idx + 1}
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative z-10">
              <h3 className="text-xs font-semibold text-[var(--text-teal)] mb-2.5">
                Протоколы контроля риска
              </h3>
              <ul className="space-y-2 text-xs sm:text-sm text-[var(--text-secondary)]">
                {strategy.riskControls.map((ctrl, idx) => (
                  <li key={idx} className="flex items-start gap-2.5">
                    <span className="text-[var(--text-teal)] mt-0.5">—</span>
                    <span>{ctrl}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="lg:col-span-5 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-5 sm:p-6 space-y-4">
            <h3 className="font-display text-base font-semibold text-[var(--text-primary)]">
              Параметры и спецификация
            </h3>
            <div className="divide-y divide-[var(--border-subtle)] text-xs sm:text-sm">
              <div className="py-2.5 flex justify-between gap-4">
                <span className="text-[var(--text-muted)]">Торговый рынок</span>
                <span className="font-mono text-[var(--text-primary)]">
                  {strategy.market}
                </span>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <span className="text-[var(--text-muted)]">
                  Класс стратегии
                </span>
                <span className="text-[var(--text-primary)]">
                  {strategy.category}
                </span>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <span className="text-[var(--text-muted)]">Профиль риска</span>
                <span className="text-[var(--text-gold)] font-medium">
                  {strategy.risk}
                </span>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <span className="text-[var(--text-muted)]">
                  Горизонт удержания
                </span>
                <span className="text-[var(--text-primary)]">
                  {strategy.horizonLabel}
                </span>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <span className="text-[var(--text-muted)]">
                  Минимальный порог
                </span>
                <span className="font-mono text-[var(--text-primary)]">
                  {numberText(strategy.minInvestmentUsdt, 0)} USDT
                </span>
              </div>
            </div>

            {!readOnly && <div className="p-3.5 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[11px] text-[var(--text-muted)] leading-relaxed">
              {strategy.source === "model"
                ? "Модельный сценарий. Данные не являются подтверждённой историей сделок."
                : strategy.source === "verified"
                  ? "Подтверждённые данные стратегии."
                  : "Торговая история отсутствует."}
            </div>}
          </div>
        </div>
      )}

      {/* TAB 5: АВТОР */}
      {activeTab === "author" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 relative overflow-hidden rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-5 sm:p-6 space-y-5">
            <NeuralWebOverlay variant={isThomas ? "gold" : "subtle"} />
            <div className="relative z-10 flex items-start gap-4">
              <div
                className="w-16 h-16 rounded-full bg-gradient-to-br from-[#D4AF6A]/35 to-[#14B8A6]/25 border border-[var(--border-gold)] flex items-center justify-center font-display text-2xl font-bold text-[var(--text-gold)] shrink-0"
                title="Профиль автора"
              >
                {strategy.avatar ? (
                  <img
                    src={strategy.avatar}
                    alt=""
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      borderRadius: "50%",
                    }}
                  />
                ) : (
                  strategy.author.charAt(0)
                )}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-xl font-bold text-[var(--text-primary)]">
                    {strategy.author}
                  </h2>
                  {strategy.isVip && (
                    <span className="inline-flex items-center gap-1 text-xs font-mono text-[var(--text-gold)]">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>VIP Creator</span>
                    </span>
                  )}
                </div>
                <div className="text-xs sm:text-sm text-[var(--text-secondary)] mt-1">
                  {strategy.authorRole}
                </div>
                <div className="text-[11px] text-[var(--text-muted)] mt-2">
                  {strategy.avatar || strategy.author !== "—"
                    ? "Публичные данные профиля VOLTEX."
                    : "Профиль автора не указан."}
                </div>
              </div>
            </div>

            <div className="relative z-10 pt-4 border-t border-[var(--border-subtle)] space-y-3 text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed">
              {isThomas ? <ThomasAuthor readOnly={readOnly} /> : <p>{strategy.methodologySummary}</p>}
              <p className="text-[var(--text-muted)]">
                Статус VIP-разработчика позволяет публиковать авторские
                стратегии в витрине Quant Marketplace, настраивать параметры
                риск-профиля и управлять обновлениями модели через интерфейс Bot
                Studio.
              </p>
            </div>
          </div>

          <div className="lg:col-span-5 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-5 sm:p-6">
            <h3 className="font-display text-base font-semibold text-[var(--text-primary)] mb-3">
              Другие стратегии в маркетплейсе
            </h3>
            <div className="space-y-2.5">
              {otherStrategies.map((other) => (
                <button
                  key={other.id}
                  type="button"
                  onClick={() => {
                    setActiveTab("overview");
                    onSelectStrategy(other.id);
                  }}
                  className="w-full p-3 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)] hover:border-[var(--border-gold)] transition-colors flex items-center justify-between gap-3 text-left cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <StrategyLogo
                      strategyId={other.id}
                      size={36}
                      className="shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[var(--text-primary)] truncate">
                        {other.name}
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        {other.market} · {other.category}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono text-sm font-semibold text-[var(--text-teal)] tabular-nums">
                      {percent(other.return30d, true)}
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)]">
                      30Д
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
