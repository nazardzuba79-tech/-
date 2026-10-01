import { useId, useMemo, useState } from 'react';
import { ArrowDownUp, ArrowRight, ArrowUpDown, Check, ChevronDown, RotateCcw, Search } from 'lucide-react';
import { computeArbitrage, formatNumber, formatPercent, formatPrice, getScenarioRows, SCENARIOS, TABLE_BUDGET, type FormState, type NumericField, type Scenario } from './model';

type Result = ReturnType<typeof computeArbitrage>;
type Filter = 'all' | 'positive' | 'negative';
type Sort = 'spread' | 'result' | 'pair';
interface WorkspaceProps {
  form: FormState;
  result: Result;
  update: (field: NumericField, value: string) => void;
  onPairChange: (pair: string) => void;
  onSelect: (scenario: Scenario) => void;
  onReset: () => void;
  onScenarioDetail: (scenario: Scenario) => void;
  onFormDetail: () => void;
}

export function signedMoney(value: number) { return `${value > 0 ? '+' : ''}${formatNumber(value)}`; }
export function price(value: number) { return formatPrice(value); }
export function tone(value: number) { return value < 0 ? 'arb-negative' : value > 0 ? 'arb-positive' : ''; }

function Coin({ pair }: { pair: string }) {
  const symbol = pair.split('/')[0];
  return <span className={`arb-coin arb-coin-${symbol.toLowerCase()}`} aria-hidden="true">{symbol === 'BTC' ? '₿' : symbol === 'ETH' ? 'Ξ' : symbol.slice(0, 1)}</span>;
}

