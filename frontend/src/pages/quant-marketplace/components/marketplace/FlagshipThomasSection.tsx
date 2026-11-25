import { numberText, percent } from "../../data/catalogue";
import React, { useState } from "react";
import { ArrowUpRight, Award, Crown, Trophy } from "lucide-react";
import type { Strategy, TimeframeKey } from "../../types/strategy";
import { FlagshipPerformanceChart } from "../charts/StrategyCharts";
import { StrategyLogo } from "../logos/StrategyLogos";
import { PresentationCopyButton } from "./PresentationCopyButton";

interface FlagshipThomasSectionProps {
  strategy: Strategy;
  /** True only when this strategy has the highest 30-day result among the strategies it is ranked with. */
  leads30d: boolean;
  presentation?: boolean;
  onOpenProfile: (strategyId: string) => void;
}

const FLAGSHIP_TIMEFRAMES: { key: TimeframeKey; label: string }[] = [
  { key: "7D", label: "7Д" },
  { key: "30D", label: "30Д" },
  { key: "90D", label: "90Д" },
  { key: "1Y", label: "1Г" },
  { key: "ALL", label: "Всё время" },
];

/**
 * The flagship strategy as the first thing the page shows: the hero's right half.
 * One obsidian-and-gold card on a light page. Its own colour scope (see `.qx-flag` in light-stage.css)
 * re-points the shared text, border and chart variables, so the chart and figures inside need no copies.
 * The rank line and the VIP marks are statements of fact and are drawn only when the data says so.
 */
export const FlagshipThomasSection: React.FC<FlagshipThomasSectionProps> = ({
  strategy,
  leads30d,
  presentation = false,
  onOpenProfile,
}) => {
  const [tf, setTf] = useState<TimeframeKey>("30D");
  const activeSeries = strategy.series[tf];
  const latestVal = activeSeries[activeSeries.length - 1]?.value ?? NaN;
  const tfLabel = FLAGSHIP_TIMEFRAMES.find((t) => t.key === tf)?.label;

  return (
    <article className="qx-flag" data-vip={strategy.isVip ? "" : undefined}>
      <header className="qx-flag-top">
        <span className="qx-flag-rank">
          {leads30d ? (
            <>
              <Trophy aria-hidden="true" />
              <span>№ 1 по доходности за 30 дней</span>
            </>
          ) : (
            <>
              <Award aria-hidden="true" />
              <span>Избранная стратегия</span>
            </>
          )}
        </span>
        <span className="qx-flag-market">
          <b>{strategy.market}</b>
          <span aria-hidden="true">·</span>
          <span>{strategy.category}</span>
        </span>
      </header>

      <div className="qx-flag-id">
        <StrategyLogo
          strategyId={strategy.logoId ?? strategy.id}
          customLogo={strategy.logoUrl}
          size={56}
          className="qx-flag-logo shrink-0"
        />
        <div className="qx-flag-name">
          <h2>{strategy.name}</h2>
          <div className="qx-flag-author">
            <span className="qx-flag-avatar" title={strategy.author}>
              {strategy.avatar ? (
                <img src={strategy.avatar} alt="" />
              ) : (
                strategy.author[0]
              )}
              {strategy.isVip && <Crown aria-hidden="true" />}
            </span>
            <span>
              Автор: <strong>{strategy.author}</strong>
            </span>
            <span className="qx-flag-role">
              {strategy.isVip && <Crown aria-hidden="true" />}
              {strategy.isVip ? "VIP-автор" : "Автор стратегии"}
            </span>
          </div>
        </div>
        <div className="qx-flag-return">
          <span>
            {strategy.source === "model"
              ? "Модельная доходность"
              : "Доходность за период"}{" "}
            · {tfLabel}
          </span>
          <b>{percent(latestVal, true)}</b>
        </div>
      </div>

      <p className="qx-flag-lead">{strategy.shortDescription}</p>

      <div className="qx-flag-chart">
        <div className="qx-flag-tabs" role="group" aria-label="Период графика">
          {FLAGSHIP_TIMEFRAMES.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTf(item.key)}
              aria-pressed={tf === item.key}
            >
              {item.label}
            </button>
          ))}
        </div>
        <FlagshipPerformanceChart data={activeSeries} height={190} />
      </div>

      <dl className="qx-flag-stats">
        <div>
          <dt>Доходность 30Д</dt>
          <dd data-tone="up">{percent(strategy.return30d, true)}</dd>
        </div>
        <div>
          <dt>Годовой итог</dt>
          <dd data-tone="gold">{percent(strategy.return1yArithmetic, true)}</dd>
        </div>
        <div>
          <dt>{strategy.source === "model" ? "За весь период (24М)" : "За весь период"}</dt>
          <dd>{percent(strategy.returnAllArithmetic, true)}</dd>
        </div>
        <div>
          <dt>Макс. просадка</dt>
          <dd data-tone="down">{percent(strategy.maxDrawdown, false)}</dd>
        </div>
        <div>
          <dt>Прибыльные сделки</dt>
          <dd>
            {percent(strategy.winRate, false)}{" "}
            <small>({numberText(strategy.tradesCount, 0)})</small>
          </dd>
        </div>
        <div>
          <dt>Мин. инвестиция</dt>
          <dd>{numberText(strategy.minInvestmentUsdt, 0)} USDT</dd>
        </div>
      </dl>

      {(Number.isFinite(strategy.statistics.sharpeRatio) ||
        Number.isFinite(strategy.statistics.profitFactor)) && (
        <p className="qx-flag-ratios">
          Sharpe {numberText(strategy.statistics.sharpeRatio)} · Profit Factor{" "}
          {numberText(strategy.statistics.profitFactor)}
        </p>
      )}

      <footer className="qx-flag-foot">
        {presentation && <PresentationCopyButton />}
        <button type="button" className={presentation ? "qx-flag-detail" : undefined} onClick={() => onOpenProfile(strategy.id)}>
          <span>Подробнее о стратегии</span>
          <ArrowUpRight aria-hidden="true" />
        </button>
        {!presentation && <span>
          {strategy.source === "model"
            ? "Иллюстративная модель. Условные месяцы суммируются арифметически."
            : "Подтверждённая торговая история."}
        </span>}
      </footer>
    </article>
  );
};
