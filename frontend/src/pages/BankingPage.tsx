import { useEffect, useState } from 'react';
import { Copy, Landmark, LockKeyhole, RefreshCw, Users, WalletCards, X } from 'lucide-react';
import { Nav } from '../components/Nav';
import {
  bankingApi,
  bankingErrorText,
  bankingNumber,
  type BankingAsset,
  type BankingCalculation,
  type BankingConfig,
  type BankingProgramId,
  type BankingReferral,
  type BankingState,
} from '../lib/bankingApi';
import './banking/BankingPage.css';
import './banking/BankingReadability.css';

const today = () => new Date().toISOString().slice(0, 10);
const percent = (rate: string) => `${bankingNumber(String(Number(rate) * 100), 0)}%`;
const programLabel = (id: BankingProgramId) => (id === 'MONTHLY_17_24M' ? 'Ежемесячные выплаты' : 'Накопление');

export function BankingPage() {
  const [config, setConfig] = useState<BankingConfig | null>(null);
  const [state, setState] = useState<BankingState | null>(null);
  const [referral, setReferral] = useState<BankingReferral | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [programId, setProgramId] = useState<BankingProgramId>('COMPOUND_21_12M');
  const [asset, setAsset] = useState<BankingAsset>('USDT');
  const [amount, setAmount] = useState('');
  const [startDate, setStartDate] = useState(today());
  const [period, setPeriod] = useState<'6' | '12' | '24' | 'custom'>('6');
  const [endDate, setEndDate] = useState('');
  const [calculation, setCalculation] = useState<BankingCalculation | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [success, setSuccess] = useState('');

  const program = config?.programs.find((row) => row.id === programId) ?? null;
  const assetInfo = config?.assets.find((row) => row.asset === asset) ?? null;
  const placements = state?.placements ?? [];
  const minimumText = assetInfo?.minimumAssetQty ? `${assetInfo.minimumAssetQty} ${asset}` : '—';
  const precision = asset === 'USDT' || asset === 'USDC' ? 2 : 8;

  /**
   * The referral block is additive: if this call fails the rest of Banking is
   * still correct, so it is fetched on its own and its failure is swallowed
   * rather than raised into the page-level error banner.
   */
  const loadReferral = () => { void bankingApi.referral().then(setReferral).catch(() => setReferral(null)); };

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const [nextConfig, nextState] = await Promise.all([bankingApi.config(), bankingApi.state()]);
      setConfig(nextConfig);
      setState(nextState);
    } catch (nextError) {
      setError(bankingErrorText(nextError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    loadReferral();
  }, []);

  useEffect(() => {
    setCalculation(null);
    if (program?.termMonths === 12 && period === '24') setPeriod('12');
  }, [programId, asset, amount, startDate, period, endDate, program?.termMonths]);

  const availablePeriods = program?.termMonths === 24
    ? (['6', '12', '24', 'custom'] as const)
    : (['6', '12', 'custom'] as const);
  const canCalculate = Boolean(amount && startDate && assetInfo?.priceUsd && (period !== 'custom' || endDate));

  async function calculate() {
    if (!canCalculate) return;
    setBusy(true);
    setError('');
    try {
      setCalculation(await bankingApi.calculate({
        programId,
        asset,
        amount,
        startDate,
        ...(period === 'custom' ? { endDate } : { periodMonths: Number(period) }),
      }));
    } catch (nextError) {
      setError(bankingErrorText(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function place() {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await bankingApi.createPlacement({ programId, asset, amount, idempotencyKey: crypto.randomUUID() });
      setConfirmOpen(false);
      setSuccess('Размещение создано. Данные сохранены в Banking ledger.');
      setAmount('');
      setCalculation(null);
      setState(await bankingApi.state());
    } catch (nextError) {
      setError(bankingErrorText(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="banking-page">
      <Nav active="/banking" />
      <main className="banking-main">
        <section className="banking-hero">
          <div>
            <p className="banking-eyebrow">VOLTEX BANKING</p>
            <h1>VOLTEX Banking &amp; Earn</h1>
            <h2>Ваш цифровой банк в кармане.</h2>
            <p>Торговля, карта и доход — в одном аккаунте VOLTEX.</p>
          </div>
          <div className="banking-hero-mark"><Landmark size={28} /><span>Banking &amp; Earn</span></div>
        </section>

        {error && <div className="banking-alert" role="alert"><span>{error}</span><button onClick={() => void refresh()}><RefreshCw size={14} />Обновить</button></div>}
        {success && <div className="banking-success" role="status">{success}</div>}

        <section className="banking-summary" aria-label="Обзор Banking & Earn">
          <article><span>Всего в Earn</span><strong>{state?.summary.totalUsd === null ? '—' : `$${bankingNumber(state?.summary.totalUsd)}`}</strong><small>Текущая справочная оценка в USD</small></article>
          <article><span>Начислено</span><strong>{state?.summary.accruedUsd === null ? '—' : `$${bankingNumber(state?.summary.accruedUsd)}`}</strong><small>За завершённые календарные месяцы</small></article>
          <article><span>Активные размещения</span><strong>{state?.summary.activeCount ?? (loading ? '—' : '0')}</strong><small>Данные из Banking ledger</small></article>
        </section>

        <section className="banking-section">
          <div className="banking-heading"><div><h2>Программы Earn</h2><p>Вознаграждение всегда начисляется в активе вклада. USD — только справочный эквивалент.</p></div></div>
          <div className="banking-program-grid">
            {(config?.programs ?? []).map((item) => (
              <article key={item.id} className={`banking-program${programId === item.id ? ' selected' : ''}`} onClick={() => setProgramId(item.id)}>
                <div className="banking-program-top"><div><span>{programLabel(item.id)}</span><h3>{percent(item.monthlyRate)} <small>в месяц</small></h3></div>{item.compound ? <LockKeyhole /> : <RefreshCw />}</div>
                <dl>
                  <dt>Срок</dt><dd>{item.termMonths} месяцев</dd>
                  <dt>Минимум</dt><dd>эквивалент $2,500</dd>
                  <dt>Капитализация</dt><dd>{item.compound ? 'Ежемесячная' : 'Без auto-compound'}</dd>
                  <dt>Выплата</dt><dd>{item.payoutFrequency === 'MONTHLY' ? 'Ежемесячно' : 'После завершения срока'}</dd>
                </dl>
                <p className="banking-condition">{item.lockRule === 'PRINCIPAL_RETURN_UNDEFINED' ? 'Условия досрочного возврата основной суммы пока не определены.' : `Основная сумма и вознаграждения заблокированы на ${item.termMonths} месяцев.`}</p>
                <div className="banking-assets">USDT · USDC · BTC · ETH · SOL</div>
                <button type="button" onClick={(event) => { event.stopPropagation(); setProgramId(item.id); document.getElementById('banking-calculator')?.scrollIntoView({ behavior: 'smooth' }); }}>Рассчитать</button>
              </article>
            ))}
          </div>
        </section>

        <section className="banking-section" id="banking-calculator">
          <div className="banking-heading"><div><h2>Калькулятор дохода</h2><p>Расчёт выполняется на сервере через BigNumber и учитывает только завершённые календарные месяцы.</p></div></div>
          <div className="banking-calculator">
            <div className="banking-form">
              <label>Программа<select value={programId} onChange={(event) => setProgramId(event.target.value as BankingProgramId)}>{config?.programs.map((item) => <option key={item.id} value={item.id}>{programLabel(item.id)} · {percent(item.monthlyRate)} в месяц</option>)}</select></label>
              <div className="banking-field-row">
                <label>Актив<select value={asset} onChange={(event) => setAsset(event.target.value as BankingAsset)}>{(['USDT', 'USDC', 'BTC', 'ETH', 'SOL'] as BankingAsset[]).map((item) => <option key={item}>{item}</option>)}</select></label>
                <label>Сумма<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></label>
              </div>
              <div className="banking-reference"><span>Эквивалент в USD</span><strong>{amount && assetInfo?.priceUsd ? `≈ $${bankingNumber(String(Number(amount) * Number(assetInfo.priceUsd)))}` : '—'}</strong></div>
              <div className="banking-reference"><span>Минимум по текущей цене</span><strong>{minimumText}</strong></div>
              <label>Дата начала<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
              <div className="banking-periods">{availablePeriods.map((value) => <button type="button" key={value} className={period === value ? 'active' : ''} onClick={() => setPeriod(value)}>{value === 'custom' ? 'Выбрать дату' : `${value} мес.`}</button>)}</div>
              {period === 'custom' && <label>Дата окончания расчёта<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>}
              <button className="banking-primary" disabled={!canCalculate || busy} onClick={() => void calculate()}>{busy ? 'Расчёт…' : 'Рассчитать'}</button>
            </div>

            <div className="banking-result">
              {calculation ? <>
                <div className="banking-result-head"><div><span>{programLabel(programId)}</span><strong>{asset}</strong></div><span>{calculation.completedMonths} завершённых мес.</span></div>
                <div className="banking-result-grid">
                  <article><span>Основная сумма</span><strong>{bankingNumber(calculation.principal, precision)} <small>{asset}</small></strong></article>
                  {calculation.monthlyReward && <article><span>Ежемесячная выплата</span><strong>{bankingNumber(calculation.monthlyReward, precision)} <small>{asset}</small></strong></article>}
                  <article><span>Начисленный доход</span><strong>{bankingNumber(calculation.profit, precision)} <small>{asset}</small></strong></article>
                  <article className="featured"><span>{program?.compound ? 'Расчётный баланс' : 'Суммарные выплаты'}</span><strong>{bankingNumber(program?.compound ? calculation.balance : calculation.totalRewards, precision)} <small>{asset}</small></strong></article>
                </div>
                <p>Период: {calculation.startDate} — {calculation.endDate}. Дата завершения: {calculation.maturityDate}. Без комиссий и налогов.</p>
                <button className="banking-primary" disabled={busy} onClick={() => setConfirmOpen(true)}>Разместить средства</button>
              </> : <div className="banking-result-empty"><Landmark size={30} /><h3>Ваш расчёт появится здесь</h3><p>Введите сумму и период. Неизвестные рыночные значения не подменяются нулями.</p></div>}
            </div>
          </div>
        </section>

        <section className="banking-card-yield">
          <div className="banking-card-icon"><WalletCards /></div>
          <div><span className="banking-eyebrow">ОТДЕЛЬНЫЙ ПРОДУКТ</span><h2>VOLTEX Card Yield</h2><p><strong>{config ? percent(config.cardYield.annualRate) : '—'} годовых на USDT</strong> — на фактический доступный баланс карты. Средства не блокируются и могут быть потрачены в любой момент.</p></div>
          <div className="banking-card-metric"><span>Доступный баланс карты</span><strong>{state?.cardYield.availableCardBalance ?? '—'} USDT</strong><small>Не смешивается с балансом Earn</small></div>
        </section>

        {/*
          * Banking referral. Sits between the products and the user's own
          * placements because that is where it reads as part of the Banking
          * ecosystem rather than as an advertisement.
          *
          * EVERY FIGURE HERE IS REAL. referredCount, the per-asset totals and
          * the recent list all come from GET /banking/referral, which reports
          * only settled Banking commissions — never the 5%-of-deposit rewards,
          * which are a different product with a different base and have their
          * own page in Settings. When there is nothing yet, this block says so
          * rather than showing a persuasive number.
          */}
        <section className="banking-section banking-referral">
          <div className="banking-heading"><div><h2>Реферальная программа</h2><p>Получайте {referral ? referral.referralPercent : 20}% от прибыли приглашённых пользователей в VOLTEX Banking. Комиссию выплачивает VOLTEX — доход самого реферала не уменьшается.</p></div></div>
          <div className="banking-referral-grid">
            <article className="banking-referral-headline">
              <strong>{referral ? referral.referralPercent : 20}%</strong>
              <span>от прибыли рефералов</span>
            </article>
            <article><span>Рефералов</span><strong>{referral ? referral.referredCount : '—'}</strong></article>
            <article>
              <span>Заработано</span>
              {referral && referral.rewardsByAsset.length
                ? <strong className="banking-referral-assets">{referral.rewardsByAsset.map((row) => <em key={row.asset}>{bankingNumber(row.amount, row.asset === 'USDT' || row.asset === 'USDC' ? 2 : 8)} <small>{row.asset}</small></em>)}</strong>
                : <strong>{referral ? '0' : '—'}</strong>}
            </article>
          </div>
          <div className="banking-referral-link">
            <div>
              <span>Ваша ссылка</span>
              <code>{referral ? `${window.location.origin}/${referral.referralCode}` : '—'}</code>
            </div>
            <button type="button" className="banking-primary" disabled={!referral}
              onClick={() => { if (!referral) return; void navigator.clipboard.writeText(`${window.location.origin}/${referral.referralCode}`).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }).catch(() => setCopied(false)); }}>
              <Copy size={15} /> {copied ? 'Скопировано' : 'Копировать'}
            </button>
          </div>
          {referral && referral.recentRewards.length > 0 && (
            <div className="banking-table-wrap">
              <table><thead><tr><th>Дата</th><th>Прибыль реферала</th><th>Ваша комиссия</th><th>Актив</th></tr></thead>
                <tbody>{referral.recentRewards.map((row) => {
                  const digits = row.asset === 'USDT' || row.asset === 'USDC' ? 2 : 8;
                  return <tr key={row.id}><td>{row.createdAt.slice(0, 10)}</td><td>{bankingNumber(row.sourceProfitAmount, digits)}</td><td><b>{bankingNumber(row.amount, digits)}</b></td><td>{row.asset}</td></tr>;
                })}</tbody></table>
            </div>
          )}
          {referral && referral.referredCount === 0 && (
            <div className="banking-empty"><Users size={18} /> Приглашённых пользователей пока нет. Комиссия начисляется с фактически выплаченной прибыли реферала, а не с суммы его размещения.</div>
          )}
        </section>

        <section className="banking-section">
          <div className="banking-heading"><div><h2>Мои размещения</h2><p>Только ваши фактические размещения.</p></div></div>
          <div className="banking-table-wrap">
            {placements.length ? <table><thead><tr><th>Актив</th><th>Программа</th><th>Основная сумма</th><th>Ставка</th><th>Начислено</th><th>Статус</th><th>Завершение</th></tr></thead><tbody>{placements.map((row) => <tr key={row.id}><td><b>{row.asset}</b></td><td>{programLabel(row.programId)}</td><td>{bankingNumber(row.principal, row.asset === 'USDT' || row.asset === 'USDC' ? 2 : 8)}</td><td>{percent(row.monthlyRate)} / мес.</td><td>{bankingNumber(row.rewardAccrued, row.asset === 'USDT' || row.asset === 'USDC' ? 2 : 8)} {row.asset}</td><td>{row.status === 'ACTIVE' ? 'Активно' : 'Завершено'}</td><td>{row.maturityDate}</td></tr>)}</tbody></table> : <div className="banking-empty">Активных размещений пока нет.</div>}
          </div>
        </section>
      </main>

      {confirmOpen && calculation && <div className="banking-modal-backdrop" role="presentation"><div className="banking-modal" role="dialog" aria-modal="true" aria-label="Подтверждение размещения"><button className="banking-modal-close" onClick={() => setConfirmOpen(false)} aria-label="Закрыть"><X /></button><h2>Подтвердить размещение</h2><p>{programLabel(programId)} · {asset}</p><div className="banking-modal-amount">{bankingNumber(amount, precision)} <span>{asset}</span></div><dl><dt>Ставка</dt><dd>{program && percent(program.monthlyRate)} в месяц</dd><dt>Срок</dt><dd>{program?.termMonths} месяцев</dd><dt>Валюта вознаграждения</dt><dd>{asset}</dd><dt>Минимум</dt><dd>эквивалент $2,500</dd></dl><p className="banking-condition">{program?.lockRule === 'PRINCIPAL_RETURN_UNDEFINED' ? 'Условия досрочного возврата основной суммы не определены.' : `Основная сумма и вознаграждения заблокированы на ${program?.termMonths ?? 24} месяцев.`}</p><button className="banking-primary" disabled={busy} onClick={() => void place()}>{busy ? 'Сохранение…' : 'Подтвердить'}</button></div></div>}
    </div>
  );
}