export function ArbitrageWorkspace({ form, result, update, onPairChange, onSelect, onReset, onScenarioDetail, onFormDetail }: WorkspaceProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('result');
  const rows = useMemo(() => getScenarioRows({ query, filter, sort }), [query, filter, sort]);
  const filters: [Filter, string][] = [['all', 'Все'], ['positive', 'Положительный результат'], ['negative', 'Не покрывает расходы']];
  return <section className="arb-workspace" aria-label="Сравнение и расчёт арбитража">
    <section className="arb-panel arb-scenarios" aria-labelledby="arb-scenarios-title">
      <div className="arb-panel-heading">
        <div><h2 id="arb-scenarios-title">Сценарии арбитража</h2><p>Сравнение на заданных ценах</p></div>
        <span className="arb-budget-note">Расчёт для <strong>{formatNumber(TABLE_BUDGET, 0)} USDT</strong></span>
      </div>
      <div className="arb-table-tools">
        <label className="arb-search"><Search size={17} aria-hidden="true" /><input type="search" placeholder="Поиск пары" aria-label="Поиск пары" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label className="arb-sort"><ArrowUpDown size={15} aria-hidden="true" /><select aria-label="Сортировка сценариев" value={sort} onChange={(event) => setSort(event.target.value as Sort)}><option value="result">По результату</option><option value="spread">По разнице цен</option><option value="pair">По паре</option></select><ChevronDown size={14} aria-hidden="true" /></label>
      </div>
      <div className="arb-filters" role="group" aria-label="Фильтр по результату">{filters.map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div>
      <div className="arb-desktop-table">
        <table>
          <caption className="arb-sr-only">Сценарии арбитража. Расчётный бюджет {formatNumber(TABLE_BUDGET, 0)} USDT. Выберите пару для калькулятора.</caption>
          <thead><tr><th scope="col">Пара</th><th scope="col">Покупка / USDT</th><th scope="col">Продажа / USDT</th><th scope="col">Разница цен</th><th scope="col">Результат / USDT</th><th scope="col"><span className="arb-sr-only">Разбор</span></th></tr></thead>
          <tbody>{rows.map(({ scenario, result: row }) => <tr key={scenario.pair} data-testid={`scenario-row-${scenario.pair.split('/')[0]}`} className={form.pair === scenario.pair ? 'is-selected' : ''} onClick={() => onSelect(scenario)}>
            <th scope="row"><button className="arb-pair-button" type="button" aria-label={`Выбрать ${scenario.pair}`} aria-pressed={form.pair === scenario.pair} onClick={(event) => { event.stopPropagation(); onSelect(scenario); }}><Coin pair={scenario.pair} /><span>{scenario.pair.split('/')[0]}<small>/ USDT</small></span>{form.pair === scenario.pair && <Check size={13} className="arb-selected-check" aria-hidden="true" />}</button></th>
            <td><strong className="arb-number">{price(scenario.buy)}</strong><small>{scenario.buyVenue}</small></td>
            <td><strong className="arb-number">{price(scenario.sell)}</strong><small>{scenario.sellVenue}</small></td>
            <td className={`arb-number ${tone(row.grossSpread)}`}>{formatPercent(row.grossSpread)}</td>
            <td><strong className={`arb-number ${tone(row.net)}`}>{signedMoney(row.net)}</strong><small className={tone(row.roi)}>{formatPercent(row.roi)}</small></td>
            <td><button className="arb-row-detail" type="button" aria-label={`Разобрать сценарий ${scenario.pair}`} onClick={(event) => { event.stopPropagation(); onScenarioDetail(scenario); }}>Разобрать<ArrowRight size={13} aria-hidden="true" /></button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="arb-scenario-cards">{rows.map(({ scenario, result: row }) => <article key={scenario.pair} className={`arb-scenario-card${form.pair === scenario.pair ? ' is-selected' : ''}`}>
        <div className="arb-card-top"><button className="arb-pair-button" type="button" aria-label={`Выбрать ${scenario.pair}`} aria-pressed={form.pair === scenario.pair} onClick={() => onSelect(scenario)}><Coin pair={scenario.pair} /><span>{scenario.pair}</span>{form.pair === scenario.pair && <Check size={14} className="arb-selected-check" aria-hidden="true" />}</button><div className="arb-card-result"><small>Расчётный результат</small><strong className={tone(row.net)}>{signedMoney(row.net)}<span> USDT</span></strong></div></div>
        <div className="arb-card-prices"><div><span>{scenario.buyVenue} · покупка</span><strong>{price(scenario.buy)} <small>USDT</small></strong></div><ArrowRight size={16} aria-hidden="true" /><div><span>{scenario.sellVenue} · продажа</span><strong>{price(scenario.sell)} <small>USDT</small></strong></div></div>
        <div className="arb-card-bottom"><span>Разница цен <strong className={tone(row.grossSpread)}>{formatPercent(row.grossSpread)}</strong></span><button type="button" className="arb-row-detail" aria-label={`Разобрать сценарий ${scenario.pair}`} onClick={() => onScenarioDetail(scenario)}>Разобрать<ArrowRight size={14} aria-hidden="true" /></button></div>
      </article>)}</div>
      {rows.length === 0 && <div className="arb-empty" role="status"><Search size={24} aria-hidden="true" /><strong>Сценарии не найдены</strong><p>Измените запрос или выберите другой фильтр.</p><button type="button" className="arb-text-button" onClick={() => { setQuery(''); setFilter('all'); }}>Сбросить фильтры</button></div>}
      <div className="arb-table-foot"><span>{rows.length} из {SCENARIOS.length} сценариев</span><span>Выберите пару для расчёта справа</span></div>
      <div className="arb-table-insight"><ArrowDownUp size={18} aria-hidden="true" /><p><strong>Разница цен — только начало.</strong> Комиссии, проскальзывание и дополнительные расходы определяют расчётный результат.</p></div>
    </section>
    <aside className="arb-panel arb-calculator" aria-labelledby="arb-calculator-title">
      <div className="arb-panel-heading"><div><h2 id="arb-calculator-title">Калькулятор арбитража</h2><p>Настройте параметры сценария</p></div><button type="button" className="arb-icon-button" aria-label="Сбросить параметры" title="Сбросить параметры" onClick={onReset}><RotateCcw size={17} /></button></div>
      <div className="arb-calculator-body">
        <div className="arb-input-grid">
          <label className="arb-field"><span>Торговая пара</span><select value={form.pair} onChange={(event) => onPairChange(event.target.value)}>{SCENARIOS.map((scenario) => <option key={scenario.pair}>{scenario.pair}</option>)}</select></label>
          <NumberField name="budget" label="Бюджет" suffix="USDT" value={form.budget} error={!result.valid ? result.errors.budget : undefined} update={update} />
        </div>
        <div className="arb-quick-budgets" role="group" aria-label="Быстрые суммы">{[1000, 10000, 50000, 100000].map((budget) => <button type="button" key={budget} aria-pressed={form.budget === String(budget)} onClick={() => update('budget', String(budget))}>{formatNumber(budget, 0)}</button>)}</div>
        <div className="arb-input-grid arb-price-fields">
          <NumberField name="buy" label="Цена покупки" suffix="USDT" hint={form.buyVenue} value={form.buy} error={!result.valid ? result.errors.buy : undefined} update={update} />
          <NumberField name="sell" label="Цена продажи" suffix="USDT" hint={form.sellVenue} value={form.sell} error={!result.valid ? result.errors.sell : undefined} update={update} />
        </div>
        <div className="arb-cost-heading"><h3>Комиссии и расходы</h3><span>Учтены в результате</span></div>
        <div className="arb-input-grid">
          <NumberField name="feeBuy" label="Комиссия покупки" suffix="%" value={form.feeBuy} error={!result.valid ? result.errors.feeBuy : undefined} update={update} />
          <NumberField name="feeSell" label="Комиссия продажи" suffix="%" value={form.feeSell} error={!result.valid ? result.errors.feeSell : undefined} update={update} />
          <NumberField name="slipBuy" label="Проскальзывание покупки" suffix="%" value={form.slipBuy} error={!result.valid ? result.errors.slipBuy : undefined} update={update} />
          <NumberField name="slipSell" label="Проскальзывание продажи" suffix="%" value={form.slipSell} error={!result.valid ? result.errors.slipSell : undefined} update={update} />
        </div>
        <NumberField name="extra" label="Дополнительные расходы" suffix="USDT" value={form.extra} error={!result.valid ? result.errors.extra : undefined} update={update} />
        <div className={`arb-result${result.valid && result.net < 0 ? ' is-negative' : ''}${!result.valid ? ' is-invalid' : ''}`} data-testid="calculator-result" aria-live="polite" aria-atomic="true">
          <span>Расчётный результат</span>
          <div className="arb-result-main"><strong className={result.valid ? tone(result.net) : ''}>{result.valid ? signedMoney(result.net) : '—'}<small> USDT</small></strong><span className={result.valid ? tone(result.roi) : ''}>{result.valid ? formatPercent(result.roi) : '—'}</span></div>
          <div className="arb-result-total"><span>Итог после расходов</span><strong>{result.valid ? `${formatNumber(result.proceeds)} USDT` : '—'}</strong></div>
          {!result.valid && <p>{result.errors.calculation || 'Проверьте отмеченные поля для расчёта.'}</p>}
        </div>
        <button type="button" className="arb-primary-button" onClick={onFormDetail} disabled={!result.valid}>Разобрать сценарий<ArrowRight size={16} aria-hidden="true" /></button>
        <p className="arb-calculator-note">Оценка по заданным ценам. Изменение цены, ликвидность и время перевода влияют на фактический результат.</p>
      </div>
    </aside>
  </section>;
}

function NumberField({ name, label, suffix, hint, value, error, update }: { name: NumericField; label: string; suffix: string; hint?: string; value: string; error?: string; update: WorkspaceProps['update'] }) {
  const id = useId();
  return <label className={`arb-field${error ? ' has-error' : ''}`} htmlFor={id}>
    <span>{label}{hint && <small>{hint}</small>}</span>
    <span className="arb-input-wrap"><input id={id} name={name} type="text" inputMode="decimal" autoComplete="off" spellCheck={false} value={value} onChange={(event) => update(name, event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} /><span aria-hidden="true">{suffix}</span></span>
    {error && <small className="arb-field-error" id={`${id}-error`}>{error}</small>}
  </label>;
}
