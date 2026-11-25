import { readBotCreators } from '../tradingBotsPresentation';
import { catalogue } from "../../pages/quant-marketplace/data/catalogue";
import { BOT_CATALOGUE } from "../tradingBotsPresentation";
import type { BotHistory } from "../../../../src/shared/thomasPerformance";
const owner = {
  range: { displayName: "Public name", avatarUrl: "/author.png" },
};
it("uses catalogue identity and the same ordinal monthly results across every model window", () => {
  const list = catalogue(20, owner, false, { status: "unavailable" });
  expect(list.map((s) => s.id)).toEqual(BOT_CATALOGUE.map((s) => s.id));
  expect(list.map((s) => s.minInvestmentUsdt)).toEqual(Array(7).fill(5000));
  const s = list.find((s) => s.id === "range")!;
  expect([
    s.author,
    s.avatar,
    s.isVip,
    s.return30d,
    s.minInvestmentUsdt,
  ]).toEqual(["Public name", "/author.png", false, 180.26, 5000]);
  expect(s.monthly24).toHaveLength(24);
  expect(new Set(s.monthly24.map((m) => m.year))).toEqual(new Set([1, 2]));
  for (const [period, start] of [
    ["90D", 21],
    ["1Y", 12],
    ["ALL", 0],
  ] as const) {
    expect(s.series[period].slice(-1)[0].value).toBeCloseTo(
      s.monthly24.slice(start).reduce((a, m) => a + m.returnPct, 0),
      8,
    );
  }
  expect(s.monthly24[23].returnPct).toBe(s.return30d);
  expect(s.statistics).toEqual({});
  expect(s.netPnl).toBeNull();
  expect(list.find((s) => s.id === "atlas")!.series["1Y"]).toEqual([]);
});
it("uses the supplied verified periods and true observation dates, with no model months mixed in", () => {
  const period = {
    firstDate: "2026-03-03",
    lastDate: "2026-03-08",
    observationDates: ["2026-03-03", "2026-03-08"],
    roi: 2,
    netPnl: -5,
    realizedPnl: null,
    unrealizedChange: null,
    fees: 1,
    trades: 2,
    winRate: 50,
    drawdown: 1,
    series: [0, -1, 2],
  };
  const history: BotHistory = {
    status: "verified",
    botId: "range",
    strategyId: "thomas-quant-ai",
    inceptionDate: period.firstDate,
    asOf: period.lastDate,
    periods: {
      "7D": period,
      "30D": period,
      "90D": period,
      "1Y": period,
      ALL: period,
    },
    monthly: {
      methodology: "DAILY_TWR",
      years: [],
      cells: {},
      latestKey: null,
    },
  };
  const s = catalogue(20, owner, true, history).find((s) => s.id === "range")!;
  expect([s.source, s.isVip, s.return30d, s.netPnl]).toEqual([
    "verified",
    true,
    2,
    -5,
  ]);
  expect(s.series.ALL.map((v) => v.date)).toEqual([
    "Начало",
    "2026-03-03",
    "2026-03-08",
  ]);
  expect(s.monthly24).toEqual([]);
});

it('keeps the catalogue available when creator data is absent or partial', () => {
  for (const response of [null, {}, { creators: [] }]) expect(readBotCreators(response)).toEqual({});
  expect(readBotCreators({ creators: { range: { displayName: 'Thomas' }, atlas: { displayName: {} } } }))
    .toEqual({range: {displayName: 'Thomas', avatarUrl: null}, atlas: {displayName: null, avatarUrl: null}});
});
