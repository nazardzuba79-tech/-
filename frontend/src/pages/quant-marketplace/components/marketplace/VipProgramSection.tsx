import React, { useState } from "react";
import { Crown, Lock, ShieldCheck, Sliders, Sparkles, X } from "lucide-react";
import { NeuralWebOverlay } from "../background/NeuralWebOverlay";

interface VipProgramSectionProps {
  canCreate: boolean;
  onOpenBotStudio: () => void;
}

export const VipProgramSection: React.FC<VipProgramSectionProps> = ({
  canCreate,
  onOpenBotStudio,
}) => {
  const [showBenefits, setShowBenefits] = useState(false);

  return (
    <section className="max-w-[1600px] mx-auto px-3 sm:px-6 mt-5">
      <div className="relative overflow-hidden rounded-xl bg-[var(--bg-surface)] border border-[var(--border-gold)] shadow-xs px-4 py-4 sm:px-6 sm:py-5 transition-colors">
        <div className="absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r from-[#F59E0B] via-[#22D3EE] to-[#A855F7] opacity-85" />
        <NeuralWebOverlay variant="gold" />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Left copy */}
          <div className="space-y-1 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-gold)]">
              <Crown className="w-3.5 h-3.5" />
              <span className="font-medium tracking-wide">
                VIP Creator Program
              </span>
              <span
                className="text-[var(--text-muted)] opacity-50"
                aria-hidden="true"
              >
                ·
              </span>
              <span className="text-[var(--text-muted)]">
                Публикация стратегий закрыта для публичного доступа
              </span>
            </div>
            <h2 className="font-display text-lg sm:text-xl font-semibold text-[var(--text-primary)] text-balance">
              Эксклюзивные возможности для VIP-трейдеров
            </h2>
            <p className="text-xs sm:text-sm text-[var(--text-secondary)]">
              Создавайте собственные торговые стратегии и публикуйте их в VOLTEX
              Quant Marketplace.
            </p>
          </div>

          {/* Right interactive preview state + actions */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 shrink-0">
            <span>{canCreate ? "VIP-трейдер" : "Стандартный доступ"}</span>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setShowBenefits((v) => !v)}
                className="px-4 py-2 rounded-lg text-xs sm:text-sm font-medium border border-[var(--border-strong)] text-[var(--text-primary)] hover:border-[var(--border-gold)] hover:bg-[var(--bg-subtle)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Преимущества VIP
              </button>

              {canCreate ? (
                <button
                  type="button"
                  onClick={onOpenBotStudio}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold bg-gradient-to-r from-[#F59E0B] via-[#FBBF24] to-[#FDE68A] text-[#080C1D] hover:brightness-105 shadow-[0_4px_16px_rgba(251,191,36,0.24)] transition-all whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Bot Studio</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowBenefits(true)}
                  title="Bot Studio доступен только в VIP-интерфейсе"
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-medium bg-[var(--bg-subtle)] text-[var(--text-muted)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Bot Studio (VIP)</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Inline expandable VIP Benefits & Access explanation */}
        {showBenefits && (
          <div className="relative z-10 mt-4 pt-4 border-t border-[var(--border-subtle)]">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="text-xs text-[var(--text-secondary)]">
                <span className="text-[var(--text-gold)] font-semibold">
                  Архитектура VIP-доступа:
                </span>{" "}
                в обычном режиме пользователи исследуют и фильтруют стратегии.
                Интерфейс создания и публикации{" "}
                <span className="text-[var(--text-primary)] font-medium">
                  Bot Studio
                </span>{" "}
                открывается только для VIP-аккаунтов (в рабочей среде права
                проверяются бэкендом VOLTEX).
              </div>
              <button
                type="button"
                onClick={() => setShowBenefits(false)}
                aria-label="Скрыть преимущества VIP"
                className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
                <div className="font-semibold text-[var(--text-gold)] mb-1">
                  Публикация в Quant Marketplace
                </div>
                <p className="text-[var(--text-muted)] leading-relaxed">
                  Доступ к оформлению авторской карточки, загрузке логотипа,
                  описанию методологии и управлению статусом публикации.
                </p>
              </div>
              <div className="p-3 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
                <div className="font-semibold text-[var(--text-teal)] mb-1">
                  Институциональная аналитика
                </div>
                <p className="text-[var(--text-muted)] leading-relaxed">
                  Детализация по 24-месячной матрице, распределению сделок,
                  коэффициентам Шарпа/Калмара и контролю просадки.
                </p>
              </div>
              <div className="p-3 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)] flex flex-col justify-between gap-2">
                <div>
                  <div className="font-semibold text-[var(--text-primary)] mb-1">
                    Права автора
                  </div>
                  <p className="text-[var(--text-muted)] leading-relaxed">
                    Доступ к конструктору назначается владельцем платформы.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
