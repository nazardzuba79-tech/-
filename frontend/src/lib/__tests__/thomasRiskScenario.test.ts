import { calculateThomasRiskScenario } from "../../pages/quant-marketplace/data/thomasRiskScenario";
import { catalogue } from "../../pages/quant-marketplace/data/catalogue";
import { examplePresentation } from "../../../../src/services/quantPresentation";

test("24-month hypothetical trade sample reproduces +7348% and all eleven risk values", () => {
  const example = examplePresentation();
  const s = calculateThomasRiskScenario(example.monthlyReturns, example.exampleWinRate);
  expect(s).not.toBeNull();
  expect(s!.sharpeRatio).toBeCloseTo(5.5618549405, 6);
  expect(s!.sortinoRatio).toBeCloseTo(5.9009051519, 6);
  expect(s!.calmarRatio).toBeCloseTo(22.187204432, 6);
  expect(s!.profitFactor).toBeCloseTo(2.8939024896, 6);
  expect(s!.recoveryFactor).toBeCloseTo(9.0269607279, 6);
  expect(s!.annualizedVolatility).toBeCloseTo(40.4001499835, 6);
  expect(s!.avgWinPct).toBeCloseTo(0.7614825413, 6);
  expect(s!.avgLossPct).toBe(-10);
  expect(s!.expectancyPct).toBeCloseTo(0.4493995476, 6);
  expect(s!.maxConsecutiveWins).toBe(96);
  expect(s!.maxConsecutiveLosses).toBe(4);
  expect(971 * Math.log1p(s!.avgWinPct / 100)
    + 29 * Math.log1p(s!.avgLossPct / 100))
    .toBeCloseTo(Math.log(1 + 7348 / 100), 8);
});

test("risk model applies only to invited Thomas scenario and never to verified/source-free data", () => {
  const example = examplePresentation();
  const showcased = catalogue(20, {}, false, undefined, [], example);
  const thomas = showcased.find(s => s.id === "range")!;
  expect(thomas.statistics.sharpeRatio).toBeCloseTo(5.56, 2);
  expect(thomas.returnAllArithmetic).toBe(7348);
  expect(thomas.winRate).toBe(97.1);
  expect(showcased.filter(s => s.id !== "range").every(s => !s.statistics.sharpeRatio)).toBe(true);

  const ordinary = catalogue(20, {}, false, { status: "unavailable" });
  expect(ordinary.find(s => s.id === "range")?.statistics).toEqual({});
  expect(calculateThomasRiskScenario([], 97.1)).toBeNull();
  expect(calculateThomasRiskScenario(example.monthlyReturns, 70)).toBeNull();
  expect(calculateThomasRiskScenario([...Array(23).fill(306), NaN], 97.1)).toBeNull();
});
