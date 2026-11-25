import { numberText, percent } from "../../data/catalogue";
import React, { useMemo, useState } from "react";
import { ArrowUpRight, Compass, Info } from "lucide-react";
import type {
  IntelligenceBucket,
  Strategy,
  TimeframeKey,
} from "../../types/strategy";
import { MiniSparkChart } from "../charts/StrategyCharts";
import { StrategyLogo } from "../logos/StrategyLogos";
import { NeuralWebOverlay } from "../background/NeuralWebOverlay";

const BUCKETS: IntelligenceBucket[] = [
  "Лидеры доходности",
  "Количественные стратегии",
  "Трендовые стратегии",
  "Сбалансированные стратегии",
  "Портфельные стратегии",
];

interface QuantIntelligenceSectionProps {
  strategies: Strategy[];
  onOpenProfile: (strategyId: string) => void;
}

export const QuantIntelligenceSection: React.FC<
  QuantIntelligenceSectionProps
> = ({ strategies, onOpenProfile }) => {
  const [activeBucket, setActiveBucket] =
    useState<IntelligenceBucket>("Лидеры доходности");
  const [chartWindow, setChartWindow] = useState<TimeframeKey>("30D");

  const filtered = useMemo(() => {
    const matches = strategies.filter((s) =>
      s.intelligenceBuckets.includes(activeBucket),
    );
    return matches
      .filter((s) => s.series[chartWindow].length > 0)
      .sort(
        (a, b) =>
          b.series[chartWindow].slice(-1)[0].value -
          a.series[chartWindow].slice(-1)[0].value,
      );
  }, [strategies, activeBucket, chartWindow]);

  return (
    <section className="max-w-[1600px] mx-auto px-3 sm:px-6 mt-10">
      <div className="qx-intel-aurora relative rounded-2xl overflow-hidden border border-[var(--border-subtle)] p-4 sm:p-6 lg:p-8 shadow-xs transition-colors">

        {/* Header & Window Switcher */}
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-5">
          <div>
            <div className="flex items-center gap-2 text-xs text-[var(--text-teal)] font-medium mb-1">
              <Compass className="w-3.5 h-3.5" />
              <span>Аналитический отбор моделей</span>
            </div>
            <h2 className="qx-intel-title font-display font-bold text-[var(--text-primary)]">
              <span>Подбор торговых стратегий</span>
              <span className="qx-intel-accent">
                <span>VOLTEX Quant Intelligence</span>
                <svg className="qx-intel-stars" width="32" height="30" viewBox="0 0 32 30" fill="currentColor" aria-hidden="true">
                  <path d="M12 0 14.5 10.5 25 13 14.5 15.5 12 26 9.5 15.5 0 13 9.5 10.5Z"/>
                  <path d="M26 13 27.4 18.6 33 20 27.4 21.4 26 27 24.6 21.4 19 20 24.6 18.6Z"/>
                </svg>
              </span>
            </h2>
            <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-1">
              Подбор стратегий по рыночным параметрам и профилю риска.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start lg:self-auto">
            <span className="text-xs text-[var(--text-muted)]">
              Горизонт графика:
            </span>
            <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
              {(["30D", "90D", "1Y"] as TimeframeKey[]).map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => setChartWindow(tf)}
                  className={`px-2.5 py-1 rounded text-xs font-mono transition-colors cursor-pointer ${
                    chartWindow === tf
                      ? "bg-[var(--bg-surface)] text-[var(--text-gold)] font-semibold shadow-xs"
                      : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {tf === "30D" ? "30Д" : tf === "90D" ? "90Д" : "1Г"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Category Tabs */}
        <div className="relative z-10 flex items-center gap-1.5 overflow-x-auto pb-2 mb-5 border-b border-[var(--border-subtle)]">
          {BUCKETS.map((bucket) => {
            const active = activeBucket === bucket;
            return (
              <button
                key={bucket}
                type="button"
                onClick={() => setActiveBucket(bucket)}
                className={`px-3.5 py-2 rounded-lg text-xs sm:text-[13px] font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  active
                    ? "bg-[#D4AF6A]/16 text-[var(--text-gold)] border border-[var(--border-gold)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] border border-transparent"
                }`}
              >
                {bucket}
              </button>
            );
          })}
        </div>

        {/* Asymmetric Recommendation Grid */}
        <div
          className={`relative z-10 grid gap-4 ${
            filtered.length === 1
              ? "grid-cols-1"
              : filtered.length === 2
                ? "grid-cols-1 lg:grid-cols-2"
                : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
          }`}
        >
          {!filtered.length && <p>Нет стратегий с данными за этот период.</p>}
          {filtered.map((strategy, idx) => {
            const series = strategy.series[chartWindow];
            const windowReturn =
              chartWindow === "30D"
                ? strategy.return30d
                : chartWindow === "1Y"
                  ? strategy.return1yArithmetic
                  : (series[series.length - 1]?.value ?? strategy.return30d);

            const isLeadSplit = filtered.length === 4 && idx === 0;

            return (
              <div
                key={strategy.id}
                onClick={() => onOpenProfile(strategy.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpenProfile(strategy.id);
                  }
                }}
                className={`qx-intel-card group relative overflow-hidden rounded-xl bg-[var(--bg-surface)] border transition-colors p-4 sm:p-5 flex flex-col justify-between gap-4 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[#D4AF6A] ${
                  strategy.isFeatured
                    ? "border-[var(--border-gold)] hover:border-[#C59B47]"
                    : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
                } ${isLeadSplit ? "md:col-span-2 xl:col-span-1" : ""}`}
              >
                <NeuralWebOverlay
                  variant={strategy.isFeatured ? "gold" : "subtle"}
                />
                <div className="relative z-10">
                  {/* Top row: Logo, Title, Market/Category */}
                  <div className="qx-intel-card-head flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <StrategyLogo
                        strategyId={strategy.logoId ?? strategy.id}
                        customLogo={strategy.logoUrl}
                        size={42}
                        className="shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-display text-base font-semibold text-[var(--text-primary)] truncate group-hover:text-[var(--text-gold)] transition-colors">
                            {strategy.name}
                          </h3>
                          {strategy.isVip && (
                            <span className="text-[10px] font-mono font-semibold text-[var(--text-gold)]">
                              VIP
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[var(--text-muted)] truncate">
                          <span className="font-mono text-[var(--text-secondary)]">
                            {strategy.market}
                          </span>
                          <span className="mx-1.5 opacity-40">·</span>
                          <span>{strategy.category}</span>
                        </div>
                      </div>
                    </div>

                    <div className="qx-intel-card-risk text-right shrink-0">
                      <div className="text-[11px] text-[var(--text-muted)]">
                        Риск:{" "}
                        <span
                          className={
                            strategy.risk === "Низкий"
                              ? "text-[var(--text-emerald)] font-medium"
                              : strategy.risk === "Умеренный"
                                ? "text-[var(--text-gold)] font-medium"
                                : "text-amber-600 dark:text-[#F59E0B] font-medium"
                          }
                        >
                          {strategy.risk}
                        </span>
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                        {strategy.horizonLabel}
                      </div>
                    </div>
                  </div>

                  <p className="mt-3 text-xs text-[var(--text-secondary)] leading-relaxed line-clamp-2">
                    {strategy.shortDescription}
                  </p>
                  <div className="mt-2 text-[11px] text-[var(--text-muted)]">
                    Профиль кривой:{" "}
                    <span className="text-[var(--text-secondary)]">
                      {strategy.behaviorTag}
                    </span>
                  </div>
                </div>

                {/* Distinct Interactive Chart */}
                <div className="relative z-10 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)] px-2.5 pt-2.5 pb-1">
                  <div className="flex items-baseline justify-between px-1 mb-1">
                    <span className="text-[11px] text-[var(--text-muted)]">
                      {strategy.source === "model" ? "Модель" : "Подтверждено"} (
                      {chartWindow === "30D"
                        ? "30Д"
                        : chartWindow === "90D"
                          ? "90Д"
                          : "1Г"}
                      )
                    </span>
                    <span className="font-mono text-base font-bold tabular-nums text-[var(--text-teal)]">
                      {percent(windowReturn, true)}
                    </span>
                  </div>
                  <MiniSparkChart
                    data={series}
                    accentColor={strategy.accentColor}
                    secondaryColor={strategy.secondaryColor}
                    chartId={`intel-${strategy.id}-${chartWindow}`}
                    height={92}
                    showAxes
                  />
                </div>

                {/* Bottom Metrics & Action */}
                <div className="qx-card-foot relative z-10 flex items-center justify-between gap-3 pt-3 border-t border-[var(--border-subtle)] text-xs">
                  <div className="qx-card-stats flex items-center gap-4">
                    <div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        Просадка
                      </div>
                      <div className="font-mono font-medium text-[var(--text-crimson)] tabular-nums">
                        {percent(strategy.maxDrawdown, false)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        Win Rate
                      </div>
                      <div className="font-mono font-medium text-[var(--text-primary)] tabular-nums">
                        {percent(strategy.winRate, false)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        Мин. вход
                      </div>
                      <div className="font-mono font-medium text-[var(--text-primary)] tabular-nums">
                        {numberText(strategy.minInvestmentUsdt, 0)} USDT
                      </div>
                    </div>
                  </div>

                  <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-gold)] group-hover:translate-x-0.5 transition-transform whitespace-nowrap">
                    <span>Аналитика</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Recommendation method */}
        <div className="relative z-10 mt-4 pt-3 border-t border-[var(--border-subtle)] flex items-start sm:items-center gap-2 text-[11px] text-[var(--text-muted)]">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 sm:mt-0" />
          <span>
            Подборка использует выбранную категорию и доступные данные за период.
            Источник доходности указан в карточке стратегии.
          </span>
        </div>
      </div>
    </section>
  );
};
