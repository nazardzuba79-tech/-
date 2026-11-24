import React, { useState, useRef } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Crown,
  FileEdit,
  Globe,
  Info,
  Lock,
  Plus,
  ShieldAlert,
  Upload,
} from "lucide-react";
import type {
  RiskLevel,
  StrategyCategory,
  StudioDraftStrategy,
} from "../../types/strategy";
import { request } from "../../../../lib/api";
import {
  type Draft,
  type CardSettings,
  type useStudio,
} from "../../../trading-bots/QuantStudio";
import { StrategyLogo } from "../logos/StrategyLogos";
import { NeuralWebOverlay } from "../background/NeuralWebOverlay";

interface BotStudioViewProps {
  studio: ReturnType<typeof useStudio>;
  onBack: () => void;
}

const MARKETS = ["XRP/USDT", "BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT"];

const CATEGORIES: StrategyCategory[] = [
  "Quantitative Intelligence",
  "Grid",
  "DCA",
  "Momentum",
  "Market Neutral",
  "Rebalance",
  "Breakout",
];

const RISKS: RiskLevel[] = ["Низкий", "Умеренный", "Повышенный"];

const PRESET_LOGOS = [
  { id: "thomas-quant-ai", label: "Neural TQ" },
  { id: "atlas-grid", label: "Geometric Grid" },
  { id: "ether-dca", label: "Prism Accumulation" },
  { id: "sol-momentum", label: "Momentum Vectors" },
  { id: "delta-balance", label: "Delta Symmetry" },
  { id: "smart-rebalance", label: "Orbital Nodes" },
  { id: "breakout-pro", label: "Breakout Breach" },
];

