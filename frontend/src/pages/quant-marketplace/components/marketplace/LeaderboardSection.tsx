import { numberText, percent } from "../../data/catalogue";
import React, { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Crown,
  RotateCcw,
  Search,
} from "lucide-react";
import type {
  RiskLevel,
  Strategy,
  StrategyCategory,
} from "../../types/strategy";
import { StrategyLogo } from "../logos/StrategyLogos";
import { NeuralWebOverlay } from "../background/NeuralWebOverlay";

type SortField =
  | "rank"
  | "return30d"
  | "return1yArithmetic"
  | "returnAllArithmetic"
  | "maxDrawdown"
  | "winRate"
  | "minInvestmentUsdt";

type PeriodFocus = "30D" | "1Y" | "ALL";

interface LeaderboardSectionProps {
  strategies: Strategy[];
  onOpenProfile: (strategyId: string) => void;
}

const CATEGORIES: ("Все" | StrategyCategory)[] = [
  "Все",
  "Multi-Asset Intelligence",
  "Quantitative Intelligence",
  "Momentum",
  "Breakout",
  "Grid",
  "DCA",
  "Rebalance",
  "Market Neutral",
];

const RISKS: ("Все" | RiskLevel)[] = [
  "Все",
  "Низкий",
  "Умеренный",
  "Повышенный",
];

