import { numberText, percent } from "../../data/catalogue";
import React, { useState } from "react";
import { ArrowUpRight, Award, ShieldCheck, UserCheck } from "lucide-react";
import type { Strategy, TimeframeKey } from "../../types/strategy";
import { FlagshipPerformanceChart } from "../charts/StrategyCharts";
import { StrategyLogo } from "../logos/StrategyLogos";
import { NeuralWebOverlay } from "../background/NeuralWebOverlay";

interface FlagshipThomasSectionProps {
  strategy: Strategy;
  onOpenProfile: (strategyId: string) => void;
}

const FLAGSHIP_TIMEFRAMES: { key: TimeframeKey; label: string }[] = [
  { key: "7D", label: "7Д" },
  { key: "30D", label: "30Д" },
  { key: "90D", label: "90Д" },
  { key: "1Y", label: "1Г" },
  { key: "ALL", label: "Всё время" },
];

export const FlagshipThomasSection: React.FC<FlagshipThomasSectionProps> = ({
  strategy,
  onOpenProfile,
}) => {
  const [tf, setTf] = useState<TimeframeKey>("30D");
  const activeSeries = strategy.series[tf];
  const latestVal =
    activeSeries[activeSeries.length - 1]?.value ?? strategy.return30d;

  return (
    <section className="max-w-[1600px] mx-auto px-3 sm:px-6 mt-6">
      <div
        className="relative rounded-2xl overflow-hidden border border-[var(--border-gold)] shadow-sm transition-colors"
        style={{
          background:
            "linear-gradient(135deg, var(--bg-thomas-from) 0%, var(--bg-thomas-via) 55%, var(--bg-thomas-to) 100%)",
        }}
      >
        <NeuralWebOverlay variant="gold" />
        {/* Subtle metallic gold top hairline */}
        <div className="relative z-10 h-[2px] w-full bg-gradient-to-r from-[#F59E0B] via-[#22D3EE] to-[#A855F7]" />

        <div className="relative z-10 p-4 sm:p-6 lg:p-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-stretch">
            {/* Left column: Identity, author slot, description, KPI grid */}
            <div className="lg:col-span-5 flex flex-col justify-between gap-5">
              <div className="space-y-4">
                {/* Quiet unboxed designation row */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--text-gold)]">
                    <Award className="w-3.5 h-3.5" />
                    <span>Избранная стратегия</span>
                  </span>
                  <span
                    className="text-[var(--text-muted)] opacity-50"
                    aria-hidden="true"
                  >
                    ·
                  </span>
                  {strategy.isVip && (
                    <span className="inline-flex items-center gap-1 text-[var(--text-teal)] font-medium">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>VIP</span>
                    </span>
                  )}
                  <span
                    className="text-[var(--text-muted)] opacity-50"
                    aria-hidden="true"
                  >
                    ·
                  </span>
                  <span className="font-mono text-[var(--text-secondary)]">
                    {strategy.market}
                  </span>
                  <span
                    className="text-[var(--text-muted)] opacity-50"
                    aria-hidden="true"
                  >
                    ·
                  </span>
                  <span className="text-[var(--text-muted)]">
                    {strategy.category}
                  </span>
                </div>

                {/* Strategy Logo + Title */}
                <div className="flex items-start gap-4">
                  <StrategyLogo
                    strategyId={strategy.logoId ?? strategy.id}
                    customLogo={strategy.logoUrl}
                    size={56}
                    className="shrink-0 shadow-md"
                  />
                  <div className="min-w-0">
                    <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text-primary)]">
                      {strategy.name}
                    </h2>
                    {/* Author avatar placeholder ready for existing Thomas profile integration */}
                    <div className="mt-1.5 flex items-center gap-2.5 text-xs text-[var(--text-secondary)]">
                      <div
                        className="w-6 h-6 rounded-full bg-gradient-to-br from-[#D4AF6A]/30 to-[#14B8A6]/20 border border-[var(--border-gold)] flex items-center justify-center text-[11px] font-semibold text-[var(--text-gold)] shrink-0"
                        title={strategy.author}
                      >
                        {strategy.avatar ? (
                          <img
                            src={strategy.avatar}
                            style={{ borderRadius: "50%" }}
                            alt=""
                          />
                        ) : (
                          strategy.author[0]
                        )}
                      </div>
                      <span>
                        Автор:{" "}
                        <strong className="text-[var(--text-primary)] font-semibold">
                          {strategy.author}
                        </strong>
                      </span>
                      <span
                        className="text-[var(--text-muted)] opacity-50"
                        aria-hidden="true"
                      >
                        ·
                      </span>
                      <span className="inline-flex items-center gap-1 text-[var(--text-gold)]">
                        <UserCheck className="w-3 h-3" />
                        <span>
                          {strategy.isVip ? "VIP-автор" : "Автор стратегии"}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>

                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                  {strategy.shortDescription}
                </p>
              </div>

              {/* Structured Institutional KPI Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3.5 pt-4 border-t border-[var(--border-subtle)]">
                <div>
                  <div className="text-[11px] text-[var(--text-muted)]">
                    Доходность 30Д
                  </div>
                  <div className="font-mono text-lg font-bold text-[var(--text-teal)] tabular-nums">
                    {percent(strategy.return30d, true)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--text-muted)]">
                    Годовой итог
                  </div>
                  <div className="font-mono text-lg font-semibold text-[var(--text-gold)] tabular-nums">
                    {percent(strategy.return1yArithmetic, true)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--text-muted)]">
                    За весь период (24М)
                  </div>
                  <div className="font-mono text-lg font-semibold text-[var(--text-primary)] tabular-nums">
                    {percent(strategy.returnAllArithmetic, true)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--text-muted)]">
                    Макс. просадка
                  </div>
                  <div className="font-mono text-sm font-semibold text-[var(--text-crimson)] tabular-nums">
                    {percent(strategy.maxDrawdown, false)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--text-muted)]">
                    Прибыльные сделки
                  </div>
                  <div className="font-mono text-sm font-semibold text-[var(--text-primary)] tabular-nums">
                    {percent(strategy.winRate, false)}{" "}
                    <span className="text-[var(--text-muted)] font-normal">
                      ({numberText(strategy.tradesCount, 0)})
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--text-muted)]">
                    Мин. инвестиция
                  </div>
                  <div className="font-mono text-sm font-semibold text-[var(--text-primary)] tabular-nums">
                    {numberText(strategy.minInvestmentUsdt, 0)} USDT
                  </div>
                </div>
              </div>

              {/* Action & Model Disclosure */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => onOpenProfile(strategy.id)}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-[#D4AF6A] to-[#E5C98B] text-[#08090C] hover:brightness-105 shadow-xs transition-all whitespace-nowrap cursor-pointer"
                >
                  <span>Подробнее о стратегии</span>
                  <ArrowUpRight className="w-4 h-4" />
                </button>
                <span className="text-[11px] text-[var(--text-muted)] leading-snug">
                  {strategy.source === "model"
                    ? "Иллюстративная модель. Условные месяцы суммируются арифметически."
                    : "Подтверждённая торговая история."}
                </span>
              </div>
            </div>

            {/* Right column: Interactive Gold & Turquoise Performance Terminal Chart */}
            <div className="lg:col-span-7 flex flex-col justify-between rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div>
                  <div className="text-xs text-[var(--text-muted)]">
                    Кривая модельной динамики · {strategy.market}
                  </div>
                  <div className="flex items-baseline gap-2.5 mt-0.5">
                    <span className="font-mono text-2xl font-bold text-[var(--text-teal)] tabular-nums">
                      {latestVal >= 0
                        ? `+${latestVal.toFixed(1)}%`
                        : `${latestVal.toFixed(1)}%`}
                    </span>
                    <span className="text-xs text-[var(--text-muted)]">
                      за выбранный интервал (
                      {FLAGSHIP_TIMEFRAMES.find((t) => t.key === tf)?.label})
                    </span>
                  </div>
                </div>

                {/* Period selector */}
                <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
                  {FLAGSHIP_TIMEFRAMES.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setTf(item.key)}
                      className={`px-2.5 py-1 rounded text-xs font-mono font-medium transition-colors cursor-pointer ${
                        tf === item.key
                          ? "bg-[var(--bg-surface)] text-[var(--text-gold)] border border-[var(--border-gold)] shadow-xs"
                          : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <FlagshipPerformanceChart data={activeSeries} height={240} />

              <div className="mt-3 pt-3 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
                <div className="flex items-center gap-4">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-[2px] bg-gradient-to-r from-[#C59B47] to-[#14B8A6]" />
                    <span>Thomas Quant AI</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-0 border-t border-dashed border-[#64748B]" />
                    <span>
                      {activeSeries.some(
                        (point) => point.benchmark !== undefined,
                      )
                        ? "Базовый ориентир рынка"
                        : "Доходность стратегии"}
                    </span>
                  </span>
                </div>
                <span className="font-mono text-[var(--text-gold)] tabular-nums">
                  Sharpe {numberText(strategy.statistics.sharpeRatio)} · Profit
                  Factor {numberText(strategy.statistics.profitFactor)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
