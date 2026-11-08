import type { LucideIcon } from 'lucide-react';
import {
  ArrowUpRight,
  BadgeCheck,
  Coins,
  CreditCard,
  FileText,
  Globe,
  KeyRound,
  Network,
  Percent,
  Scale,
  ShieldAlert,
  SlidersHorizontal,
  TriangleAlert,
  UserCheck,
  WalletMinimal,
} from 'lucide-react';

interface Step {
  icon: LucideIcon;
  title: string;
  text: string;
  warning?: string;
}

export const STEPS: readonly Step[] = [
  {
    icon: CreditCard,
    title: 'Выберите способ оплаты',
    text: 'Укажите, как будете платить рублями: СБП, карта Сбербанка, Т-Банка или другого банка. От способа оплаты зависят курс, лимиты и скорость обмена.',
    warning: 'Платите только с карты или счёта, оформленных на ваше имя: оплата с чужих реквизитов часто приводит к блокировке заявки.',
  },
  {
    icon: SlidersHorizontal,
    title: 'Укажите сумму, криптовалюту и сеть',
    text: 'Введите сумму в рублях, выберите монету и сеть, в которой хотите её получить. Сеть должна совпадать с сетью вашего кошелька.',
    warning: 'USDT TRC-20 и TRX — разные активы. Перепутанная сеть может привести к безвозвратной потере средств.',
  },
  {
    icon: Scale,
    title: 'Сравните предложения обменников',
    text: 'Смотрите не только на курс: проверьте резерв, лимиты, отзывы и отметки об условиях. По умолчанию список упорядочен по курсу с учётом дополнительных комиссий обменника — так предложения ранжирует BestChange.',
  },
  {
    icon: ArrowUpRight,
    title: 'Перейдите на сайт обменника',
    text: 'Кнопка «Перейти к обменнику» открывает сайт выбранного обменника через BestChange в новой вкладке. Направление и сумму обмена вы выбираете уже на сайте обменника. VOLTEX не проводит обмен и не принимает ваши деньги.',
    warning: 'Проверьте адрес сайта в строке браузера. Не переходите по ссылкам из чатов и рекламы.',
  },
  {
    icon: FileText,
    title: 'Создайте и оплатите заявку',
    text: 'Заполните заявку на сайте обменника: сумму, реквизиты оплаты и адрес кошелька для получения. Проверьте итоговую сумму и комиссию до оплаты.',
    warning: 'Оплачивайте строго по реквизитам из заявки и в отведённое время, иначе курс может измениться или заявка будет отменена.',
  },
  {
    icon: WalletMinimal,
    title: 'Получите криптовалюту и проверьте поступление',
    text: 'После подтверждения оплаты обменник отправит монеты на ваш адрес. Проверьте транзакцию в обозревателе блокчейна по хешу из заявки.',
    warning: 'Сохраните номер заявки и чек об оплате до зачисления средств: они понадобятся, если придётся обращаться в поддержку.',
  },
];

interface Rule {
  icon: LucideIcon;
  title: string;
  text: string;
}

export const SAFETY: readonly Rule[] = [
  {
    icon: Globe,
    title: 'Поддельные сайты',
    text: 'Мошенники копируют дизайн известных обменников и меняют одну букву в адресе. Проверяйте домен и не вводите данные на сайтах из рекламы и сообщений.',
  },
  {
    icon: UserCheck,
    title: 'Верификация (KYC)',
    text: 'Некоторые обменники могут запросить документы даже после оплаты. Если условие не указано, считайте его неизвестным и уточните у поддержки заранее.',
  },
  {
    icon: Network,
    title: 'Сети блокчейна',
    text: 'Одна монета может существовать в нескольких сетях. Отправка в сеть, которую не поддерживает ваш кошелёк, обычно необратима.',
  },
  {
    icon: Percent,
    title: 'Комиссии',
    text: 'Банк, обменник и сеть блокчейна могут удерживать комиссии. Итоговая сумма может быть меньше той, что указана на этой странице.',
  },
  {
    icon: Coins,
    title: 'Адрес кошелька',
    text: 'Копируйте адрес целиком и сверяйте первые и последние символы. Вредоносные программы умеют подменять адрес в буфере обмена.',
  },
  {
    icon: KeyRound,
    title: 'Сид-фраза',
    text: 'Никогда и никому не сообщайте сид-фразу и приватные ключи. Ни обменник, ни поддержка, ни VOLTEX никогда их не запрашивают.',
  },
];

/** «Как обменять рубли на криптовалюту»: six steps and the safety rules (v0 exchange-tutorial). */
export function ExchangeTutorial() {
  return (
    <section aria-labelledby="vx-ex-tutorial-title" className="vx-ex-tutorial">
      <div className="vx-ex-section-head">
        <div>
          <p className="vx-ex-kicker">Пошаговая инструкция</p>
          <h2 id="vx-ex-tutorial-title">Как обменять рубли на криптовалюту</h2>
          <p className="vx-ex-lead">
            Шесть шагов от выбора способа оплаты до зачисления монет на ваш кошелёк. Сам обмен проходит на сайте выбранного
            обменника — VOLTEX помогает сравнить условия.
          </p>
        </div>
        <p className="vx-ex-section-badge">
          <BadgeCheck size={16} aria-hidden="true" />
          VOLTEX не хранит ваши рубли и криптовалюту
        </p>
      </div>

      <ol className="vx-ex-steps">
        {STEPS.map((step, index) => {
          const Icon = step.icon;
          return (
            <li key={step.title} className="vx-ex-card vx-ex-step">
              <div className="vx-ex-step-top">
                <span className="vx-ex-step-icon"><Icon size={20} aria-hidden="true" /></span>
                <span className="vx-ex-step-num" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              </div>
              <h3>
                <span className="vx-ex-sr">{`Шаг ${index + 1}. `}</span>
                {step.title}
              </h3>
              <p>{step.text}</p>
              {step.warning && (
                <p className="vx-ex-step-warning">
                  <TriangleAlert size={14} aria-hidden="true" />
                  <span>{step.warning}</span>
                </p>
              )}
            </li>
          );
        })}
      </ol>

      <div className="vx-ex-safety">
        <div className="vx-ex-safety-head">
          <span><ShieldAlert size={20} aria-hidden="true" /></span>
          <h3>Правила безопасности</h3>
        </div>
        <ul>
          {SAFETY.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.title}>
                <Icon size={16} aria-hidden="true" />
                <div>
                  <p className="vx-ex-strong">{item.title}</p>
                  <p>{item.text}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
