import "@fontsource-variable/plus-jakarta-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import "@fontsource-variable/outfit/index.css";
import React, { useEffect, useMemo, useState, useRef } from "react";
import { ArrowDownRight, HelpCircle, X } from "lucide-react";
import { NeuralBlockchainBackdrop } from "./components/background/NeuralBlockchainBackdrop";
import { NeuralWebOverlay } from "./components/background/NeuralWebOverlay";
import type { ThemeMode } from "./types/theme";
import { useLocation, useNavigate } from "react-router-dom";
import { request } from "../../lib/api";
import {
  presentationWeek,
  nextPresentationWeek,
  type BotCreator,
  readBotCreators,
} from "../../lib/tradingBotsPresentation";
import { useStudio, type Draft } from "../trading-bots/QuantStudio";
import { useBotHistory } from "../trading-bots/BotHistoryPanel";
import { catalogue } from "./data/catalogue";
import { AcademySection } from "./components/marketplace/AcademySection";
import { FlagshipThomasSection } from "./components/marketplace/FlagshipThomasSection";
import { LeaderboardSection } from "./components/marketplace/LeaderboardSection";
import { QuantIntelligenceSection } from "./components/marketplace/QuantIntelligenceSection";
import { VipProgramSection } from "./components/marketplace/VipProgramSection";
import { StrategyProfileView } from "./components/profile/StrategyProfileView";
import { BotStudioView } from "./components/studio/BotStudioView";
import { ACADEMY_ARTICLES, FAQ_ITEMS } from "./data/learning";

// The marketplace is shown on its light stage only (owner, 25 Nov 2026). The dark values stay in the
// stylesheet, so a second theme can return by making this a state again.
const QUANT_THEME: ThemeMode = "light";