export const LeaderboardSection: React.FC<LeaderboardSectionProps> = ({
  strategies,
  onOpenProfile,
}) => {
  const [market, setMarket] = useState("Все");
  const [source, setSource] = useState<Strategy["source"]>("model");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<
    "Все" | StrategyCategory
  >("Все");
  const [riskFilter, setRiskFilter] = useState<"Все" | RiskLevel>("Все");
  const [periodFocus, setPeriodFocus] = useState<PeriodFocus>("30D");
  const [sortField, setSortField] = useState<SortField>("rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(
        field === "rank" || field === "minInvestmentUsdt" ? "asc" : "desc",
      );
    }
  };

  const handlePeriodChange = (p: PeriodFocus) => {
    setPeriodFocus(p);
    if (p === "30D") {
      setSortField("return30d");
      setSortDir("desc");
    } else if (p === "1Y") {
      setSortField("return1yArithmetic");
      setSortDir("desc");
    } else {
      setSortField("returnAllArithmetic");
      setSortDir("desc");
    }
  };

  const resetFilters = () => {
    setMarket("Все");
    setSource("model");
    setSearch("");
    setCategoryFilter("Все");
    setRiskFilter("Все");
    setPeriodFocus("30D");
    setSortField("rank");
    setSortDir("asc");
  };

  const filteredAndSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const metric =
      periodFocus === "30D"
        ? "return30d"
        : periodFocus === "1Y"
          ? "return1yArithmetic"
          : "returnAllArithmetic";
    const ranked = strategies
      .filter((s) => s.source === source)
      .sort(
        (a, b) =>
          (Number.isFinite(b[metric]) ? b[metric] : -Infinity) -
          (Number.isFinite(a[metric]) ? a[metric] : -Infinity),
      );
    const list = ranked
      .map((s) => ({
        ...s,
        rank: Number.isFinite(s[metric])
          ? 1 + ranked.filter((o) => o[metric] > s[metric]).length
          : Infinity,
      }))
      .filter((s) => {
        if (market !== "Все" && s.market !== market) return false;
        if (categoryFilter !== "Все" && s.category !== categoryFilter)
          return false;
        if (riskFilter !== "Все" && s.risk !== riskFilter) return false;
        if (q) {
          const hay =
            `${s.name} ${s.market} ${s.author} ${s.category}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });

    return [...list].sort((a, b) => {
      const valA = a[sortField];
      const valB = b[sortField];
      if (!Number.isFinite(valA)) return Number.isFinite(valB) ? 1 : 0;
      if (!Number.isFinite(valB)) return -1;
      if (sortDir === "asc") return valA - valB;
      return valB - valA;
    });
  }, [
    strategies,
    search,
    categoryFilter,
    riskFilter,
    sortField,
    sortDir,
    market,
    source,
    periodFocus,
  ]);

  const renderRankBadge = (rank: number) => {
    if (!Number.isFinite(rank)) return <span>—</span>;
    if (rank === 1) {
      return (
        <span
          className="inline-flex items-center justify-center w-7 h-7 rounded-md font-mono text-xs font-bold bg-gradient-to-br from-[#F5DFB0] via-[#D4AF6A] to-[#8C6B2D] text-[#08090C] shadow-xs"
          title="1 место"
        >
          1
        </span>
      );
    }
    if (rank === 2) {
      return (
        <span
          className="inline-flex items-center justify-center w-7 h-7 rounded-md font-mono text-xs font-bold bg-gradient-to-br from-[#F1F5F9] via-[#CBD5E1] to-[#64748B] text-[#08090C]"
          title="2 место"
        >
          2
        </span>
      );
    }
    if (rank === 3) {
      return (
        <span
          className="inline-flex items-center justify-center w-7 h-7 rounded-md font-mono text-xs font-bold bg-gradient-to-br from-[#FDBA74] via-[#CD7F32] to-[#7C4415] text-[#08090C]"
          title="3 место"
        >
          3
        </span>
      );
    }
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 font-mono text-xs font-medium text-[var(--text-muted)] tabular-nums">
        {rank}
      </span>
    );
  };

  const SortIcon: React.FC<{ field: SortField }> = ({ field }) => {
    if (sortField !== field)
      return <ArrowUpDown className="w-3 h-3 opacity-40" />;
    return sortDir === "asc" ? (
      <ArrowUp className="w-3 h-3 text-[var(--text-gold)]" />
    ) : (
      <ArrowDown className="w-3 h-3 text-[var(--text-gold)]" />
    );
  };

  return (
    <section
      id="strategy-leaderboard"
      className="max-w-[1600px] mx-auto px-3 sm:px-6 mt-10"
    >
      {/* Section Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-4">
        <div>
          <h2 className="font-display text-xl sm:text-2xl font-bold text-[var(--text-primary)]">
            Рейтинг торговых стратегий
          </h2>
          <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-1">
            Стратегии с выбранным источником данных за указанный период.
          </p>
        </div>

        {/* Period Focus Tabs */}
        <div className="flex items-center gap-2 self-start lg:self-auto">
          <span className="text-xs text-[var(--text-muted)] hidden sm:inline">
            Фокус периода:
          </span>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
            {(
              [
                { key: "30D", label: "30Д" },
                { key: "1Y", label: "Год" },
                { key: "ALL", label: "Весь период" },
              ] as { key: PeriodFocus; label: string }[]
            ).map((p) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={periodFocus === p.key}
                onClick={() => handlePeriodChange(p.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  periodFocus === p.key
                    ? "bg-[var(--bg-surface)] text-[var(--text-gold)] border border-[var(--border-gold)] shadow-xs"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="quant-filter">
        <label>
          Данные{" "}
          <select
            aria-label="Данные рейтинга"
            value={source}
            onChange={(e) => setSource(e.target.value as Strategy["source"])}
          >
            <option value="model">Модельные</option>
            <option value="verified">Подтверждённые</option>
            <option value="unavailable">Без истории</option>
          </select>
        </label>
        <label>
          Пара{" "}
          <select
            aria-label="Пара"
            value={market}
            onChange={(e) => setMarket(e.target.value)}
          >
            {["Все", ...new Set(strategies.map((s) => s.market))].map(
              (pair) => (
                <option key={pair}>{pair}</option>
              ),
            )}
          </select>
        </label>
      </div>
      {/* Category Filter Strip */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-4 border-b border-[var(--border-subtle)]">
        {CATEGORIES.map((cat) => {
          const active = categoryFilter === cat;
          return (
            <button
              key={cat}
              type="button"
              aria-pressed={active}
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                active
                  ? "bg-[var(--bg-surface)] text-[var(--text-gold)] border border-[var(--border-gold)] shadow-xs"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] border border-transparent"
              }`}
            >
              {cat === "Все" ? "Все категории" : cat}
            </button>
          );
        })}
      </div>

      {/* Search, Risk & Sort Controls */}
      <div className="quant-rank-toolbar flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по стратегии, паре или автору..."
              aria-label="Поиск стратегии"
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs sm:text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-gold)]"
            />
          </div>

          <div className="quant-risk-filter flex items-center gap-1 p-1 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)] self-start">
            {RISKS.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={riskFilter === r}
                onClick={() => setRiskFilter(r)}
                className={`px-2.5 py-1 rounded text-xs transition-colors whitespace-nowrap cursor-pointer ${
                  riskFilter === r
                    ? "bg-[var(--bg-surface)] text-[var(--text-primary)] font-medium shadow-xs"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                {r === "Все" ? "Любой риск" : r}
              </button>
            ))}
          </div>
        </div>

        <div className="quant-sort-controls flex items-center gap-2.5 self-start md:self-auto">
          <label className="text-xs text-[var(--text-muted)] flex items-center gap-2">
            <span>Сортировка:</span>
            <select
              value={sortField}
              onChange={(e) => {
                const f = e.target.value as SortField;
                setSortField(f);
                setSortDir(
                  f === "rank" || f === "minInvestmentUsdt" ? "asc" : "desc",
                );
              }}
              className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-gold)]"
            >
              <option value="rank">По рейтингу</option>
              <option value="return30d">Доходность 30Д</option>
              <option value="return1yArithmetic">Результат за год</option>
              <option value="returnAllArithmetic">За весь период</option>
              <option value="maxDrawdown">Макс. просадка</option>
              <option value="winRate">Прибыльные сделки</option>
              <option value="minInvestmentUsdt">Мин. инвестиция</option>
            </select>
          </label>

          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Сбросить</span>
          </button>
        </div>
      </div>

      {/* Desktop / Tablet Institutional Table (>= 1024px) */}
      <div className="hidden lg:block relative overflow-hidden rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-xs">
        <NeuralWebOverlay variant="teal" />
        <div className="relative z-10 overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] text-[11px] font-medium text-[var(--text-muted)]">
                <th className="py-3 pl-4 pr-2 w-14">
                  <button
                    type="button"
                    onClick={() => handleSort("rank")}
                    className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    <span>Место</span>
                    <SortIcon field="rank" />
                  </button>
                </th>
                <th className="py-3 px-3">Стратегия</th>
                <th className="py-3 px-3">Автор</th>
                <th className="py-3 px-3">Рынок</th>
                <th className="py-3 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => handleSort("return30d")}
                    className="inline-flex items-center justify-end gap-1 hover:text-[var(--text-primary)] cursor-pointer ml-auto"
                  >
                    <span>Доходность 30Д</span>
                    <SortIcon field="return30d" />
                  </button>
                </th>
                <th className="py-3 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => handleSort("return1yArithmetic")}
                    className="inline-flex items-center justify-end gap-1 hover:text-[var(--text-primary)] cursor-pointer ml-auto"
                  >
                    <span>Результат за год</span>
                    <SortIcon field="return1yArithmetic" />
                  </button>
                </th>
                <th className="py-3 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => handleSort("returnAllArithmetic")}
                    className="inline-flex items-center justify-end gap-1 hover:text-[var(--text-primary)] cursor-pointer ml-auto"
                  >
                    <span>Результат за весь период</span>
                    <SortIcon field="returnAllArithmetic" />
                  </button>
                </th>
                <th className="py-3 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => handleSort("maxDrawdown")}
                    className="inline-flex items-center justify-end gap-1 hover:text-[var(--text-primary)] cursor-pointer ml-auto"
                  >
                    <span>Макс. просадка</span>
                    <SortIcon field="maxDrawdown" />
                  </button>
                </th>
                <th className="py-3 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => handleSort("winRate")}
                    className="inline-flex items-center justify-end gap-1 hover:text-[var(--text-primary)] cursor-pointer ml-auto"
                  >
                    <span>Прибыльные сделки</span>
                    <SortIcon field="winRate" />
                  </button>
                </th>
                <th className="py-3 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => handleSort("minInvestmentUsdt")}
                    className="inline-flex items-center justify-end gap-1 hover:text-[var(--text-primary)] cursor-pointer ml-auto"
                  >
                    <span>Мин. инвестиция</span>
                    <SortIcon field="minInvestmentUsdt" />
                  </button>
                </th>
                <th className="py-3 pl-3 pr-4 text-right">Действие</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)] text-xs sm:text-[13px]">
              {filteredAndSorted.length === 0 ? (
                <tr>
                  <td
                    colSpan={11}
                    className="py-10 text-center text-sm text-[var(--text-muted)]"
                  >
                    По выбранным фильтрам стратегии не найдены.{" "}
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="text-[var(--text-gold)] hover:underline ml-1 cursor-pointer"
                    >
                      Сбросить фильтры
                    </button>
                  </td>
                </tr>
              ) : (
                filteredAndSorted.map((s) => {
                  const isThomas = s.id === "range";
                  return (
                    <tr
                      key={s.id}
                      data-bot={s.id}
                      data-roi={
                        Number.isFinite(s.return30d) ? s.return30d : undefined
                      }
                      onClick={() => onOpenProfile(s.id)}
                      className={`transition-colors cursor-pointer ${
                        isThomas
                          ? "bg-[#D4AF6A]/[0.08] dark:bg-gradient-to-r dark:from-[#F59E0B]/[0.14] dark:via-[#1E2B58]/85 dark:to-[#22D3EE]/[0.10] hover:bg-[#D4AF6A]/[0.14]"
                          : "hover:bg-[var(--bg-subtle)]"
                      }`}
                    >
                      <td className="py-3.5 pl-4 pr-2">
                        {renderRankBadge(s.rank)}
                      </td>
                      <td className="py-3.5 px-3">
                        <div className="flex items-center gap-3">
                          <StrategyLogo
                            strategyId={s.logoId ?? s.id}
                            customLogo={s.logoUrl}
                            size={36}
                            className="shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`font-semibold whitespace-nowrap ${
                                  isThomas
                                    ? "text-[var(--text-gold)]"
                                    : "text-[var(--text-primary)]"
                                }`}
                              >
                                {s.name}
                              </span>
                              {s.isVip && (
                                <Crown
                                  className="w-3.5 h-3.5 text-[#D4AF6A] shrink-0"
                                  aria-label="VIP стратегия"
                                />
                              )}
                            </div>
                            <div className="quant-rank-description text-[11px] text-[var(--text-muted)] whitespace-nowrap">
                              {s.category} · Риск: {s.risk}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-3 text-[var(--text-secondary)] whitespace-nowrap">
                        <span>{s.author}</span>
                        {s.isVip && (
                          <span className="ml-1.5 text-[10px] font-mono font-semibold text-[var(--text-gold)]">
                            VIP
                          </span>
                        )}
                      </td>
                      <td className="quant-rank-market py-3.5 px-3 font-mono text-xs text-[var(--text-primary)] whitespace-nowrap">
                        {s.market}
                      </td>
                      <td
                        className={`py-3.5 px-3 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                          periodFocus === "30D"
                            ? "text-[var(--text-teal)]"
                            : "text-[var(--text-emerald)]"
                        }`}
                      >
                        {percent(s.return30d, true)}
                      </td>
                      <td
                        className={`py-3.5 px-3 text-right font-mono font-medium tabular-nums whitespace-nowrap ${
                          periodFocus === "1Y"
                            ? "text-[var(--text-gold)] font-semibold"
                            : "text-[var(--text-primary)]"
                        }`}
                      >
                        {percent(s.return1yArithmetic, true)}
                      </td>
                      <td
                        className={`py-3.5 px-3 text-right font-mono font-medium tabular-nums whitespace-nowrap ${
                          periodFocus === "ALL"
                            ? "text-[var(--text-gold)] font-semibold"
                            : "text-[var(--text-secondary)]"
                        }`}
                      >
                        {percent(s.returnAllArithmetic, true)}
                      </td>
                      <td className="py-3.5 px-3 text-right font-mono text-[var(--text-crimson)] tabular-nums whitespace-nowrap">
                        {percent(s.maxDrawdown, false)}
                      </td>
                      <td className="py-3.5 px-3 text-right font-mono text-[var(--text-primary)] tabular-nums whitespace-nowrap">
                        {percent(s.winRate, false)}
                      </td>
                      <td className="py-3.5 px-3 text-right font-mono text-[var(--text-secondary)] tabular-nums whitespace-nowrap">
                        {numberText(s.minInvestmentUsdt, 0)} USDT
                      </td>
                      <td className="py-3.5 pl-3 pr-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenProfile(s.id);
                          }}
                          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                            isThomas
                              ? "bg-gradient-to-r from-[#F59E0B] via-[#FBBF24] to-[#FDE68A] text-[#080C1D] font-semibold hover:brightness-105"
                              : "bg-[var(--bg-subtle)] text-[var(--text-primary)] hover:bg-[var(--bg-muted)] border border-[var(--border-subtle)]"
                          }`}
                        >
                          Подробнее
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Tablet / Mobile Compact Strategy Rows (< 1024px) */}
      <div className="lg:hidden space-y-2.5">
        {filteredAndSorted.length === 0 ? (
          <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-6 text-center text-xs text-[var(--text-muted)]">
            Стратегии не найдены.{" "}
            <button
              type="button"
              onClick={resetFilters}
              className="text-[var(--text-gold)] underline ml-1"
            >
              Сбросить
            </button>
          </div>
        ) : (
          filteredAndSorted.map((s) => {
            const isThomas = s.id === "range";
            return (
              <div
                key={s.id}
                data-bot={s.id}
                data-roi={
                  Number.isFinite(s.return30d) ? s.return30d : undefined
                }
                onClick={() => onOpenProfile(s.id)}
                className={`relative overflow-hidden rounded-xl p-3.5 border transition-colors cursor-pointer ${
                  isThomas
                    ? "bg-[#FFFDF7] dark:bg-gradient-to-br dark:from-[#F59E0B]/15 dark:via-[#1E2B58]/85 dark:to-[#22D3EE]/12 border-[var(--border-gold)]"
                    : "bg-[var(--bg-surface)] border-[var(--border-subtle)]"
                }`}
              >
                <NeuralWebOverlay variant={isThomas ? "gold" : "subtle"} />
                <div className="relative z-10 flex items-start justify-between gap-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {renderRankBadge(s.rank)}
                    <StrategyLogo
                      strategyId={s.logoId ?? s.id}
                      customLogo={s.logoUrl}
                      size={36}
                      className="shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`font-semibold text-sm truncate ${
                            isThomas
                              ? "text-[var(--text-gold)]"
                              : "text-[var(--text-primary)]"
                          }`}
                        >
                          {s.name}
                        </span>
                        {s.isVip && (
                          <Crown className="w-3.5 h-3.5 text-[#D4AF6A] shrink-0" />
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)] truncate">
                        {s.market} · {s.author} · {s.risk}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] text-[var(--text-muted)]">
                      30Д
                    </div>
                    <div className="font-mono text-sm font-bold text-[var(--text-teal)] tabular-nums">
                      {percent(s.return30d, true)}
                    </div>
                  </div>
                </div>

                <div className="relative z-10 mt-3 pt-2.5 border-t border-[var(--border-subtle)] grid grid-cols-4 gap-2 text-[11px]">
                  <div>
                    <div className="text-[var(--text-muted)]">Год</div>
                    <div className="font-mono font-medium text-[var(--text-primary)] tabular-nums">
                      {percent(s.return1yArithmetic, true)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--text-muted)]">Весь</div>
                    <div className="font-mono font-medium text-[var(--text-secondary)] tabular-nums">
                      {percent(s.returnAllArithmetic, true)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--text-muted)]">Просадка</div>
                    <div className="font-mono text-[var(--text-crimson)] tabular-nums">
                      {percent(s.maxDrawdown, false)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[var(--text-muted)]">Мин. вход</div>
                    <div className="font-mono text-[var(--text-primary)] tabular-nums">
                      {numberText(s.minInvestmentUsdt, 0)} USDT
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <p className="mt-3 text-[11px] text-[var(--text-muted)]">
        {source === "model" ? "Показатели Thomas за условный год и весь период суммируются по месяцам." : source === "verified" ? "Доходность рассчитывается по подтверждённой истории стратегии." : "Для этих стратегий пока нет данных о доходности."}
      </p>
    </section>
  );
};
