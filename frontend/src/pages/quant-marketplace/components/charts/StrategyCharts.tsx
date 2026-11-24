import { numberText, percent } from "../../data/catalogue";
import React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  DistributionBucket,
  MonthlyReturnEntry,
  PerformancePoint,
} from "../../types/strategy";

interface TooltipPayloadItem {
  name?: string;
  value?: number;
  payload?: PerformancePoint;
}

const QuantTooltip: React.FC<{
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
  accentColor?: string;
  showBenchmark?: boolean;
}> = ({
  active,
  payload,
  label,
  accentColor = "#0F766E",
  showBenchmark = false,
}) => {
  if (!active || !payload || !payload.length) return null;
  const pt = payload[0]?.payload;
  const val = typeof pt?.value === "number" ? pt.value : 0;
  const dd = typeof pt?.drawdown === "number" ? pt.drawdown : 0;
  const bench = typeof pt?.benchmark === "number" ? pt.benchmark : undefined;

  return (
    <div className="bg-white/95 dark:bg-[#0D132B]/95 border border-slate-200 dark:border-indigo-400/25 rounded-lg px-3 py-2 shadow-lg backdrop-blur-md text-xs">
      <div className="text-[var(--text-muted)] font-mono mb-1">
        Период: {label}
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-[var(--text-secondary)]">
          Модельная доходность
        </span>
        <span
          className="font-mono font-semibold tabular-nums"
          style={{ color: val >= 0 ? accentColor : "var(--text-crimson)" }}
        >
          {val >= 0 ? `+${val.toFixed(2)}%` : `${val.toFixed(2)}%`}
        </span>
      </div>
      <div className="flex items-center justify-between gap-4 mt-0.5">
        <span className="text-[var(--text-muted)]">Просадка</span>
        <span className="font-mono text-[var(--text-crimson)] tabular-nums">
          {dd.toFixed(2)}%
        </span>
      </div>
      {showBenchmark && bench !== undefined && (
        <div className="flex items-center justify-between gap-4 mt-0.5 pt-1 border-t border-[var(--border-subtle)]">
          <span className="text-[var(--text-muted)]">Базовый индекс</span>
          <span className="font-mono text-[var(--text-secondary)] tabular-nums">
            {bench >= 0 ? `+${bench.toFixed(2)}%` : `${bench.toFixed(2)}%`}
          </span>
        </div>
      )}
    </div>
  );
};

