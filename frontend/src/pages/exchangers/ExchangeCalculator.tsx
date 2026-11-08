import type { FormEvent } from 'react';
import { ArrowDown, ArrowRight, ChevronDown, Info, Search, TriangleAlert } from 'lucide-react';
import { formatCrypto, formatRub, parseRubAmount } from '../../../../src/shared/exchangers/amount';
import type { AssetId, NetworkId } from '../../../../src/shared/exchangers/types';
import { AssetGlyph } from './AssetGlyph';
import {
  QUICK_AMOUNTS,
  assetsIn,
  displayDecimals,
  methodOptionLabel,
  networkDisplay,
  networkHint,
  networksFor,
  pickNetwork,
  sanitizeAmountInput,
  type CalculatorDraft,
  type CalculatorOptions,
} from './model';

export type { CalculatorDraft } from './model';

export type Estimate = { kind: 'loading' } | { kind: 'value'; amount: number; assetId: AssetId } | null;

interface Props {
  options: CalculatorOptions;
  /** Directory still loading: the fields work, the search waits. */
  busy: boolean;
  /** No rate source (not_configured): the search only rebuilds the BestChange link. */
  ratesOff: boolean;
  draft: CalculatorDraft;
  onDraftChange: (next: CalculatorDraft) => void;
  dirty: boolean;
  amountError: string | null;
  onSubmit: () => void;
  estimate: Estimate;
}

function amountLabel(value: number): string {
  return formatRub(value, 0);
}