export default function App({presentation}: {presentation?: import("../../../../src/shared/quantPresentation").QuantPresentation}) {
  const base = presentation ? "/trading-bots/presentation" : "/trading-bots";
  const theme = QUANT_THEME;

  const studio = useStudio();
  const history = useBotHistory(!presentation);
  const [creators, setCreators] = useState<Record<string, BotCreator>>({});
  const [now, setNow] = useState(Date.now);
  const root = useRef<HTMLDivElement>(null);
  const location = useLocation(),
    navigate = useNavigate();
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    request<unknown>(
      "/trading-bots/creators",
      { signal: controller.signal },
    )
      .then((r) => {
        if (!controller.signal.aborted) setCreators(readBotCreators(r));
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(1, nextPresentationWeek(now) - Date.now() + 5),
    );
    return () => clearTimeout(timer);
  }, [now]);
  const publishedId = /^\/trading-bots\/strategy\/([a-f0-9-]{36})\/?$/i.exec(location.pathname)?.[1];
  const missingPublication = studio.data && publishedId && !studio.data.published.some(row=>row.id===publishedId) ? publishedId : null;
  const [shared,setShared]=useState<Draft|null>(null);
  useEffect(()=>{
    setShared(null);if(!missingPublication)return;
    const controller=new AbortController();
    request<Draft>('/trading-bots/studio/published/'+encodeURIComponent(missingPublication),{signal:controller.signal})
      .then(row=>{if(!controller.signal.aborted && row.id===missingPublication)setShared(row)}).catch(()=>{});
    return ()=>controller.abort();
  },[missingPublication]);
  const strategies = useMemo(
    () =>
      catalogue(
        presentationWeek(now),
        creators,
        studio.data?.thomasVip === true,
        history.data,
        shared && shared.id===missingPublication ? [...(studio.data?.published??[]),shared] : studio.data?.published,
        presentation,
      ),
    [now, creators, studio.data, history.data, shared,missingPublication,presentation],
  );
  const thomasStrategy = strategies.find((s) => s.id === "range")!;
  // "№ 1" is said only when it is true: the best 30-day result among the strategies it is ranked with.
  const rankedWithThomas = strategies.filter(
    (s) => s.source === thomasStrategy.source && Number.isFinite(s.return30d),
  );
  const thomasLeads30d =
    Number.isFinite(thomasStrategy.return30d) &&
    rankedWithThomas.length > 1 &&
    rankedWithThomas.every((s) => s.return30d <= thomasStrategy.return30d);
  const path = location.pathname.slice(base.length)
    .replace(/^\//, "")
    .replace(/\/$/, "");
  const activeView =
    path === "studio"
      ? "bot-studio"
      : path === ""
        ? "marketplace"
        : "strategy-profile";
  const selectedStrategy = strategies.find(
    (s) =>
      path === "strategy/" + s.id ||
      (s.id === "range" && path === "strategy/thomas-quant-ai"),
  );
  const handleOpenProfile = (id: string) =>
    navigate(base + "/strategy/" + encodeURIComponent(id));
  const handleOpenBotStudio = () => navigate("/trading-bots/studio");
  const handleNavigateMarketplace = (id?: string) =>
    navigate(base + (id ? "#" + id : ""));
  useEffect(() => {
    if (location.hash === "#quant-academy")
      root.current?.querySelector("#quant-academy")?.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [location.pathname, location.hash]);

  return (
    <div
      ref={root}
      data-quant-theme={theme}
      className={`quant-skin ${theme} relative min-h-screen text-[var(--text-primary)] flex flex-col transition-colors duration-200`}
    >
      <NeuralBlockchainBackdrop theme={theme} />
      <div className="relative z-10 flex-1 flex flex-col">
        {history.error && (
          <p role="status" className="quant-data">
            Не удалось загрузить историю доходности.
          </p>
        )}
        <main className="flex-1">
          {presentation && <details className="qx-source">
            <summary>Презентационный сценарий · методика</summary>
            <p>Показатели иллюстрируют работу интерфейса. Итог за 24 условных месяца — сумма месячных процентов без реинвестирования. Доля прибыльных операций задана для сценария. Калькулятор использует введённые вами предположения.</p>
          </details>}
          {activeView === "marketplace" && (
            <>
              {/* Compact Institutional Hero Section */}
              <section
                className="qx-hero relative overflow-hidden border-b border-[var(--border-subtle)] transition-colors"
                style={{
                  background:
                    "linear-gradient(180deg, var(--bg-hero-from) 0%, var(--bg-hero-via) 55%, var(--bg-hero-to) 100%)",
                }}
              >
                <NeuralWebOverlay variant="hero" />
                <div className="relative z-10 max-w-[1600px] mx-auto px-3 sm:px-6 py-6 sm:py-8 lg:py-9">
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-center">
                    {/* Left Headline & Actions */}
                    <div className="qx-hero-copy lg:col-span-5 space-y-4">
                      <div className="qx-eyebrow quant-hero-eyebrow text-xs font-semibold text-[var(--text-gold)] tracking-wide">
                        Институциональная витрина алгоритмов VOLTEX
                      </div>

                      <h1 className="qx-h1 font-display text-3xl sm:text-4xl lg:text-[42px] font-bold tracking-tight text-[var(--text-primary)] dark:bg-gradient-to-r dark:from-[#F8FAFC] dark:via-[#BAE6FD] dark:to-[#FCD34D] dark:bg-clip-text dark:text-transparent leading-[1.12] text-balance">
                        VOLTEX Quant Marketplace
                      </h1>

                      <p className="qx-lead text-sm sm:text-base text-[var(--text-secondary)] max-w-xl leading-relaxed">
                        Авторские стратегии. Интеллектуальная аналитика. Новый
                        подход к торговле.
                      </p>

                      <div className="qx-cta flex flex-wrap items-center gap-3 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            const el = root.current?.querySelector(
                              "#strategy-leaderboard",
                            );
                            el?.scrollIntoView({
                              behavior: "smooth",
                              block: "start",
                            });
                          }}
                          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-[#D4AF6A] to-[#E5C98B] text-[#08090C] hover:brightness-105 shadow-xs transition-all whitespace-nowrap cursor-pointer"
                        >
                          <span>Исследовать стратегии</span>
                          <ArrowDownRight className="w-4 h-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => setHowItWorksOpen(true)}
                          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-[var(--bg-surface)] border border-[var(--border-strong)] text-[var(--text-primary)] hover:border-[var(--border-gold)] hover:bg-[var(--bg-subtle)] transition-colors whitespace-nowrap cursor-pointer"
                        >
                          <HelpCircle className="w-4 h-4 text-[var(--text-gold)]" />
                          <span>Как это работает</span>
                        </button>
                      </div>

                      {/* Concise model disclosure inline */}
                      <div className="qx-facts pt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
                        <span>
                          <b>7</b> модельных стратегий
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          <b>24</b>-месячная аналитика
                        </span>
                        {!presentation && <span aria-hidden="true">·</span>}
                        {!presentation && <span>Иллюстративный набор данных для презентации</span>}
                      </div>
                    </div>

                    {/* The flagship strategy itself: the product is the first thing the page shows */}
                    <div className="qx-hero-visual lg:col-span-7">
                      <FlagshipThomasSection
                        strategy={thomasStrategy}
                        leads30d={thomasLeads30d}
                        presentation={!!presentation}
                        onOpenProfile={handleOpenProfile}
                      />
                    </div>
                  </div>
                </div>
              </section>

              {/* VIP Creator Program (Compact, exclusive VIP creation model) */}
              <VipProgramSection
                canCreate={!presentation && studio.data?.canCreate === true}
                onOpenBotStudio={handleOpenBotStudio}
              />

              {/* VOLTEX Quant Intelligence Recommendation Zone */}
              <QuantIntelligenceSection
                strategies={strategies}
                onOpenProfile={handleOpenProfile}
              />

              {/* Strategy Marketplace & Leaderboard */}
              <LeaderboardSection
                strategies={strategies}
                onOpenProfile={handleOpenProfile}
              />

              {/* VOLTEX Quant Academy & FAQ */}
              <AcademySection
                articles={ACADEMY_ARTICLES}
                faqItems={FAQ_ITEMS}
              />
            </>
          )}

          {activeView === "strategy-profile" && selectedStrategy && (
            <StrategyProfileView
              key={selectedStrategy.id}
              readOnly={!!presentation}
              strategy={selectedStrategy}
              allStrategies={strategies}
              onBack={() => handleNavigateMarketplace()}
              onSelectStrategy={handleOpenProfile}
            />
          )}

          {activeView === "bot-studio" && (
            <BotStudioView
              studio={studio}
              onBack={() => handleNavigateMarketplace()}
            />
          )}
          {activeView === "strategy-profile" && !selectedStrategy && (
            <p>
              Стратегия недоступна.{" "}
              <button onClick={() => handleNavigateMarketplace()}>
                К маркетплейсу
              </button>
            </p>
          )}
        </main>

        {/* Institutional Minimal Footer */}
        <footer className="relative overflow-hidden border-t border-[var(--border-subtle)] bg-[var(--bg-footer)] px-3 sm:px-6 py-6 transition-colors">
          <NeuralWebOverlay variant="subtle" />
          <div className="relative z-10 max-w-[1600px] mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs text-[var(--text-muted)]">
            <div className="flex flex-wrap items-center gap-4">
              <span className="font-display font-semibold text-[var(--text-primary)] tracking-wider">
                VOLTEX
              </span>
              <span>© 2026 VOLTEX Exchange</span>
              <button
                type="button"
                onClick={() => handleNavigateMarketplace("quant-academy")}
                className="hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              >
                Академия и методология
              </button>
              <button
                type="button"
                onClick={() => setHowItWorksOpen(true)}
                className="hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              >
                О маркетплейсе
              </button>
            </div>
            <p className="max-w-2xl text-[11px] text-[var(--text-muted)] leading-relaxed">
              Модельные результаты обозначены отдельно. Подтверждённая
              статистика доступна при наличии торговой истории.
            </p>
          </div>
        </footer>

        {/* "Как это работает" Modal */}
        {howItWorksOpen && (
          <div
            className="fixed inset-0 z-50 bg-slate-900/60 dark:bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
            onClick={() => setHowItWorksOpen(false)}
          >
            <div
              className="w-full max-w-xl rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-strong)] shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
                <h2 className="font-display text-lg font-bold text-[var(--text-primary)]">
                  Как устроен VOLTEX Quant Marketplace
                </h2>
                <button
                  type="button"
                  onClick={() => setHowItWorksOpen(false)}
                  aria-label="Закрыть окно"
                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 sm:p-6 space-y-4 text-xs sm:text-sm text-[var(--text-secondary)]">
                <div className="p-3.5 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
                  <div className="font-semibold text-[var(--text-gold)] mb-1">
                    01. Институциональная витрина стратегий
                  </div>
                  <p className="leading-relaxed">
                    Изучайте алгоритмические и количественные модели через
                    секцию VOLTEX Quant Intelligence и рейтинг стратегий с
                    фильтрацией по рынку, категории и профилю риска.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
                  <div className="font-semibold text-[var(--text-teal)] mb-1">
                    02. Профессиональный терминал аналитики
                  </div>
                  <p className="leading-relaxed">
                    Откройте полный профиль стратегии (например, Thomas Quant
                    AI), чтобы изучить кривую на горизонте 7D–ALL, распределение
                    сделок, коэффициенты риска и 24-месячную матрицу
                    результатов.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
                  <div className="font-semibold text-[var(--text-primary)] mb-1">
                    03. Эксклюзивный VIP Bot Studio
                  </div>
                  <p className="leading-relaxed">
                    Публикация собственных стратегий закрыта для массового
                    доступа и доступна только в VIP-интерфейсе. Доступ
                    определяет сервер VOLTEX.
                  </p>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setHowItWorksOpen(false)}
                    className="px-4 py-2 rounded-lg text-xs font-semibold bg-gradient-to-r from-[#D4AF6A] to-[#E5C98B] text-[#08090C] cursor-pointer"
                  >
                    Понятно
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