export const MiniSparkChart: React.FC<{
  data: PerformancePoint[];
  accentColor: string;
  secondaryColor?: string;
  chartId: string;
  height?: number;
  showAxes?: boolean;
}> = ({
  data,
  accentColor,
  secondaryColor,
  chartId,
  height = 96,
  showAxes = true,
}) => {
  const safeId = `grad-${chartId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const strokeId = `stroke-${chartId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  return (
    <div style={{ width: "100%", height }} className="select-none">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 6, right: 4, left: showAxes ? -2 : 4, bottom: 0 }}
        >
          <defs>
            <linearGradient id={safeId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={accentColor} stopOpacity={0.26} />
              <stop offset="100%" stopColor={accentColor} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id={strokeId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={accentColor} />
              <stop offset="100%" stopColor={secondaryColor || accentColor} />
            </linearGradient>
          </defs>
          {showAxes && (
            <CartesianGrid
              stroke="var(--chart-grid)"
              strokeDasharray="2 3"
              vertical={false}
            />
          )}
          <XAxis
            dataKey="date"
            hide={!showAxes}
            tick={{ fill: "var(--chart-axis)", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            hide={!showAxes}
            tick={{ fill: "var(--chart-axis)", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v}%`}
            width={42}
          />
          <ReferenceLine
            y={0}
            stroke="var(--chart-ref)"
            strokeDasharray="2 2"
          />
          <Tooltip
            cursor={{
              stroke: "rgba(180,137,56,0.55)",
              strokeWidth: 1,
              strokeDasharray: "3 3",
            }}
            content={
              <QuantTooltip accentColor={secondaryColor || accentColor} />
            }
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={`url(#${strokeId})`}
            strokeWidth={2.1}
            fill={`url(#${safeId})`}
            isAnimationActive={false}
            activeDot={{
              r: 3.5,
              fill: accentColor,
              stroke: "var(--bg-surface)",
              strokeWidth: 1.5,
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export const FlagshipPerformanceChart: React.FC<{
  data: PerformancePoint[];
  height?: number;
}> = ({ data, height = 240 }) => {
  return (
    <div style={{ width: "100%", height }} className="select-none">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 10, right: 8, left: 0, bottom: 2 }}
        >
          <defs>
            <linearGradient id="thomasGoldTealFill" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#FBBF24" stopOpacity={0.34} />
              <stop offset="50%" stopColor="#22D3EE" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#A855F7" stopOpacity={0.04} />
            </linearGradient>
            <linearGradient
              id="thomasGoldTealStroke"
              x1="0"
              y1="0"
              x2="1"
              y2="0"
            >
              <stop offset="0%" stopColor="#F59E0B" />
              <stop offset="50%" stopColor="#FCD34D" />
              <stop offset="100%" stopColor="#22D3EE" />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke="var(--chart-grid)"
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
            axisLine={{ stroke: "var(--chart-grid)" }}
            tickLine={false}
            minTickGap={16}
          />
          <YAxis
            tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}%`}
            width={48}
          />
          <ReferenceLine y={0} stroke="var(--chart-ref)" />
          <Tooltip
            cursor={{
              stroke: "#FBBF24",
              strokeWidth: 1,
              strokeDasharray: "3 3",
            }}
            content={<QuantTooltip accentColor="#22D3EE" showBenchmark />}
          />
          <Area
            type="monotone"
            dataKey="benchmark"
            stroke="#64748B"
            strokeWidth={1.3}
            strokeDasharray="4 4"
            fill="none"
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="url(#thomasGoldTealStroke)"
            strokeWidth={2.5}
            fill="url(#thomasGoldTealFill)"
            isAnimationActive={false}
            activeDot={{
              r: 4.5,
              fill: "#D4AF6A",
              stroke: "var(--bg-surface)",
              strokeWidth: 2,
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export const TerminalPerformanceChart: React.FC<{
  data: PerformancePoint[];
  accentColor: string;
  secondaryColor: string;
  showBenchmark?: boolean;
  height?: number;
}> = ({
  data,
  accentColor,
  secondaryColor,
  showBenchmark = true,
  height = 340,
}) => {
  return (
    <div style={{ width: "100%", height }} className="select-none">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 14, right: 12, left: 0, bottom: 4 }}
        >
          <defs>
            <linearGradient id="terminalAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={secondaryColor} stopOpacity={0.26} />
              <stop offset="65%" stopColor={accentColor} stopOpacity={0.07} />
              <stop offset="100%" stopColor={accentColor} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="terminalStrokeGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={accentColor} />
              <stop offset="100%" stopColor={secondaryColor} />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke="var(--chart-grid)"
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
            axisLine={{ stroke: "var(--chart-grid)" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}%`}
            width={52}
          />
          <ReferenceLine y={0} stroke="var(--chart-ref)" />
          <Tooltip
            cursor={{
              stroke: accentColor,
              strokeWidth: 1,
              strokeDasharray: "3 3",
            }}
            content={
              <QuantTooltip
                accentColor={secondaryColor}
                showBenchmark={showBenchmark}
              />
            }
          />
          {showBenchmark && (
            <Area
              type="monotone"
              dataKey="benchmark"
              stroke="#64748B"
              strokeWidth={1.4}
              strokeDasharray="4 4"
              fill="none"
              isAnimationActive={false}
            />
          )}
          <Area
            type="monotone"
            dataKey="value"
            stroke="url(#terminalStrokeGrad)"
            strokeWidth={2.5}
            fill="url(#terminalAreaGrad)"
            isAnimationActive={false}
            activeDot={{
              r: 5,
              fill: accentColor,
              stroke: "var(--bg-surface)",
              strokeWidth: 2,
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export const MonthlyBarChart: React.FC<{
  entries: MonthlyReturnEntry[];
  height?: number;
}> = ({ entries, height = 270 }) => {
  return (
    <div style={{ width: "100%", height }} className="select-none">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={entries}
          margin={{ top: 12, right: 8, left: 0, bottom: 2 }}
        >
          <CartesianGrid
            stroke="var(--chart-grid)"
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis
            dataKey="monthShort"
            tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
            axisLine={{ stroke: "var(--chart-grid)" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}%`}
            width={46}
          />
          <ReferenceLine y={0} stroke="var(--chart-ref)" />
          <Tooltip
            cursor={{ fill: "rgba(148,163,184,0.08)" }}
            content={({ active, payload }) => {
              if (!active || !payload || !payload.length) return null;
              const item = payload[0]?.payload as MonthlyReturnEntry;
              return (
                <div className="bg-white/95 dark:bg-[#0D132B]/95 border border-slate-200 dark:border-indigo-400/25 rounded-lg px-3 py-2 text-xs shadow-lg">
                  <div className="font-medium text-[var(--text-primary)] mb-1">
                    {item.monthFull} {item.year}
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[var(--text-muted)]">
                      Модельный результат
                    </span>
                    <span
                      className={`font-mono font-semibold tabular-nums ${
                        item.returnPct >= 0
                          ? "text-[var(--text-teal)]"
                          : "text-[var(--text-crimson)]"
                      }`}
                    >
                      {item.returnPct >= 0
                        ? `+${item.returnPct.toFixed(1)}%`
                        : `${item.returnPct.toFixed(1)}%`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4 mt-0.5">
                    <span className="text-[var(--text-muted)]">
                      Сделок в модели
                    </span>
                    <span className="font-mono text-[var(--text-primary)] tabular-nums">
                      {numberText(item.tradesCount, 0)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4 mt-0.5">
                    <span className="text-[var(--text-muted)]">
                      Внутримесячная просадка
                    </span>
                    <span className="font-mono text-[var(--text-crimson)] tabular-nums">
                      {percent(item.maxDrawdownPct)}
                    </span>
                  </div>
                </div>
              );
            }}
          />
          <Bar
            dataKey="returnPct"
            radius={[4, 4, 0, 0]}
            maxBarSize={32}
            isAnimationActive={false}
          >
            {entries.map((entry, idx) => (
              <Cell
                key={`${entry.year}-${entry.monthIndex}-${idx}`}
                fill={
                  entry.returnPct >= 0
                    ? entry.returnPct >= 8
                      ? "#F59E0B"
                      : "#22D3EE"
                    : "#FB7185"
                }
                fillOpacity={entry.returnPct >= 0 ? 0.92 : 0.86}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export const DistributionChart: React.FC<{
  buckets: DistributionBucket[];
  height?: number;
}> = ({ buckets, height = 220 }) => {
  return (
    <div style={{ width: "100%", height }} className="select-none">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={buckets}
          margin={{ top: 10, right: 8, left: 0, bottom: 2 }}
        >
          <CartesianGrid
            stroke="var(--chart-grid)"
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis
            dataKey="range"
            tick={{ fill: "var(--chart-axis)", fontSize: 10 }}
            axisLine={{ stroke: "var(--chart-grid)" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "var(--chart-axis)", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          <Tooltip
            cursor={{ fill: "rgba(148,163,184,0.08)" }}
            content={({ active, payload }) => {
              if (!active || !payload || !payload.length) return null;
              const b = payload[0]?.payload as DistributionBucket;
              return (
                <div className="bg-white/95 dark:bg-[#0D132B]/95 border border-slate-200 dark:border-indigo-400/25 rounded-lg px-3 py-2 text-xs shadow-lg">
                  <div className="text-[var(--text-muted)] mb-1">
                    Диапазон сделки: {b.range}
                  </div>
                  <div className="font-mono font-semibold text-[var(--text-primary)] tabular-nums">
                    {b.count} мес.
                  </div>
                </div>
              );
            }}
          />
          <Bar
            dataKey="count"
            radius={[4, 4, 0, 0]}
            maxBarSize={36}
            isAnimationActive={false}
          >
            {buckets.map((b, idx) => (
              <Cell
                key={`${b.range}-${idx}`}
                fill={b.isPositive ? "#34D399" : "#FB7185"}
                fillOpacity={0.86}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
