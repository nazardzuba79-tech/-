import { useState } from 'react';
import { PHYSICAL_CARD_NAMES, VoltexPhysicalCard, type VoltexPhysicalCardVariant } from '../components/cards/VoltexPhysicalCard';
import './physicalCardsReview.css';

const VARIANTS: VoltexPhysicalCardVariant[] = ['black-signature', 'titanium'];

/** Isolated review route; deliberately not wired into the production App. */
export function PhysicalCardsReview() {
  const [selection, setSelection] = useState<'all' | VoltexPhysicalCardVariant>('all');
  const [showRepairs, setShowRepairs] = useState(false);
  const visible = selection === 'all' ? VARIANTS : [selection];
  return (
    <main className="physical-cards-review">
      <header>
        <p className="physical-cards-review__eyebrow">VOLTEX · DESIGN REVIEW</p>
        <h1>Фізичні картки</h1>
        <p>Фронтальний вигляд для перевірки деталей, матеріалу та пропорцій.</p>
      </header>
      <div className="physical-cards-review__controls">
        <div className="physical-cards-review__variants" role="group" aria-label="Варіант картки">
          {(['all', ...VARIANTS] as const).map(value => (
            <button key={value} type="button" aria-pressed={selection === value} onClick={() => setSelection(value)}>
              {value === 'all' ? 'Порівняти обидві' : PHYSICAL_CARD_NAMES[value]}
            </button>
          ))}
        </div>
        <label className="physical-cards-review__toggle">
          <input type="checkbox" checked={showRepairs} onChange={event => setShowRepairs(event.target.checked)} />
          Показати відновлені області
        </label>
      </div>
      {showRepairs && <p className="physical-cards-review__legend"><span>Синій: закрита вихідною карткою область.</span><span>Помаранчевий: видалений платіжний знак.</span></p>}
      <div className={`physical-cards-review__grid ${selection !== 'all' ? 'physical-cards-review__grid--single' : ''}`}>
        {visible.map(variant => (
          <figure key={variant} className="physical-cards-review__item">
            <VoltexPhysicalCard variant={variant} showRepairs={showRepairs} />
            <figcaption>
              <h2>{PHYSICAL_CARD_NAMES[variant]}</h2>
              <p>{variant === 'black-signature'
                ? 'Виділено з оригіналу та вирівняно. Область платіжного знака очищено.'
                : 'Видимі деталі збережено з оригіналу. Приховану частину матеріалу відновлено; її точний дизайн у джерелі недоступний.'}</p>
              <a href={`/cards/voltex-${variant}.png`} target="_blank" rel="noreferrer">Відкрити PNG · 1000 × 630</a>
            </figcaption>
          </figure>
        ))}
      </div>
      <p className="physical-cards-review__note">Вихідні референси обмежують деталізацію. Це відновлення з композиції, а не оригінальні друкарські макети. Платіжні логотипи вилучено.</p>
    </main>
  );
}
