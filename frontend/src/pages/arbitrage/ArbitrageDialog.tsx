import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, X } from 'lucide-react';
import { computeArbitrage, formatNumber, formatPercent, type FormState } from './model';
import type { Strategy } from './ArbitrageEducation';
import { price, signedMoney, tone } from './ArbitrageWorkspace';

export function ArbitrageDialog({ form, strategy, onClose }: { form: FormState | null; strategy: Strategy | null; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const scope = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const result = form ? computeArbitrage(form) : null;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const siblings = Array.from(document.body.children).filter((element): element is HTMLElement => element instanceof HTMLElement && element !== scope.current && !['SCRIPT', 'STYLE', 'LINK'].includes(element.tagName));
    const previousInert = siblings.map((element) => element.inert);
    siblings.forEach((element) => { element.inert = true; });
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
      if (event.key !== 'Tab' || !dialog.current) return;
      const controls = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]'));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); dialog.current.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    const focusin = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.current?.contains(event.target)) closeButton.current?.focus();
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('focusin', focusin);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('focusin', focusin);
      document.body.style.overflow = previousOverflow;
      siblings.forEach((element, index) => { element.inert = previousInert[index]; });
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [onClose]);

  return createPortal(<div ref={scope} className="arbitrage-dialog-scope" lang="ru" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="arb-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1} data-testid="scenario-detail-dialog">
      <button ref={closeButton} type="button" className="arb-icon-button arb-dialog-close" aria-label="Закрыть разбор" onClick={onClose}><X size={20} aria-hidden="true" /></button>
      <span className="arb-eyebrow">{strategy ? 'ПОДХОД К АРБИТРАЖУ' : 'РАЗБОР СЦЕНАРИЯ'}</span>
      <h2 id={titleId}>{strategy?.title || form?.pair}</h2>
      {strategy ? <>
        <p id={descriptionId} className="arb-dialog-description">{strategy.description}</p>
        <div className="arb-dialog-scheme">{strategy.scheme}</div>
        <ol className="arb-strategy-steps">{strategy.steps.map((step) => <li key={step}>{step}</li>)}</ol>
        <p className="arb-dialog-note">{strategy.note}</p>
      </> : result?.valid && form ? <>
        <p id={descriptionId} className="arb-dialog-description">Сравнение на заданных ценах · бюджет {formatNumber(result.values.budget)} USDT</p>
        <div className="arb-dialog-route"><div><span>{form.buyVenue} · покупка</span><strong>{price(result.values.buy)} <small>USDT</small></strong></div><ArrowRight size={19} aria-hidden="true" /><div><span>{form.sellVenue} · продажа</span><strong>{price(result.values.sell)} <small>USDT</small></strong></div></div>
        <dl className="arb-breakdown">
          <div><dt>Количество {form.pair.split('/')[0]}</dt><dd>{formatNumber(result.quantity, 8)}</dd></div>
          <div><dt>Разница цен</dt><dd className={tone(result.grossSpread)}>{formatPercent(result.grossSpread)}</dd></div>
        </dl>
        <h3>Комиссии и расходы</h3>
        <dl className="arb-breakdown">
          <div><dt>Комиссия покупки <small>{formatNumber(result.values.feeBuy)}%</small></dt><dd>{formatNumber(result.buyFee)} USDT</dd></div>
          <div><dt>Комиссия продажи <small>{formatNumber(result.values.feeSell)}%</small></dt><dd>{formatNumber(result.sellFee)} USDT</dd></div>
          <div><dt>Проскальзывание покупки <small>{formatNumber(result.values.slipBuy)}%</small></dt><dd>{formatNumber(result.buySlippage)} USDT</dd></div>
          <div><dt>Проскальзывание продажи <small>{formatNumber(result.values.slipSell)}%</small></dt><dd>{formatNumber(result.sellSlippage)} USDT</dd></div>
          <div><dt>Дополнительные расходы</dt><dd>{formatNumber(result.values.extra)} USDT</dd></div>
          <div className="arb-breakdown-total"><dt>Всего расходов</dt><dd>{formatNumber(result.totalCosts)} USDT</dd></div>
        </dl>
        <div className={`arb-result${result.net < 0 ? ' is-negative' : ''}`}>
          <span>Расчётный результат</span><div className="arb-result-main"><strong className={tone(result.net)}>{signedMoney(result.net)}<small> USDT</small></strong><span className={tone(result.roi)}>{formatPercent(result.roi)}</span></div>
          <div className="arb-result-total"><span>Итог после расходов</span><strong>{formatNumber(result.proceeds)} USDT</strong></div>
        </div>
        <p className="arb-dialog-note">Бюджет включает комиссию покупки. Дополнительные расходы вычитаются после продажи. Расчёт сохраняет точность; отображаемые суммы округлены.</p>
      </> : <p id={descriptionId}>Проверьте параметры для расчёта.</p>}
      <button type="button" className="arb-dialog-done" onClick={onClose}>Понятно</button>
    </div>
  </div>, document.body);
}
