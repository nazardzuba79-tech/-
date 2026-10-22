import { useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowRight, BarChart3, Compass, Layers3, MessageSquare, MousePointer2, Network, PanelTop, ShieldCheck, Smartphone } from 'lucide-react';
import { Nav } from '../../components/Nav';
import { HomeHeader } from '../home/HomeHeader';
import { HomeFooter } from '../home/HomeFooter';
import './AboutPage.css';

const directions = [
  ['Spot', 'Спотовые рынки'],
  ['Futures', 'Фьючерсные инструменты'],
  ['CFD', 'Контракты на разницу цен'],
  ['Копитрейдинг', 'Отдельный раздел платформы'],
] as const;

const values = [
  ['Понятность', 'Ясная структура вместо лишней сложности.'],
  ['Последовательность', 'Единая логика взаимодействия в разных разделах.'],
  ['Контроль', 'Осознанные действия и внимание к деталям.'],
  ['Практичность', 'Инструменты, которые помогают решать конкретные задачи.'],
  ['Развитие', 'Постепенное улучшение продукта на основе обратной связи.'],
] as const;

const principles = [
  ['Понимание рынка', 'Отправная точка — информация. Для нас важно, чтобы пользователь мог ориентироваться в структуре платформы и находить нужные инструменты без лишних переходов.'],
  ['Продуманный интерфейс', 'Разные разделы должны говорить на одном визуальном языке: знакомая навигация, последовательные действия и понятная подача данных.'],
  ['Осознанные решения', 'Инструменты не отменяют риск и не принимают ответственность за пользователя. Наша задача — не обещать результат, а делать взаимодействие с платформой понятнее.'],
  ['Постоянное развитие', 'Мы рассматриваем развитие продукта как последовательную работу: замечать проблемы, проверять изменения и улучшать пользовательский опыт.'],
] as const;

const approach = [
  ['Целостность', 'Связанный пользовательский опыт вместо набора разрозненных экранов.', Layers3],
  ['Понятная навигация', 'Логичная структура и внимание к тому, как пользователь находит нужный раздел.', Compass],
  ['Внимание к данным', 'Читаемая подача информации и ясное разделение разных показателей.', BarChart3],
  ['Контроль действий', 'Понятные формы, статусы и подтверждения там, где они необходимы.', ShieldCheck],
  ['Удобство на разных экранах', 'Интерфейс должен оставаться удобным и на большом мониторе, и на телефоне.', Smartphone],
  ['Обратная связь', 'Замечания пользователей помогают определять, что стоит улучшать в первую очередь.', MessageSquare],
] as const;

function AboutPhoto({ name, alt, eager = false, className = '' }: { name: string; alt: string; eager?: boolean; className?: string }) {
  const dimensions = name === 'hero' ? { width: 1920, height: 1080 } : { width: 1280, height: 853 };
  return <picture className={`about-photo ${className}`}>
    <source media="(max-width: 600px)" srcSet={`/about/${name}-small.webp`} />
    <img src={`/about/${name}-wide.webp`} alt={alt} {...dimensions} loading={eager ? 'eager' : 'lazy'} decoding="async" />
  </picture>;
}

function AboutHero() {
  return <section className="about-hero" aria-labelledby="about-title">
    <AboutPhoto name="hero" alt="Два человека беседуют перед современным офисом при дневном свете" eager className="about-hero-photo" />
    <div className="about-hero-content">
      <p className="about-eyebrow">Знакомьтесь, VOLTEX</p>
      <h1 id="about-title">Больше понимания.<br />Больше возможностей.</h1>
      <p className="about-hero-description">Мы создаём пространство, в котором рынки, торговые инструменты и управление активами становятся частью единого опыта.</p>
      <a className="about-button about-button-yellow" href="#overview" onClick={event => {
        const destination = document.getElementById('overview');
        if (!destination) return;
        event.preventDefault();
        destination.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
        destination.focus({ preventScroll: true });
      }}>Изучить платформу <ArrowDown size={18} aria-hidden="true" /></a>
    </div>
  </section>;
}

function AboutMarketsStrip() {
  return <section className="about-markets-grid about-wrap" aria-label="Направления платформы">
    {directions.map(([title, description]) => <div className="about-market" key={title}><strong>{title}</strong><span>{description}</span></div>)}
  </section>;
}

function TerminalLaptop({ background = false }: { background?: boolean }) {
  return <div className={background ? 'about-laptop about-laptop-background' : 'about-laptop'}>
    <div className="about-laptop-screen"><img src="/about/terminal-desktop.webp" alt={background ? '' : 'Торговый интерфейс VOLTEX на экране ноутбука'} width={1440} height={900} loading="lazy" decoding="async" /></div>
    <div className="about-laptop-base" aria-hidden="true" />
  </div>;
}

function AboutMissionVision() {
  return <section className="about-overview about-wrap" id="overview" tabIndex={-1} aria-labelledby="about-overview-title">
    <div className="about-split-row">
      <div className="about-terminal-composition">
        <div className="about-terminal-caption"><span className="about-eyebrow">VOLTEX</span><span>Пример интерфейса</span></div>
        <TerminalLaptop />
      </div>
      <div className="about-editorial-panel about-mission-panel">
        <p className="about-eyebrow">О платформе</p>
        <h2 id="about-overview-title">Разные инструменты.<br />Целостный подход.</h2>
        <p>Мы работаем над тем, чтобы переход между рынками, анализом и управлением активами был понятным и последовательным.</p>
        <div className="about-text-group"><h3>Наше видение</h3><p>Финансовый интерфейс должен помогать ориентироваться в информации, а не усложнять её.</p></div>
        <div className="about-text-group"><h3>Наша задача</h3><p>Соединить возможности платформы в удобную среду, где пользователь понимает свои действия и сохраняет контроль над решениями.</p></div>
      </div>
    </div>
    <div className="about-split-row about-values-row">
      <div className="about-editorial-panel about-values-panel">
        <h2 className="about-eyebrow">Наши ориентиры</h2>
        <dl>{values.map(([title, text]) => <div className="about-value-line" key={title}><dt>{title}</dt><dd>{text}</dd></div>)}</dl>
      </div>
      <AboutPhoto name="portrait" alt="Человек работает за ноутбуком у окна в современном помещении" className="about-portrait-photo" />
    </div>
  </section>;
}

