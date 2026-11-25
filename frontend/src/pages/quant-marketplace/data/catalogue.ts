import {
  BOT_CATALOGUE,
  botPresentation,
  maxDrawdown,
  presentationPeriod,
  type BotCreator,
} from "../../../lib/tradingBotsPresentation";
import {
  MODEL_FIRST_YEAR,
  MODEL_SECOND_YEAR,
  summedModelPercent,
} from "../../trading-bots/BotModelPerformance";
import { visuals } from "./visuals";
import { calculateThomasRiskScenario } from "./thomasRiskScenario";
import type {
  PerformancePoint,
  Strategy,
  MonthlyReturnEntry,
  TimeframeKey,
} from "../types/strategy";
import type { QuantPresentation } from "../../../../../src/shared/quantPresentation";
import type { BotHistory } from "../../../../../src/shared/thomasPerformance";
import type { Draft } from "../../trading-bots/QuantStudio";

export function numberText(value: number | null | undefined, digits = 2) {
  return Number.isFinite(value)
    ? value!.toLocaleString("ru-RU", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : "—";
}
export function percent(value: number | undefined, signed = false) {
  return Number.isFinite(value)
    ? (signed && value! > 0 ? "+" : "") + numberText(value) + "%"
    : "—";
}
function points(
  series: readonly number[],
  label: (i: number) => string,
): PerformancePoint[] {
  let peak = 100;
  return series.map((value, i) => {
    peak = Math.max(peak, 100 + value);
    return {
      value,
      date: label(i),
      drawdown: ((100 + value) / peak - 1) * 100,
    };
  });
}
function monthlyCurve(months: number[]) {
  const cumulative = months.map((_, i) =>
    summedModelPercent(months.slice(0, i + 1)),
  );
  return points([0, ...cumulative], (i) => "Месяц " + i);
}
export function catalogue(
  week: number,
  creators: Record<string, BotCreator>,
  thomasVip: boolean,
  history?: BotHistory,
  publications: Draft[] = [],
  presentation?: QuantPresentation,
): Strategy[] {
  const items = BOT_CATALOGUE.map((bot): Strategy => {
    const identity = visuals[bot.id as keyof typeof visuals];
    const model = botPresentation(bot, week);
    const isThomas = bot.id === "range";
    const scenario = isThomas ? presentation : undefined;
    const daily = scenario ? model.series.map(value => Math.round(value / model.roi * scenario.monthlyReturns[23] * 100) / 100) : model.series;
    const verified =
      isThomas && !scenario && history?.status === "verified" ? history : null;
    const monthly =
      isThomas && !verified
        ? scenario?.monthlyReturns ?? [...MODEL_FIRST_YEAR, ...MODEL_SECOND_YEAR, model.roi]
        : [];
    const day = (i: number) => "День " + i;
    const series: Strategy["series"] = {
      "7D": points(presentationPeriod(daily, 7), day),
      "30D": points(daily, day),
      "90D": monthly.length ? monthlyCurve(monthly.slice(-3)) : [],
      "1Y": monthly.length ? monthlyCurve(monthly.slice(-12)) : [],
      ALL: monthly.length ? monthlyCurve(monthly) : [],
    };
    if (verified)
      for (const key of Object.keys(series) as TimeframeKey[]) {
        const period = verified.periods[key];
        series[key] = points(period.series, (i) =>
          i === 0
            ? "Начало"
            : (period.observationDates?.[i - 1] ??
              (i === period.series.length - 1
                ? period.lastDate
                : i === 1
                  ? period.firstDate
                  : "Наблюдение " + i)),
        );
      }
    const monthly24: MonthlyReturnEntry[] = verified
      ? Object.values(verified.monthly.cells)
          .filter((c) => c.month !== null)
          .map((c) => ({
            year: c.year,
            monthIndex: c.month! - 1,
            monthShort: c.key,
            monthFull: c.key,
            returnPct: c.roi,
            tradesCount: c.trades ?? NaN,
            maxDrawdownPct: c.maximumDrawdown,
          }))
      : monthly.map((returnPct, i) => ({
          year: 1 + Math.floor(i / 12),
          monthIndex: i % 12,
          monthShort: "М" + (1 + (i % 12)),
          monthFull: "Месяц " + (1 + i),
          returnPct,
          tradesCount: NaN,
          maxDrawdownPct: NaN,
        }));
    const dist = new Map<number, number>();
    for (const { returnPct } of monthly24) {
      const k = Math.floor(returnPct / 10) * 10;
      dist.set(k, (dist.get(k) ?? 0) + 1);
    }
    const author = creators[bot.id];
    return {
      id: bot.id,
      rank: 0,
      name: bot.name,
      author: author?.displayName || "—",
      avatar: author?.avatarUrl ?? null,
      authorRole: author?.displayName
        ? "Автор стратегии"
        : "Данные автора отсутствуют",
      isVip: isThomas && thomasVip,
      isFeatured: isThomas,
      market: bot.symbol,
      category: identity.category,
      risk: bot.risk === "Высокий" ? "Повышенный" : bot.risk,
      intelligenceBuckets: [...identity.intelligenceBuckets],
      shortDescription: bot.description,
      methodologySummary: bot.detail,
      accentColor: identity.accentColor,
      secondaryColor: identity.secondaryColor,
      return30d: verified?.periods["30D"].roi ?? daily[daily.length - 1],
      return1yArithmetic:
        verified?.periods["1Y"].roi ?? series["1Y"].slice(-1)[0]?.value ?? NaN,
      returnAllArithmetic:
        verified?.periods.ALL.roi ?? series.ALL.slice(-1)[0]?.value ?? NaN,
      maxDrawdown: verified?.periods["30D"].drawdown ?? (scenario ? maxDrawdown(daily) : model.drawdown),
      winRate: verified
        ? (verified.periods["30D"].winRate ?? NaN)
        : scenario?.exampleWinRate ?? model.winRate,
      tradesCount: verified?.periods["30D"].trades ?? (scenario ? NaN : model.trades),
      minInvestmentUsdt: bot.minimum,
      horizonLabel: "30Д",
      behaviorTag: bot.strategy,
      series,
      monthly24,
      statistics: scenario && isThomas
        ? calculateThomasRiskScenario(scenario.monthlyReturns, scenario.exampleWinRate) ?? {}
        : {},
      distribution: [...dist]
        .sort(([a], [b]) => a - b)
        .map(([k, count]) => ({
          range: k + "…" + (k + 10) + "%",
          count,
          isPositive: k >= 0,
        })),
      riskControls: [
        bot.risk === "Высокий"
          ? "Повышенный риск колебаний."
          : "Умеренный профиль риска.",
      ],
      architecturePoints: [bot.strategy],
      verified: verified ?? undefined,
      source: verified ? "verified" : "model",
      netPnl: verified?.periods.ALL.netPnl ?? null,
    };
  });
  for (const draft of publications) {
    const settings = draft.settings;
    items.push({
      id: draft.id,
      rank: 0,
      name: draft.name,
      author: draft.owner?.displayName || "—",
      authorRole: "Автор публикации",
      avatar: null,
      isVip: false,
      isFeatured: false,
      market: draft.pair,
      category: settings?.category ?? "Quantitative Intelligence",
      risk: settings?.risk ?? "Умеренный",
      intelligenceBuckets: [],
      shortDescription: draft.description,
      methodologySummary: draft.description,
      accentColor: "#14B8A6",
      secondaryColor: "#5EEAD4",
      return30d: NaN,
      return1yArithmetic: NaN,
      returnAllArithmetic: NaN,
      maxDrawdown: NaN,
      winRate: NaN,
      tradesCount: NaN,
      minInvestmentUsdt: settings?.minInvestmentUsdt ?? NaN,
      horizonLabel: "—",
      behaviorTag: "Опубликованная карточка",
      series: { "7D": [], "30D": [], "90D": [], "1Y": [], ALL: [] },
      monthly24: [],
      statistics: {},
      distribution: [],
      riskControls: [],
      architecturePoints: [],
      source: "unavailable",
      netPnl: null,
      logoUrl: settings?.customLogoUrl,
      logoId: settings?.presetLogoId,
    });
  }
  return items;
}
