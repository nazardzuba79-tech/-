import { useState } from 'react';
import { PlusIcon } from 'lucide-react';
import { Key, useLanguage } from '../../lib/i18n';

/**
 * Compact two-column FAQ.
 *
 * Copy is deliberately conservative. The prototype's answers asserted
 * things this product has not published — exact fee percentages, an
 * independent security audit, a cold-storage split, insurance, a native
 * mobile app. None of that appears here; each answer says what is true and
 * points at where the real number lives.
 */
const ITEMS: { q: Key; a: Key }[] = [
  { q: 'home.faq.q1', a: 'home.faq.a1' },
  { q: 'home.faq.q2', a: 'home.faq.a2' },
  { q: 'home.faq.q3', a: 'home.faq.a3' },
  { q: 'home.faq.q4', a: 'home.faq.a4' },
  { q: 'home.faq.q5', a: 'home.faq.a5' },
  { q: 'home.faq.q6', a: 'home.faq.a6' },
];

export function HomeFaq() {
  const { t } = useLanguage();
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section className="mx-auto w-full max-w-[1460px] px-6">
      <div className="rounded-[10px] border border-white/6 bg-ink-850 p-7">
        <h2 className="mb-5 text-[22px] font-semibold tracking-[-0.01em] text-white">{t('home.faq.title')}</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {ITEMS.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q} className="rounded-[6px] border border-white/6 bg-ink-800">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center gap-3 px-4 py-[13px] text-left transition-colors duration-150 ease-out hover:bg-white/[0.03]"
                >
                  <span className="text-[13px] font-medium text-white">{t(item.q)}</span>
                  <span
                    className={`ml-auto shrink-0 text-home-muted transition-transform duration-200 ease-out ${
                      isOpen ? 'rotate-45' : 'rotate-0'
                    }`}
                  >
                    <PlusIcon size={14} />
                  </span>
                </button>
                {/* grid-template-rows 0fr -> 1fr: a real height animation
                    with no measurement and no layout thrash. */}
                <div className={`vx-faq-body ${isOpen ? 'vx-open' : ''}`}>
                  <div>
                    <p className="border-t border-white/6 px-4 py-3 text-[12.5px] leading-relaxed text-home-muted">
                      {t(item.a)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
