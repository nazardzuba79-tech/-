import { thomasCoverage } from "../thomasCoverage";
import {
  authorUrl,
  SOCIAL_NAMES,
  type Network,
} from "../../shared/thomasAuthor";
import { buildBotHistory } from "../tradingBotPerformance";
import type { LiveFrame } from "../marketData/live/contract";
import type { LiveTicker } from "../marketData/bybit/types";

const owner = "85bb5e78-7f14-43e1-a5e4-7a0becf14a60";
const legacy = () => require("../../../scripts/qa-thomas-snapshot.cjs")(owner);
const ticker = (
  baseAsset: string,
  overrides: Partial<LiveTicker> = {},
): LiveTicker =>
  ({
    baseAsset,
    marketType: "spot",
    quoteAsset: "USDT",
    stale: false,
    receivedAt: 120000,
    lastPrice: 2,
    changePercent24h: 1,
    quoteVolume24h: 10,
    ...overrides,
  }) as LiveTicker;
test("one shared snapshot ranks liquid fresh distinct spot assets, ages out and never opens a subscription", () => {
  let now = 120001;
  const rows = [
    ...Array.from({ length: 101 }, (_, i) =>
      ticker("A" + i, {
        quoteVolume24h: 100 + i,
        changePercent24h: i === 0 ? -1 : 1,
      }),
    ),
    ticker("A1"),
    ticker("OLD", { receivedAt: 2 }),
    ticker("FUT", { marketType: "linear_perpetual" }),
    ticker("BAD", { lastPrice: null }),
    ticker("EUR", { quoteAsset: "EUR" }),
  ];
  const source = {
    subscribe: jest.fn(),
    snapshot: jest.fn(() => ({ status: "live", rows }) as LiveFrame),
  };
  const get = thomasCoverage(source, () => now);
  for (let i = 0; i < 100; i++)
    expect(get()).toMatchObject({ assets: 100, advancing: 100, declining: 0 });
  expect(source.snapshot).toHaveBeenCalledTimes(1);
  expect(source.subscribe).not.toHaveBeenCalled();
  now += 61000;
  expect(get()).toEqual({ status: "unavailable" });
  expect(thomasCoverage(null)()).toEqual({ status: "unavailable" });
});
test("legacy history stays attributed to its pair; multi-asset snapshot exposes only dated aggregate exposure", () => {
  const v1 = legacy(),
    { pair, ...common } = v1;
  const original = buildBotHistory(v1, owner);
  const input = {
    ...common,
    version: 2,
    universe: "multi-asset",
    portfolio: {
      asOf: v1.asOf,
      equityUsdt: "1000",
      positions: [
        { asset: "BTC", netNotionalUsdt: "400" },
        { asset: "ETH", netNotionalUsdt: "-100" },
      ],
    },
  };
  const next = buildBotHistory(input, owner);
  expect(original).toMatchObject({
    status: "verified",
    marketScope: "XRP/USDT",
  });
  expect(next).toMatchObject({
    marketScope: "multi-asset",
    portfolio: {
      grossPct: 50,
      netPct: 30,
      weights: [
        { asset: "BTC", pct: 40 },
        { asset: "ETH", pct: -10 },
      ],
    },
  });
  if (next.status !== "verified" || original.status !== "verified")
    throw Error("missing history");
  expect(next.periods).toEqual(original.periods);
  expect(next.monthly).toEqual(original.monthly);
  expect(next).not.toHaveProperty("days");
  expect(() => buildBotHistory(input, "another-author")).toThrow();
  expect(() =>
    buildBotHistory(
      {
        ...input,
        portfolio: {
          ...input.portfolio,
          positions: [
            input.portfolio.positions[0],
            input.portfolio.positions[0],
          ],
        },
      },
      owner,
    ),
  ).toThrow();
});
test("all eight channels accept profile URLs on their matching service", () => {
  const urls: Record<Network, string> = {
    telegram: "https://t.me/quant_owner",
    x: "https://x.com/quant_owner",
    instagram: "https://www.instagram.com/quant.owner/",
    youtube: "https://www.youtube.com/@quantowner",
    vk: "https://vk.com/quantowner",
    facebook: "https://www.facebook.com/quant.owner",
    threads: "https://www.threads.net/@quantowner",
    website: "https://quant-owner.com/about",
  };
  for (const k of Object.keys(SOCIAL_NAMES) as Network[])
    expect(authorUrl(k, urls[k])).toMatch(/^https:\/\//);
});
test.each([
  ["instagram", "https://instagram.com.example.org/a"],
  ["x", "https://t.me/quant_owner"],
  ["youtube", "https://youtube.com/watch?v=id"],
  ["website", "javascript:alert(1)"],
  ["website", "https://127.0.0.1/"],
  ["website", "https://alice:secret@example.com"],
  ["vk", "https://vk.com/away.php"],
])("rejects mismatched or unsafe %s URL", (k, v) =>
  expect(() => authorUrl(k as Network, v)).toThrow(),
);
