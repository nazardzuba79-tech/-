import type { ReactNode } from 'react';
import { CircleAlert, CloudOff, ExternalLink, PlugZap, RotateCw, SearchX } from 'lucide-react';
import { OUTBOUND_LINK } from './model';
import { DIRECTION_NOTE } from './OfferAction';

export function OffersSkeleton() {
  return (
    <div role="status" className="vx-ex-skeleton-list">
      <span className="vx-ex-sr">Загружаем предложения обменников</span>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="vx-ex-card vx-ex-skeleton-row" aria-hidden="true">
          <span className="vx-ex-skeleton vx-ex-skeleton--mark" />
          <span className="vx-ex-skeleton-col">
            <span className="vx-ex-skeleton vx-ex-skeleton--line" />
            <span className="vx-ex-skeleton vx-ex-skeleton--short" />
          </span>
          <span className="vx-ex-skeleton vx-ex-skeleton--cell" />
          <span className="vx-ex-skeleton vx-ex-skeleton--cell is-wide-only" />
          <span className="vx-ex-skeleton vx-ex-skeleton--button" />
        </div>
      ))}
    </div>
  );
}

function StatePanel({ icon, title, description, action, tone = 'muted' }: {
  icon: ReactNode;
  title: string;
  description: ReactNode;
  action?: ReactNode;
  tone?: 'muted' | 'warning' | 'danger';
}) {
  return (
    <div role={tone === 'muted' ? 'status' : 'alert'} className={`vx-ex-state vx-ex-state--${tone}`}>
      <span className="vx-ex-state-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && <div className="vx-ex-state-action">{action}</div>}
    </div>
  );
}

/** «Выбрать на BestChange» for the selected direction; null when no safe link exists. */
export function DirectionButton({ href, primary }: { href: string | null; primary?: boolean }) {
  if (!href) return null;
  return (
    <div className="vx-ex-action vx-ex-action--inline">
      <a
        href={href}
        target={OUTBOUND_LINK.target}
        rel={OUTBOUND_LINK.rel}
        referrerPolicy={OUTBOUND_LINK.referrerPolicy}
        className={`vx-ex-btn ${primary ? 'vx-ex-btn--primary' : 'vx-ex-btn--outline'}`}
      >
        Выбрать на BestChange
        <ExternalLink size={14} aria-hidden="true" />
        <span className="vx-ex-sr">, откроется в новой вкладке</span>
      </a>
      <span className="vx-ex-action-note">{DIRECTION_NOTE}</span>
    </div>
  );
}

function RetryButton({ onRetry, label = 'Повторить запрос' }: { onRetry: () => void; label?: string }) {
  return (
    <button type="button" className="vx-ex-btn vx-ex-btn--outline" onClick={onRetry}>
      <RotateCw size={14} aria-hidden="true" />
      {label}
    </button>
  );
}

export function NotConfigured({ directionUrl }: { directionUrl: string | null }) {
  return (
    <StatePanel
      tone="warning"
      icon={<PlugZap size={20} aria-hidden="true" />}
      title="Список обменников и курсы на VOLTEX сейчас не показываются"
      description={directionUrl
        ? 'Подключение к данным BestChange не настроено. Вымышленных обменников, курсов и резервов здесь нет. Для выбранного направления откроется страница BestChange — обменник выбирается там.'
        : 'Подключение к данным BestChange не настроено. Вымышленных обменников, курсов и резервов здесь нет. Для этого направления проверенной ссылки на BestChange нет — выберите другой способ оплаты, монету или сеть.'}
      action={<DirectionButton href={directionUrl} primary />}
    />
  );
}

function waitText(retryAfter: number | null): string {
  if (retryAfter === null) return '';
  if (retryAfter < 60) return ` Попробуйте через ${retryAfter} с.`;
  return ` Попробуйте через ${Math.ceil(retryAfter / 60)} мин.`;
}

export function Unavailable({ retryAfter, onRetry, directionUrl }: { retryAfter: number | null; onRetry: () => void; directionUrl: string | null }) {
  return (
    <StatePanel
      tone="warning"
      icon={<CloudOff size={20} aria-hidden="true" />}
      title="Курсы BestChange временно недоступны"
      description={`Не удалось получить актуальные курсы обменников. Устаревшие данные не показываются.${waitText(retryAfter)}`}
      action={<><RetryButton onRetry={onRetry} /><DirectionButton href={directionUrl} /></>}
    />
  );
}

export function RateLimited({ retryAfter, onRetry }: { retryAfter: number | null; onRetry: () => void }) {
  return (
    <StatePanel
      tone="warning"
      icon={<CloudOff size={20} aria-hidden="true" />}
      title="Слишком много запросов"
      description={`Подождите немного и повторите поиск.${waitText(retryAfter)}`}
      action={<RetryButton onRetry={onRetry} />}
    />
  );
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <StatePanel
      tone="danger"
      icon={<CircleAlert size={20} aria-hidden="true" />}
      title="Не удалось загрузить предложения"
      description="Проверьте подключение к интернету и попробуйте ещё раз."
      action={<RetryButton onRetry={onRetry} label="Повторить" />}
    />
  );
}

export function InvalidAmount() {
  return (
    <StatePanel
      tone="warning"
      icon={<CircleAlert size={20} aria-hidden="true" />}
      title="Проверьте параметры обмена"
      description="Сумма должна быть от 1 до 100 000 000 ₽, а способ оплаты и сеть — из списка. Исправьте значения и нажмите «Найти обменники»."
    />
  );
}

export function EmptyOffers({ filtered, onReset, directionUrl }: { filtered: boolean; onReset?: () => void; directionUrl: string | null }) {
  return (
    <StatePanel
      icon={<SearchX size={20} aria-hidden="true" />}
      title={filtered ? 'Нет предложений под выбранные фильтры' : 'Предложений не найдено'}
      description={
        filtered
          ? 'Попробуйте отключить часть фильтров или изменить сумму обмена.'
          : 'Для этого направления сейчас нет активных обменников. Попробуйте другой способ оплаты, сеть или сумму.'
      }
      action={
        filtered && onReset ? (
          <button type="button" className="vx-ex-btn vx-ex-btn--outline" onClick={onReset}>Сбросить фильтры</button>
        ) : (
          <DirectionButton href={directionUrl} />
        )
      }
    />
  );
}
