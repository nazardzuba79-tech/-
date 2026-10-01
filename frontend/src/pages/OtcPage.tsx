import { useMemo, useState } from 'react';
import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';
import { openSupportWidget } from '../lib/supportWidget';
import { CountryCombobox } from './otc/CountryCombobox';
import { CRYPTO_CURRENCIES, FIAT_CURRENCIES, TIERS, countryName, type TierId } from './otc/otcConfig';
import cities from './otc/cities.json';
import './otc/otc.css';
import './otc/otc-cash.css';

const directory = cities as Record<string,{id:string;name:string;timezone:string}[]>;

/**
 * Public OTC is a guided enquiry: collect and review the exchange parameters
 * first, then hand the user to the existing specialist form. This page never
 * reads a wallet and never creates/reserves an OTC financial request.
 */
export function OtcPage() {
  const [tier,setTier]=useState<TierId>('otc-convert');
  const [country,setCountry]=useState<string|null>(null);
  const [cityId,setCityId]=useState('');
  const [asset,setAsset]=useState('USDT');
  const [amount,setAmount]=useState('');
  const [fiat,setFiat]=useState('');
  const [review,setReview]=useState(false);

  const cityRows=useMemo(()=>country ? (directory[country] ?? []) : [],[country]);
  const city=cityRows.find(row=>row.id===cityId);
  const selectedTier=TIERS.find(row=>row.id===tier)!;
  const amountValid=/^(0|[1-9]\d{0,17})(\.\d{1,18})?$/.test(amount) && Number(amount)>0;
  const complete=!!country&&!!city&&amountValid&&!!fiat;

  function edit() { setReview(false); }
  function chooseTier(next:TierId) {
    setTier(next); edit();
    document.getElementById('otc-request-form')?.scrollIntoView({behavior:'smooth',block:'start'});
  }

  return <div className="vx-otc">
    <Nav active="/otc" />
    <main>
      <section className="otc-hero">
        <div className="otc-hero-bg" aria-hidden="true"><img src="/media/otc/hero-skyline.webp" alt="" width="1408" height="768"/></div>
        <div className="otc-wrap otc-hero-inner">
          <div className="otc-hero-head">
            <h1>Обмен криптовалюты на наличные</h1>
            <p className="otc-hero-lead">Выберите параметры обмена. После проверки заявки поддержка согласует доступность, курс и условия.</p>
          </div>
          <div className="otc-tiers">{TIERS.map(row=><div key={row.id} className={`otc-tier${tier===row.id?' is-accent':''}`}>
            <h3>{row.name}</h3>
            <p>Объём обмена от ${row.minUsd.toLocaleString('ru-RU')}</p>
            <p>Криптовалюта → наличные<br/>Одна процедура, разные уровни объёма.</p>
            <button type="button" className="otc-btn otc-btn-ghost" aria-pressed={tier===row.id} onClick={()=>chooseTier(row.id)}>Выбрать категорию</button>
          </div>)}</div>
        </div>
      </section>

      <section className="otc-section"><div className="otc-wrap">
        <ol className="otc-cash-steps">
          <li>Выберите категорию, страну и город получения.</li>
          <li>Укажите криптовалюту, количество и валюту наличных.</li>
          <li>Проверьте параметры обмена.</li>
          <li>В конце откройте поддержку и отправьте параметры специалисту.</li>
        </ol>

        <section id="otc-request-form" className="otc-cash-panel" aria-label="Параметры OTC-обмена">
          <div className="otc-cash-row"><h2>Параметры обмена</h2><strong>{selectedTier.name}</strong></div>
          <p>Категория от ${selectedTier.minUsd.toLocaleString('ru-RU')}. Фактическую доступность и условия подтверждает оператор.</p>

          <fieldset disabled={review}>
            <div className="otc-cash-fields">
              <label>Страна получения
                <CountryCombobox id="otc-country" value={country} onChange={next=>{setCountry(next);setCityId('');edit();}}/>
              </label>
              <label>Город получения
                <select value={cityId} disabled={!country} onChange={event=>{setCityId(event.target.value);edit();}}>
                  <option value="">Выберите город</option>
                  {cityRows.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </label>
              <label>Отдаёте
                <select value={asset} onChange={event=>{setAsset(event.target.value);edit();}}>
                  {CRYPTO_CURRENCIES.map(currency=><option key={currency.code} value={currency.code}>{currency.code}</option>)}
                </select>
              </label>
              <label>Количество, {asset}
                <input inputMode="decimal" autoComplete="off" value={amount} onChange={event=>{setAmount(event.target.value);edit();}} placeholder="Введите количество"/>
              </label>
              <label>Получаете наличными
                <select value={fiat} onChange={event=>{setFiat(event.target.value);edit();}}>
                  <option value="">Выберите валюту</option>
                  {FIAT_CURRENCIES.map(currency=><option key={currency.code} value={currency.code}>{currency.code}</option>)}
                </select>
              </label>
            </div>
          </fieldset>

          {!!amount&&!amountValid&&<p role="alert">Введите положительное количество без экспоненты и лишних знаков после запятой.</p>}

          {!review
            ? <button type="button" className="otc-btn otc-btn-orange" disabled={!complete} onClick={()=>setReview(true)}>Проверить параметры</button>
            : <div className="otc-cash-confirm">
                <h3>Проверьте параметры</h3>
                <p>
                  Категория: <strong>{selectedTier.name}</strong><br/>
                  Получение: <strong>{countryName(country!,'ru')}, {city!.name}</strong><br/>
                  Обмен: <strong>{amount} {asset} → {fiat} наличными</strong>
                </p>
                <p>На этом этапе средства не резервируются и не списываются. Поддержка откроется только после вашего подтверждения параметров.</p>
                <div className="otc-cash-row">
                  <button type="button" onClick={()=>setReview(false)}>Изменить параметры</button>
                  <button type="button" className="otc-btn otc-btn-orange" onClick={openSupportWidget}>Продолжить в поддержку</button>
                </div>
                <p>В форме поддержки самостоятельно укажите эти параметры и email для ответа. Ничего не отправляется автоматически.</p>
              </div>}
        </section>

        <p className="otc-cash-geography">Справочник стран и городов не означает наличие кассы. Доступность конкретного направления подтверждает оператор.</p>
      </div></section>
    </main>
    <Footer />
  </div>;
}
