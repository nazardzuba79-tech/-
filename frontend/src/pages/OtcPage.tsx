import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';
import { openSupportWidget } from '../lib/supportWidget';
import { TIERS } from './otc/otcConfig';
import './otc/otc.css';
import './otc/otc-cash.css';

/** The public OTC flow is an enquiry to the existing support form, not a
 * financial instruction. No wallet reads, reserve mutations or draft prefill. */
export function OtcPage() {
  return (
    <div className="vx-otc">
      <Nav active="/otc" />
      <main>
        <section className="otc-hero">
          <div className="otc-hero-bg" aria-hidden="true">
            <img src="/media/otc/hero-skyline.webp" alt="" width="1408" height="768" />
          </div>
          <div className="otc-wrap otc-hero-inner">
            <div className="otc-hero-head">
              <h1>Обмен криптовалюты на наличные</h1>
              <p className="otc-hero-lead">
                Обсудите обмен с поддержкой. Доступность направления, курс и условия подтверждает оператор.
              </p>
            </div>
            <div className="otc-tiers">
              {TIERS.map(tier => (
                <div key={tier.id} className={`otc-tier${tier.accent ? ' is-accent' : ''}`}>
                  <h3>{tier.name}</h3>
                  <p>Объём обмена от ${tier.minUsd.toLocaleString('ru-RU')}</p>
                  <p>Криптовалюта → наличные<br />Условия согласовываются с поддержкой.</p>
                  <button
                    type="button"
                    className="otc-btn otc-btn-ghost"
                    aria-label={`Обсудить ${tier.name} с поддержкой`}
                    onClick={openSupportWidget}
                  >
                    Связаться с поддержкой
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="otc-section">
          <div className="otc-wrap">
            <section id="otc-support" className="otc-cash-panel" aria-labelledby="otc-support-title">
              <h2 id="otc-support-title">Обмен через поддержку</h2>
              <p>
                Для обмена напишите в поддержку страну, город, криптовалюту и сумму.
                Оператор уточнит доступность и согласует условия.
              </p>
              <div className="otc-cash-row">
                <button type="button" className="otc-btn otc-btn-orange" onClick={openSupportWidget}>
                  Оформить обмен через поддержку
                </button>
              </div>
              <p className="otc-cash-notice">
                Обращение в поддержку не резервирует и не списывает средства.
              </p>
              <h3>Как это работает</h3>
              <ol className="otc-cash-steps">
                <li>Откройте форму поддержки кнопкой выше.</li>
                <li>Напишите параметры обмена и укажите email для ответа.</li>
                <li>Отправьте обращение. Оператор уточнит возможность обмена и дальнейшие действия.</li>
              </ol>
              <p>Ответ оператора придёт на email, указанный в обращении.</p>
            </section>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
