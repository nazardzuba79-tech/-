import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { useExchangersMode } from './mode';

/** Heading and the disclosure that VOLTEX only compares (v0 page-heading). */
export function PageHeading() {
  const live = useExchangersMode() === 'live';
  return (
    <section aria-labelledby="vx-ex-title" className="vx-ex-heading">
      <div className="vx-ex-heading-main">
        <nav aria-label="Хлебные крошки" className="vx-ex-crumbs">
          <ol>
            <li><Link to="/">VOLTEX</Link></li>
            <li aria-hidden="true">/</li>
            <li aria-current="page">Обменники</li>
          </ol>
        </nav>
        <h1 id="vx-ex-title">Обменники</h1>
        <p className="vx-ex-subtitle">Купить криптовалюту за рубли</p>
        <p className="vx-ex-lead">
          {live
            ? 'Сравнивайте предложения обменников по данным BestChange, выбирайте подходящий курс и переходите на сайт обменного сервиса.'
            : 'Выберите способ оплаты в рублях, криптовалюту и сеть — и перейдите к выбору обменника на BestChange.'}
        </p>
      </div>
      <aside aria-label="Важная информация" className="vx-ex-disclosure">
        <ShieldCheck size={16} aria-hidden="true" />
        <div>
          <p>
            <strong>{live ? 'VOLTEX — сервис сравнения.' : 'VOLTEX не проводит обмен.'}</strong> Мы не принимаем рубли, не обрабатываем платежи и заявки. Обмен
            проводится на сайте независимого обменника.
          </p>
          <p>
            <strong>BestChange</strong> — сервис мониторинга обменных пунктов: он собирает их курсы, резервы, лимиты и
            отзывы клиентов.{' '}
            {live
              ? 'Данные на этой странице получены через официальный API BestChange.'
              : 'Список обменников и курсы на этой странице сейчас не показываются: обменник выбирается на сайте BestChange.'}
          </p>
        </div>
      </aside>
    </section>
  );
}