/** Horizontal «Отдаёте → Получаете» form (v0 exchange-calculator) with native, labelled controls. */
export function ExchangeCalculator({ options, busy, ratesOff, draft, onDraftChange, dirty, amountError, onSubmit, estimate }: Props) {
  const assets = assetsIn(options.pairs);
  const networks = networksFor(options.pairs, draft.assetId);
  const hasSelection = options.methods.some((m) => m.id === draft.method) && networks.some((n) => n.networkId === draft.networkId);
  const parsed = parseRubAmount(draft.amountText);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!busy && hasSelection) onSubmit();
  }

  function changeAsset(next: AssetId) {
    const networkId = pickNetwork(options.pairs, next, draft.networkId);
    if (networkId) onDraftChange({ ...draft, assetId: next, networkId });
  }

  return (
    <section aria-labelledby="vx-ex-calc-title" className="vx-ex-card vx-ex-calc">
      <div className="vx-ex-card-head">
        <h2 id="vx-ex-calc-title">Параметры обмена</h2>
        <span>RUB → криптовалюта</span>
      </div>

      <form onSubmit={handleSubmit} noValidate className="vx-ex-calc-form">
        <div className="vx-ex-calc-grid">
          <fieldset className="vx-ex-side">
            <legend className="vx-ex-sr">Отдаёте</legend>
            <span className="vx-ex-eyebrow" aria-hidden="true">Отдаёте</span>

            <div className="vx-ex-field">
              <label htmlFor="vx-ex-method">Способ оплаты</label>
              <div className="vx-ex-select">
                <AssetGlyph id="RUB" size="sm" />
                <select
                  id="vx-ex-method"
                  value={hasSelection ? draft.method : ''}
                  onChange={(e) => onDraftChange({ ...draft, method: e.target.value })}
                  disabled={options.methods.length === 0}
                >
                  {options.methods.length === 0 && <option value="">Нет доступных способов</option>}
                  {options.methods.map((m) => (
                    <option key={m.id} value={m.id} disabled={!m.available}>
                      {methodOptionLabel(m)}
                    </option>
                  ))}
                </select>
                <ChevronDown size={16} aria-hidden="true" className="vx-ex-select-chevron" />
              </div>
              <p className="vx-ex-field-hint">Рубли (RUB). Наличные не поддерживаются.</p>
            </div>

            <div className="vx-ex-field">
              <label htmlFor="vx-ex-amount">Сумма</label>
              <div className={`vx-ex-amount${amountError ? ' is-invalid' : ''}`}>
                <input
                  id="vx-ex-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="0"
                  value={draft.amountText}
                  aria-invalid={amountError ? true : undefined}
                  aria-describedby={amountError ? 'vx-ex-amount-error' : 'vx-ex-amount-hint'}
                  onChange={(e) => onDraftChange({ ...draft, amountText: sanitizeAmountInput(e.target.value) })}
                />
                <span className="vx-ex-amount-unit">RUB</span>
              </div>
              {amountError ? (
                <p id="vx-ex-amount-error" className="vx-ex-field-error" role="alert">{amountError}</p>
              ) : (
                <p id="vx-ex-amount-hint" className="vx-ex-field-hint">Копейки — через запятую или точку.</p>
              )}
              <div className="vx-ex-quick" role="group" aria-label="Быстрый выбор суммы">
                {QUICK_AMOUNTS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={parsed === value}
                    onClick={() => onDraftChange({ ...draft, amountText: new Intl.NumberFormat('ru-RU').format(value) })}
                  >
                    {amountLabel(value)}
                  </button>
                ))}
              </div>
            </div>
          </fieldset>

          <div className="vx-ex-calc-arrow" aria-hidden="true">
            <span>
              <ArrowDown size={16} className="vx-ex-arrow-down" />
              <ArrowRight size={16} className="vx-ex-arrow-right" />
            </span>
          </div>

          <fieldset className="vx-ex-side">
            <legend className="vx-ex-sr">Получаете</legend>
            <span className="vx-ex-eyebrow" aria-hidden="true">Получаете</span>

            <div className="vx-ex-field-row">
              <div className="vx-ex-field">
                <label htmlFor="vx-ex-asset">Криптовалюта</label>
                <div className="vx-ex-select">
                  <AssetGlyph id={draft.assetId} size="sm" />
                  <select
                    id="vx-ex-asset"
                    value={hasSelection ? draft.assetId : ''}
                    onChange={(e) => changeAsset(e.target.value as AssetId)}
                    disabled={assets.length === 0}
                  >
                    {assets.length === 0 && <option value="">Нет доступных монет</option>}
                    {assets.map((a) => (
                      <option key={a.assetId} value={a.assetId} disabled={!a.available}>
                        {`${a.assetId} · ${a.name}${a.available ? '' : ' (нет предложений)'}`}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={16} aria-hidden="true" className="vx-ex-select-chevron" />
                </div>
              </div>

              <div className="vx-ex-field">
                <label htmlFor="vx-ex-network">Сеть</label>
                <div className="vx-ex-select">
                  <select
                    id="vx-ex-network"
                    value={hasSelection ? draft.networkId : ''}
                    onChange={(e) => onDraftChange({ ...draft, networkId: e.target.value as NetworkId })}
                    disabled={networks.length === 0}
                  >
                    {networks.length === 0 && <option value="">Нет сетей</option>}
                    {networks.map((n) => (
                      <option key={n.networkId} value={n.networkId} disabled={!n.available}>
                        {`${networkDisplay(n.assetId, n.networkId)}${n.available ? '' : ' (нет предложений)'}`}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={16} aria-hidden="true" className="vx-ex-select-chevron" />
                </div>
              </div>
            </div>

            {hasSelection && (
              <p className="vx-ex-network-hint">
                <TriangleAlert size={14} aria-hidden="true" />
                <span>{networkHint(draft.assetId, draft.networkId, networks.length > 1)}</span>
              </p>
            )}

            <div className="vx-ex-estimate">
              <div>
                <p className="vx-ex-estimate-label">Ориентировочно к получению</p>
                {estimate?.kind === 'loading' ? (
                  <span className="vx-ex-skeleton vx-ex-skeleton--estimate" aria-hidden="true" />
                ) : (
                  <p className="vx-ex-estimate-value">
                    {estimate?.kind === 'value'
                      ? `≈ ${formatCrypto(estimate.amount, displayDecimals(estimate.assetId), estimate.assetId)}`
                      : '—'}
                  </p>
                )}
              </div>
              <span className="vx-ex-estimate-note">
                {ratesOff ? 'курсы не загружены' : 'основной курс лучшего предложения; доп. комиссии и комиссия сети не учтены'}
              </span>
            </div>
          </fieldset>
        </div>

        <div className="vx-ex-calc-foot">
          <p className="vx-ex-calc-status" aria-live="polite">
            {dirty && hasSelection ? (
              <>
                <span className="vx-ex-dot" aria-hidden="true" />
                Параметры изменены — нажмите «Найти обменники»
              </>
            ) : (
              <>
                <Info size={14} aria-hidden="true" />
                Итоговая сумма зависит от комиссий и условий обменника
              </>
            )}
          </p>
          <button type="submit" className="vx-ex-btn vx-ex-btn--primary vx-ex-btn--lg" disabled={busy || !hasSelection}>
            <Search size={18} aria-hidden="true" />
            Найти обменники
          </button>
        </div>
      </form>
    </section>
  );
}
