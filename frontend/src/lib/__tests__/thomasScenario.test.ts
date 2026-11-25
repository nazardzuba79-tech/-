import { scenarioCapital } from "../thomasScenario";
test("illustrative monthly reinvestment preserves the opening capital and permits a loss", () => {
  expect(scenarioCapital(5000, 2, 12)[12].capital).toBeCloseTo(6341.21, 2);
  expect(scenarioCapital(5000, 0, 24).map((p) => p.capital)).toEqual(
    Array(25).fill(5000),
  );
  expect(scenarioCapital(5000, -100, 3).map((p) => p.capital)).toEqual([
    5000, 0, 0, 0,
  ]);
  expect(scenarioCapital(2500, -10, 1)[1].capital).toBe(2250);
});
test.each([
  [0, 1, 1],
  [0.001, 1, 1],
  [NaN, 2, 12],
  [5000, Infinity, 12],
  [5000, -101, 12],
  [5000, 2, 18],
])("rejects invalid scenario %s/%s/%s", (initial, rate, months) =>
  expect(scenarioCapital(initial, rate, months)).toEqual([]),
);

it("accepts explicitly entered rates above 100% and rejects overflow", () => {
  expect(scenarioCapital(5000, 180.26, 1)[1].capital).toBeCloseTo(14013, 2);
  expect(scenarioCapital(1e300, 1e20, 24)).toEqual([]);
});

test("6-month option calculates compounding from the 24-month scenario", () => {
  const reference = 7348;
  const rate = ((1 + reference / 100) ** (1 / 24) - 1) * 100;
  const series = scenarioCapital(5000, rate, 6);
  expect(series).toHaveLength(7);
  expect(series[0].capital).toBe(5000);
  expect(series[6].capital).toBeCloseTo(5000 * (1 + reference / 100) ** (6 / 24), 4);
  expect(scenarioCapital(5000, rate, 24)[24].capital).toBeCloseTo(372400, 2);
});