function form(row?: Draft): StudioDraftStrategy {
  return {
    id: row?.id ?? "",
    name: row?.name ?? "",
    description: row?.description ?? "",
    market: row?.pair ?? "XRP/USDT",
    category: "Quantitative Intelligence",
    risk: "Умеренный",
    minInvestmentUsdt: 0,
    maxDrawdownStop: 0,
    lookbackWindow: 24,
    leverageCap: "Без исполнения",
    rebalanceInterval: "4 часа",
    presetLogoId: "atlas-grid",
    customLogoUrl: null,
    ...row?.settings,
    status: row?.publishedAt ? "Опубликована" : "Черновик",
    visibility: "Публичная в Marketplace",
    updatedAt: "",
  };
}
export const BotStudioView: React.FC<BotStudioViewProps> = ({
  studio,
  onBack,
}) => {
  const [edited, setEdited] = useState<StudioDraftStrategy | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saved, setSaved] = useState<Draft | null>(null);
  const [revision, setRevision] = useState<number | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const rows = studio.data?.drafts ?? [];
  const row =
    selectedId === null ? rows[0] : rows.find((d) => d.id === selectedId);
  const current =
    saved &&
    saved.id === selectedId &&
    (saved.revision ?? 0) >= (row?.revision ?? 0)
      ? saved
      : row;
  const activeDraft = edited ?? form(current);
  const drafts = rows.map((d) => form(d));
  function select(id: string) {
    setSelectedId(id);
    setEdited(null);
    setRevision(null);
    setSaveNotice(null);
  }
  function updateActive(patch: Partial<StudioDraftStrategy>) {
    if (lock.current) return;
    setRevision(revision ?? current?.revision ?? 1);
    setEdited({ ...activeDraft, ...patch });
    setSaveNotice(null);
  }
  function handleCreateNewDraft() {
    select("");
    setEdited(form());
  }
  async function save(published: boolean) {
    if (lock.current) return;
    if (!activeDraft.id && published) {
      setSaveNotice("Сначала сохраните черновик.");
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      const {
        category,
        risk,
        minInvestmentUsdt,
        maxDrawdownStop,
        lookbackWindow,
        rebalanceInterval,
        presetLogoId,
        customLogoUrl,
      } = activeDraft;
      const settings: CardSettings = {
        category,
        risk,
        minInvestmentUsdt,
        maxDrawdownStop,
        lookbackWindow,
        rebalanceInterval,
        presetLogoId,
        customLogoUrl,
      };
      const body = {
        name: activeDraft.name,
        pair: activeDraft.market,
        description: activeDraft.description,
        settings,
      };
      const id = activeDraft.id;
      const result = await request<Draft>(
        "/trading-bots/studio/drafts" +
          (id ? "/" + encodeURIComponent(id) : ""),
        {
          method: id ? "PATCH" : "POST",
          body: JSON.stringify(
            id
              ? {
                  ...body,
                  published,
                  revision: revision ?? current?.revision ?? 1,
                }
              : body,
          ),
        },
      );
      setSaved(result);
      select(result.id);
      studio.reload();
      setSaveNotice(
        published ? "Карточка опубликована." : "Черновик сохранён.",
      );
    } catch {
      setSaveNotice(
        "Не удалось сохранить. Проверьте поля, права автора и актуальность версии.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 61440
    ) {
      setSaveNotice("Допустимы PNG, JPEG или WebP до 60 КиБ.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string")
        updateActive({ customLogoUrl: reader.result });
    };
    reader.readAsDataURL(file);
  }
  if (!studio.data?.canCreate) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] mb-6 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Назад к маркетплейсу</span>
        </button>

        <div className="relative overflow-hidden rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-gold)] shadow-xs p-6 sm:p-8 text-center space-y-4">
          <NeuralWebOverlay variant="gold" />
          <div className="relative z-10 w-12 h-12 mx-auto rounded-xl bg-[#D4AF6A]/15 border border-[var(--border-gold)] flex items-center justify-center text-[var(--text-gold)]">
            <Lock className="w-6 h-6" />
          </div>
          <h1 className="relative z-10 font-display text-2xl font-bold text-[var(--text-primary)]">
            Bot Studio доступен только VIP-трейдерам
          </h1>
          <p className="relative z-10 text-sm text-[var(--text-secondary)] max-w-xl mx-auto leading-relaxed">
            Создание и публикация авторских стратегий в VOLTEX Quant Marketplace
            являются эксклюзивной привилегией VIP-аккаунтов. Права
            подтверждаются сервером VOLTEX.
          </p>
          <div className="relative z-10 pt-2 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="px-5 py-2.5 rounded-lg text-sm font-medium border border-[var(--border-strong)] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] cursor-pointer"
            >
              Вернуться к стратегиям
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1600px] mx-auto px-3 sm:px-6 py-5 sm:py-7">
      {/* Top Bar */}
      <div className="quant-studio-bar flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>К маркетплейсу</span>
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl sm:text-2xl font-bold text-[var(--text-primary)]">
                VIP Bot Studio
              </h1>
              <span className="text-[11px] font-mono text-[var(--text-gold)] border border-[var(--border-gold)] bg-[#D4AF6A]/12 px-2 py-0.5 rounded">
                VIP
              </span>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              Конструктор оформления, параметров и публикации авторских
              стратегий
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleCreateNewDraft}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold bg-gradient-to-r from-[#D4AF6A] to-[#E5C98B] text-[#08090C] hover:brightness-105 self-start sm:self-auto cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Новый черновик</span>
        </button>
      </div>

      {/* Publication scope */}
      <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-4 py-3 mb-6 flex items-start gap-2.5 text-xs text-[var(--text-secondary)]">
        <ShieldAlert className="w-4 h-4 text-[var(--text-gold)] shrink-0 mt-0.5" />
        <span>
          <strong className="text-[var(--text-primary)] font-semibold">
            Публикация стратегии
          </strong>{" "}
          открывает её карточку в каталоге. Черновики сохраняются в вашем аккаунте.
          Для запуска торгового алгоритма нужны отдельные права.
        </span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left Sidebar: Drafts & Published List */}
        <aside className="xl:col-span-3 space-y-3">
          <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4">
            <h2 className="text-xs font-semibold text-[var(--text-muted)] mb-3">
              Мои стратегии ({drafts.length})
            </h2>
            <div className="space-y-2">
              {drafts.map((item) => {
                const selected = item.id === activeDraft.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      select(item.id);
                    }}
                    className={`w-full text-left p-3 rounded-lg border transition-colors cursor-pointer ${
                      selected
                        ? "bg-[var(--bg-surface-elevated)] border-[var(--border-gold)] shadow-xs"
                        : "bg-[var(--bg-subtle)] border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
                        {item.name}
                      </span>
                      <span
                        className={`text-[10px] font-mono font-medium shrink-0 ${
                          item.status === "Опубликована"
                            ? "text-[var(--text-teal)]"
                            : "text-[var(--text-gold)]"
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] mt-1">
                      {item.market} · {item.category}
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)] opacity-80 mt-1">
                      Обновлено: {item.updatedAt}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* Center Configuration Editor */}
        <div className="xl:col-span-5 relative overflow-hidden rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4 sm:p-6 space-y-5">
          <NeuralWebOverlay variant="subtle" />
          <div className="relative z-10 flex items-center justify-between gap-2 pb-3 border-b border-[var(--border-subtle)]">
            <h2 className="font-display text-lg font-semibold text-[var(--text-primary)]">
              Параметры и публикация
            </h2>
            {saveNotice && (
              <span className="inline-flex items-center gap-1 text-xs text-[var(--text-teal)] font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{saveNotice}</span>
              </span>
            )}
          </div>

          <div className="relative z-10 space-y-4">
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1.5">
                Название стратегии
              </label>
              <input
                type="text"
                value={activeDraft.name}
                onChange={(e) => updateActive({ name: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-gold)]"
              />
            </div>

            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1.5">
                Описание стратегии
              </label>
              <textarea
                rows={3}
                value={activeDraft.description}
                onChange={(e) => updateActive({ description: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-xs sm:text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-gold)] resize-none"
              />
            </div>
          </div>

          <div className="relative z-10 space-y-2.5">
            <label className="block text-xs text-[var(--text-secondary)]">
              Логотип стратегии (PNG, JPEG или WebP до 60 КиБ)
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-strong)] hover:border-[var(--border-gold)] text-xs text-[var(--text-primary)] cursor-pointer">
                <Upload className="w-3.5 h-3.5 text-[var(--text-gold)]" />
                <span>Загрузить логотип</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleLogoUpload}
                  className="hidden"
                />
              </label>
              {activeDraft.customLogoUrl && (
                <button
                  type="button"
                  onClick={() => updateActive({ customLogoUrl: null })}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  Сбросить файл
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {PRESET_LOGOS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() =>
                    updateActive({ presetLogoId: p.id, customLogoUrl: null })
                  }
                  className={`px-2.5 py-1 rounded text-[11px] border transition-colors cursor-pointer ${
                    !activeDraft.customLogoUrl &&
                    activeDraft.presetLogoId === p.id
                      ? "bg-[#D4AF6A]/18 border-[var(--border-gold)] text-[var(--text-gold)] font-medium"
                      : "bg-[var(--bg-subtle)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="relative z-10 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1.5">
                Выбор рынка
              </label>
              <select
                value={activeDraft.market}
                onChange={(e) => updateActive({ market: e.target.value })}
                className="w-full px-2.5 py-2 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-gold)]"
              >
                {MARKETS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1.5">
                Категория
              </label>
              <select
                value={activeDraft.category}
                onChange={(e) =>
                  updateActive({ category: e.target.value as StrategyCategory })
                }
                className="w-full px-2.5 py-2 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-gold)]"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1.5">
                Профиль риска
              </label>
              <select
                value={activeDraft.risk}
                onChange={(e) =>
                  updateActive({ risk: e.target.value as RiskLevel })
                }
                className="w-full px-2.5 py-2 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-gold)]"
              >
                {RISKS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="relative z-10 pt-2 border-t border-[var(--border-subtle)] space-y-3">
            <div className="text-xs font-semibold text-[var(--text-gold)]">
              Конфигурация стратегии
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">
                  Мин. инвестиция (USDT)
                </label>
                <input
                  type="number"
                  min={50}
                  step={50}
                  value={activeDraft.minInvestmentUsdt}
                  onChange={(e) =>
                    updateActive({
                      minInvestmentUsdt: Math.max(
                        50,
                        Number(e.target.value) || 50,
                      ),
                    })
                  }
                  className="w-full px-3 py-1.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)] font-mono text-xs text-[var(--text-primary)]"
                />
              </div>

              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">
                  Стоп по просадке (%)
                </label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  step={0.5}
                  value={activeDraft.maxDrawdownStop}
                  onChange={(e) =>
                    updateActive({
                      maxDrawdownStop: Math.min(
                        30,
                        Math.max(1, Number(e.target.value) || 5),
                      ),
                    })
                  }
                  className="w-full px-3 py-1.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)] font-mono text-xs text-[var(--text-primary)]"
                />
              </div>

              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">
                  Окно анализа (свечи)
                </label>
                <input
                  type="number"
                  min={5}
                  max={200}
                  value={activeDraft.lookbackWindow}
                  onChange={(e) =>
                    updateActive({
                      lookbackWindow: Math.max(5, Number(e.target.value) || 20),
                    })
                  }
                  className="w-full px-3 py-1.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)] font-mono text-xs text-[var(--text-primary)]"
                />
              </div>

              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">
                  Лимит плеча / интервал
                </label>
                <select
                  value={activeDraft.rebalanceInterval}
                  onChange={(e) =>
                    updateActive({ rebalanceInterval: e.target.value })
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                >
                  <option value="1 час">
                    1 час · {activeDraft.leverageCap}
                  </option>
                  <option value="4 часа">
                    4 часа · {activeDraft.leverageCap}
                  </option>
                  <option value="12 часов">
                    12 часов · {activeDraft.leverageCap}
                  </option>
                  <option value="24 часа">
                    24 часа · {activeDraft.leverageCap}
                  </option>
                </select>
              </div>
            </div>
          </div>

          <div className="relative z-10 pt-3 border-t border-[var(--border-subtle)] space-y-3">
            <div className="text-xs font-semibold text-[var(--text-primary)]">
              Настройки публикации
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">
                  Видимость
                </label>
                <select
                  value={activeDraft.visibility}
                  onChange={(e) =>
                    updateActive({
                      visibility: e.target
                        .value as StudioDraftStrategy["visibility"],
                    })
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                >
                  <option value="Публичная в Marketplace">
                    Публичная в Marketplace
                  </option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">
                  Состояние
                </label>
                <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void save(false)}
                    className={`py-1 rounded text-xs font-medium cursor-pointer ${
                      activeDraft.status === "Черновик"
                        ? "bg-[var(--bg-surface)] text-[var(--text-gold)] shadow-xs"
                        : "text-[var(--text-muted)]"
                    }`}
                  >
                    Черновик
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void save(true)}
                    className={`py-1 rounded text-xs font-medium cursor-pointer ${
                      activeDraft.status === "Опубликована"
                        ? "bg-teal-500/18 text-[var(--text-teal)]"
                        : "text-[var(--text-muted)]"
                    }`}
                  >
                    Опубликована
                  </button>
                </div>
              </div>
            </div>

            <label className="flex items-center gap-2.5 text-xs text-[var(--text-secondary)] cursor-pointer">
              <input
                type="checkbox"
                checked
                disabled
                readOnly
                className="accent-[#C59B47]"
              />
              <span>
                Отображать раскрытие модельных данных в карточке стратегии
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void save(false)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium border border-[var(--border-strong)] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] cursor-pointer"
              >
                <FileEdit className="w-3.5 h-3.5" />
                <span>
                  {current?.publishedAt
                    ? "Снять с публикации"
                    : "Сохранить черновик"}
                </span>
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => void save(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-gradient-to-r from-[#D4AF6A] to-[#E5C98B] text-[#08090C] hover:brightness-105 cursor-pointer"
              >
                <Globe className="w-3.5 h-3.5" />
                <span>Опубликовать карточку</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Live Preview & Performance Overview */}
        <div className="xl:col-span-4 space-y-4">
          <div className="relative overflow-hidden rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-gold)] shadow-xs p-5 space-y-4">
            <NeuralWebOverlay variant="gold" />
            <div className="relative z-10 flex items-center justify-between text-xs">
              <span className="text-[var(--text-muted)]">
                Предпросмотр карточки в витрине
              </span>
              <span
                className={`font-mono font-medium ${
                  activeDraft.status === "Опубликована"
                    ? "text-[var(--text-teal)]"
                    : "text-[var(--text-gold)]"
                }`}
              >
                {activeDraft.status}
              </span>
            </div>

            <div className="relative z-10 flex items-start gap-3.5">
              {activeDraft.customLogoUrl ? (
                <img
                  src={activeDraft.customLogoUrl}
                  alt={activeDraft.name}
                  referrerPolicy="no-referrer"
                  className="w-12 h-12 rounded-xl object-cover border border-[var(--border-gold)] shrink-0"
                />
              ) : (
                <StrategyLogo
                  strategyId={activeDraft.presetLogoId}
                  size={48}
                  className="shrink-0"
                />
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h3 className="font-display text-lg font-bold text-[var(--text-primary)] truncate">
                    {activeDraft.name || "Без названия"}
                  </h3>
                  <span className="text-[10px] font-mono text-[var(--text-gold)]">
                    VIP
                  </span>
                </div>
                <div className="text-xs text-[var(--text-muted)]">
                  <span className="font-mono text-[var(--text-primary)]">
                    {activeDraft.market}
                  </span>
                  <span className="mx-1.5">·</span>
                  <span>{activeDraft.category}</span>
                </div>
              </div>
            </div>

            <p className="relative z-10 text-xs text-[var(--text-secondary)] leading-relaxed">
              {activeDraft.description}
            </p>

            {/* Live Performance Overview */}
            <div className="relative z-10 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)] p-3">
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-[11px] text-[var(--text-muted)]">
                  Доходность за 30Д
                </span>
                <span className="font-mono text-base font-bold text-[var(--text-teal)] tabular-nums">
                  —
                </span>
              </div>
              <p>Данные о доходности отсутствуют.</p>
            </div>

            <div className="relative z-10 grid grid-cols-3 gap-2 pt-2 border-t border-[var(--border-subtle)] text-xs">
              <div>
                <div className="text-[11px] text-[var(--text-muted)]">Риск</div>
                <div className="font-medium text-[var(--text-gold)]">
                  {activeDraft.risk}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--text-muted)]">
                  Стоп-лимит
                </div>
                <div className="font-mono text-[var(--text-crimson)] tabular-nums">
                  -{activeDraft.maxDrawdownStop.toFixed(1)}%
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--text-muted)]">
                  Мин. вход
                </div>
                <div className="font-mono text-[var(--text-primary)] tabular-nums">
                  {activeDraft.minInvestmentUsdt} USDT
                </div>
              </div>
            </div>

            {
              <div className="relative z-10 flex items-start gap-2 pt-2 border-t border-[var(--border-subtle)] text-[11px] text-[var(--text-muted)]">
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Параметры описывают стратегию. Публикация карточки не
                  запускает торги. Не является историческим исполнением или
                  инвестиционной гарантией.
                </span>
              </div>
            }
          </div>
        </div>
      </div>
    </div>
  );
};
