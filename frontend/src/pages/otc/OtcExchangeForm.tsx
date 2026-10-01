import { useId, useState, type FormEvent } from 'react';
import { ArrowDown, Info } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';
import { CountryCombobox } from './CountryCombobox';
import { FROM_CURRENCIES, TO_CURRENCIES, type OtcCurrency, type OtcRequest, type TierId } from './otcConfig';

function AssetSelect({ value, onChange, options, label }: {
  value: string;
  onChange: (code: string) => void;
  options: readonly OtcCurrency[];
  label: string;
}) {
  return (
    <select className="otc-asset" value={value} aria-label={label} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option key={option.code} value={option.code}>{option.code}</option>)}
    </select>
  );
}

/**
 * «Пример заявки»: what the client gives, what they want back, and for cash
 * the country. It prices nothing — the rate, fee and payout are the
 * manager's, as the note under the fields says — and on submit it hands the
 * chosen parameters to the page, which opens the deposit flow.
 */
export function OtcExchangeForm({ tier, showCountry = false, minLabel, onRequest }: {
  tier: TierId;
  showCountry?: boolean;
  minLabel: string;
  onRequest: (request: OtcRequest) => void;
}) {
  const { t } = useLanguage();
  const amountId = useId();
  const receiveId = useId();
  const countryId = useId();
  const [fromCurrency, setFromCurrency] = useState(FROM_CURRENCIES[0].code);
  const [toCurrency, setToCurrency] = useState(TO_CURRENCIES[0].code);
  const [amount, setAmount] = useState('100000');
  const [country, setCountry] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    onRequest({ tier, country: country ?? undefined, fromCurrency, toCurrency, amount });
  }

  return (
    <form className="otc-form" onSubmit={submit}>
      <div className="otc-form-head">
        <h3>{t('otc.form.title')}</h3>
        <span className="otc-form-badge">{t('otc.form.badge')}</span>
      </div>

      <div className="otc-fields">
        <div>
          <label className="otc-label" htmlFor={amountId}>{t('otc.form.give')}</label>
          <div className="otc-field">
            <input
              className="otc-input"
              id={amountId}
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              placeholder="100000"
              aria-label={t('otc.form.amountAria')}
              onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ''))}
            />
            <AssetSelect value={fromCurrency} onChange={setFromCurrency} options={FROM_CURRENCIES} label={t('otc.form.giveCurrency')} />
          </div>
        </div>

        <div className="otc-swap" aria-hidden="true"><span><ArrowDown size={14} /></span></div>

        <div>
          <label className="otc-label" htmlFor={receiveId}>{t('otc.form.receive')}</label>
          <div className="otc-field is-pending">
            <input className="otc-input" id={receiveId} disabled value={t('otc.form.receivePending')} />
            <AssetSelect value={toCurrency} onChange={setToCurrency} options={TO_CURRENCIES} label={t('otc.form.receiveCurrency')} />
          </div>
        </div>

        {showCountry && (
          <div>
            <label className="otc-label" htmlFor={countryId}>{t('otc.form.country')}</label>
            <CountryCombobox id={countryId} value={country} onChange={setCountry} />
          </div>
        )}
      </div>

      <p className="otc-note">
        <Info size={14} aria-hidden="true" />
        <span>{t('otc.form.note', { min: minLabel })}</span>
      </p>

      <button type="submit" className="otc-btn otc-btn-orange otc-submit">{t('otc.form.submit')} →</button>
    </form>
  );
}
