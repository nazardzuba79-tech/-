import React, { useState } from "react";
import { ArrowRight, BookOpen, X } from "lucide-react";
import type { AcademyArticle } from "../../types/strategy";
import { AcademyIllustration } from "../logos/StrategyLogos";
import { NeuralWebOverlay } from "../background/NeuralWebOverlay";

interface AcademySectionProps {
  articles: AcademyArticle[];
}

export const AcademySection: React.FC<AcademySectionProps> = ({
  articles,
}) => {
  const [selectedArticle, setSelectedArticle] = useState<AcademyArticle | null>(
    null,
  );

  return (
    <section
      id="quant-academy"
      className="max-w-[1600px] mx-auto px-3 sm:px-6 mt-12 pb-12"
    >
      {/* Educational Cards */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-2 text-xs text-[var(--text-gold)] font-medium mb-1">
            <BookOpen className="w-3.5 h-3.5" />
            <span>Образовательный центр</span>
          </div>
          <h2 className="font-display text-xl sm:text-2xl font-bold text-[var(--text-primary)]">
            VOLTEX Quant Academy
          </h2>
          <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-1">
            Методологические материалы по количественному анализу, рискам и
            отбору алгоритмических моделей.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {articles.map((article) => (
          <article
            key={article.id}
            onClick={() => setSelectedArticle(article)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setSelectedArticle(article);
              }
            }}
            className="group relative rounded-xl overflow-hidden bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-gold)] shadow-xs transition-colors flex flex-col cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[#D4AF6A]"
          >
            <NeuralWebOverlay variant="subtle" />
            <div className="relative z-10 aspect-[360/170] w-full overflow-hidden border-b border-[var(--border-subtle)] bg-[#0D1018]">
              <AcademyIllustration type={article.illustrationType} />
            </div>
            <div className="relative z-10 p-4 sm:p-5 flex-1 flex flex-col justify-between gap-4">
              <div>
                <div className="text-[11px] text-[var(--text-muted)] mb-1.5">
                  <span>{article.category}</span>
                  <span className="mx-1.5 opacity-40" aria-hidden="true">
                    ·
                  </span>
                  <span>{article.readTime}</span>
                </div>
                <h3 className="font-display text-base sm:text-lg font-semibold text-[var(--text-primary)] group-hover:text-[var(--text-gold)] transition-colors">
                  {article.title}
                </h3>
                <p className="mt-2 text-xs sm:text-[13px] text-[var(--text-secondary)] leading-relaxed">
                  {article.summary}
                </p>
              </div>
              <div className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-gold)] group-hover:translate-x-0.5 transition-transform">
                <span>Читать материал</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </div>
            </div>
          </article>
        ))}
      </div>

      {/* Educational Article Reader Modal */}
      {selectedArticle && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 dark:bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
          onClick={() => setSelectedArticle(null)}
        >
          <div
            className="w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-strong)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 bg-[var(--bg-surface)]/95 backdrop-blur px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between gap-4">
              <div className="text-xs text-[var(--text-muted)]">
                <span>{selectedArticle.category}</span>
                <span className="mx-1.5 opacity-40">·</span>
                <span>{selectedArticle.readTime}</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedArticle(null)}
                aria-label="Закрыть статью"
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="aspect-[360/150] w-full border-b border-[var(--border-subtle)] bg-[#0D1018]">
              <AcademyIllustration type={selectedArticle.illustrationType} />
            </div>

            <div className="p-5 sm:p-6 space-y-4">
              <h3 className="font-display text-xl sm:text-2xl font-bold text-[var(--text-primary)]">
                {selectedArticle.title}
              </h3>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                {selectedArticle.summary}
              </p>

              <div className="rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-gold)] p-4 space-y-2">
                <div className="text-xs font-semibold text-[var(--text-gold)]">
                  Ключевые тезисы
                </div>
                <ul className="space-y-1.5 text-xs sm:text-sm text-[var(--text-primary)]">
                  {selectedArticle.keyTakeaways.map((point, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="font-mono text-[var(--text-gold)] mt-0.5">
                        0{idx + 1}.
                      </span>
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-3 text-sm text-[var(--text-secondary)] leading-relaxed">
                {selectedArticle.bodyParagraphs.map((para, idx) => (
                  <p key={idx}>{para}</p>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