function AboutPrinciplesAccordion() {
  const [open, setOpen] = useState<number | null>(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowDown' ? (index + 1) % principles.length
      : event.key === 'ArrowUp' ? (index + principles.length - 1) % principles.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? principles.length - 1 : null;
    if (next !== null) { event.preventDefault(); buttons.current[next]?.focus(); }
  }
  return <section className="about-principles about-wrap" aria-labelledby="about-principles-title">
    <div className="about-section-heading"><p className="about-eyebrow">Наша основа</p><h2 id="about-principles-title">Что лежит<br className="about-desktop-break" /> в основе VOLTEX</h2></div>
    <div className="about-accordion">
      {principles.map(([title, text], index) => {
        const expanded = open === index, triggerId = `about-principle-trigger-${index}`, panelId = `about-principle-${index}`;
        return <div className={`about-accordion-item${expanded ? ' is-open' : ''}`} key={title}>
          <h3><button className="about-accordion-trigger" type="button" id={triggerId} aria-expanded={expanded} aria-controls={panelId} ref={element => { buttons.current[index] = element; }} onKeyDown={event => navigate(event, index)} onClick={() => setOpen(expanded ? null : index)}>
            <span className="about-accordion-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><span>{title}</span><span className="about-accordion-toggle" aria-hidden="true">{expanded ? '−' : '+'}</span>
          </button></h3>
          <div className="about-accordion-panel" id={panelId} role="region" aria-labelledby={triggerId} aria-hidden={!expanded}><div><p>{text}</p></div></div>
        </div>;
      })}
    </div>
  </section>;
}

function AboutLifestyleBanner() {
  return <section className="about-lifestyle about-wrap" aria-label="Современная повседневная жизнь"><AboutPhoto name="lifestyle" alt="Дневной свет и непринуждённое общение в современном кафе" /></section>;
}

function AboutApproachGrid() {
  return <section className="about-approach about-wrap" aria-labelledby="about-approach-title">
    <div className="about-section-heading"><p className="about-eyebrow">Принципы работы</p><h2 id="about-approach-title">Наш подход к платформе</h2></div>
    <div className="about-approach-grid">{approach.map(([title, text, Icon]) => <article className="about-approach-card" key={title}><Icon size={26} strokeWidth={1.6} aria-hidden="true" /><h3>{title}</h3><p>{text}</p></article>)}</div>
    <Link className="about-button about-button-dark" to="/markets">Перейти к платформе <ArrowRight size={18} aria-hidden="true" /></Link>
  </section>;
}

function AboutCapabilitiesStrip() {
  return <section className="about-capabilities about-wrap" aria-labelledby="about-capabilities-title">
    <h2 id="about-capabilities-title">Единый подход к разным задачам</h2>
    <ul>{[[Network, 'Рынки'], [BarChart3, 'Анализ'], [PanelTop, 'Портфель'], [MousePointer2, 'Управление']].map(([Icon, text]) => {
      const CapabilityIcon = Icon as typeof Network;
      return <li key={String(text)}><CapabilityIcon size={19} strokeWidth={1.6} aria-hidden="true" /><span>{String(text)}</span></li>;
    })}</ul>
  </section>;
}

function AboutDeviceCTA() {
  return <section className="about-device-cta" aria-labelledby="about-device-title">
    <div className="about-device-inner about-wrap">
      <div className="about-device-copy"><p className="about-eyebrow">В вашем ритме</p><h2 id="about-device-title">VOLTEX — на экране<br />вашего устройства.</h2><p>Познакомьтесь с платформой и выберите удобный формат работы.</p><Link className="about-button about-button-yellow" to="/markets">Открыть VOLTEX <ArrowRight size={18} aria-hidden="true" /></Link></div>
      <div className="about-device-stage">
        <TerminalLaptop background />
        <div className="about-phone"><div className="about-phone-speaker" aria-hidden="true" /><img src="/about/terminal-mobile.webp" alt="Мобильный интерфейс VOLTEX на экране телефона" width={390} height={844} loading="lazy" decoding="async" /></div>
        <span className="about-device-caption">Пример интерфейса</span>
      </div>
    </div>
  </section>;
}

/** Public presentation only: no market requests, prices, account data or financial actions. */
export function AboutPage({ loggedIn = false }: { loggedIn?: boolean }) {
  return <div className="about-page">
    <div className={`about-shared-chrome${loggedIn ? '' : ' vx-home'}`}>{loggedIn ? <Nav active="" hideTicker /> : <HomeHeader />}</div>
    <main className="about-main" lang="ru">
      <AboutHero /><AboutMarketsStrip /><AboutMissionVision /><AboutPrinciplesAccordion /><AboutLifestyleBanner /><AboutApproachGrid /><AboutCapabilitiesStrip /><AboutDeviceCTA />
    </main>
    <div className="about-shared-chrome vx-home"><HomeFooter /></div>
  </div>;
}
