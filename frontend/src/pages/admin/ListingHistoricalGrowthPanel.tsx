import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { HISTORY20_CATALOG, HISTORY20_PACK, HISTORY20_ROTATION, type HistoricalGrowthCatalogItem } from './historicalGrowthCatalog';
import {
  HISTORICAL_GROWTH_LABEL, HISTORICAL_GROWTH_PREVIEW_UNIT, historicalGrowthCandles, historicalGrowthDailyModel, historicalGrowthFold,
  historicalGrowthIntrabarVersion, historicalGrowthMaxPrice, historicalGrowthSummary, historicalGrowthWithIntrabar,
  type HistoricalGrowthIntrabar, type HistoricalGrowthProgram, type HistoricalGrowthSource,
} from './historicalGrowthModel';
import {
  clearHistoricalGrowthWindows, importHistory20FromFiles, listHistoricalGrowthWindows, saveHistoricalGrowthWindows,
  type History20ImportReport, type HistoricalGrowthWindowRecord,
} from './historicalGrowthPack';
import { formatMovementPrice } from './listingMovementModel';
import { ListingCandlePreview } from './ListingCandlePreview';

const DATA_KIND = { daily_reference: 'Опорная цена за сутки (не OHLC)', exchange_ohlcv: 'Биржевые дневные OHLCV' } as const;
const FOLD = { train: 'обучение', validation: 'валидация', test: 'тест' } as const;
const percent = (value: number | string) => `+${Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}%`;
const days = (item: HistoricalGrowthCatalogItem) => item.dataKind === 'exchange_ohlcv' ? item.rows : item.rows - 1;
const price = (value: number) => formatMovementPrice(Number(value.toPrecision(10)));

/** What is observed and what is modeled, by data kind and intraday model; shown wherever the window is charted. */
export function historicalGrowthProvenance(program: { intrabar: HistoricalGrowthIntrabar; source: Pick<HistoricalGrowthSource, 'dataKind' | 'provider' | 'metric'> }): { observed: string; modeled: string } {
  const reference = program.source.dataKind === 'daily_reference', v1 = historicalGrowthIntrabarVersion(program) === 1;
  return {
    observed: reference
      ? `Наблюдение: одна опорная цена ${program.source.provider} ${program.source.metric} на сутки (граница суток), нормирована в единицы модели. Дневного максимума и минимума в источнике нет.`
      : `Наблюдение: дневные O/H/L/C ${program.source.provider}, нормированы в единицы модели.${v1 ? '' : ' Свеча 1d в симуляции равна дневному бару источника.'}`,
    modeled: v1
      ? `МОДЕЛЬ v1 (базовая линия, ${program.intrabar}): ${reference ? 'прямая между опорными ценами' : 'три прямых отрезка open → экстремум → экстремум → close'}; объём — модель.`
      : `МОДЕЛЬ v2 (${program.intrabar}): путь внутри суток — детерминированный мост по коду варианта с паузами и всплесками активности${reference ? '; внутрисуточные тени, максимум и минимум выдуманы моделью в пределах полосы и ниже потолка' : '; порядок и время максимума и минимума неизвестны и задаются моделью, диапазон суток источника не превышается'}. Объём — модельная активность, не объём площадки.`,
  };
}

/** The next scenario of the deterministic 20-ID cycle: one step per listing ID that already uses a window. */
export function nextRotationScenario(usedByOtherListings: number): { id: string; position: number } {
  const position = ((usedByOtherListings % HISTORY20_ROTATION.length) + HISTORY20_ROTATION.length) % HISTORY20_ROTATION.length;
  return { id: HISTORY20_ROTATION[position], position: position + 1 };
}

function download(name: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Admin → Listings: the historical GROWTH WINDOW (owner pack History20). The
 * 20 cards are committed metadata; a window's trajectory exists only after
 * the pack is imported on this device. Draft and private preview only:
 * publication, trading, balances and owner allocation stay refused.
 */
export function ListingHistoricalGrowthPanel({ program, initialPrice, listingAt, rotationCursor, locked, draftSymbol, autoChoose, onChoose, onReturn }: {
  program: HistoricalGrowthProgram | undefined;
  initialPrice: string;
  listingAt: string | null;
  /** How many OTHER listing IDs already use a window: the rotation's saved cursor. */
  rotationCursor: number;
  locked: boolean;
  draftSymbol: string;
  /** A scenario to apply as soon as it is on this device (the BotLab 01 proposal). */
  autoChoose?: string;
  onChoose: (program: HistoricalGrowthProgram) => void;
  onReturn: () => void;
}) {
  const [records, setRecords] = useState<HistoricalGrowthWindowRecord[]>([]);
  const [report, setReport] = useState<History20ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [weekly, setWeekly] = useState(true);
  // New choices use the v2 bridge; v1 stays available as the straight-line baseline.
  const [preferredVersion, setPreferredVersion] = useState<1 | 2>(2);
  // A chosen window shows its own model; before a choice, the admin's preference (v2 by default) applies.
  const intrabarVersion = program ? historicalGrowthIntrabarVersion(program) : preferredVersion;
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    void listHistoricalGrowthWindows().then(items => { if (active.current) setRecords(items); })
      .catch(e => { if (active.current) setError(e instanceof Error ? e.message : 'Локальная библиотека недоступна'); });
    return () => { active.current = false; };
  }, []);
  const byId = useMemo(() => new Map(records.map(r => [r.scenarioId, r])), [records]);
  useEffect(() => {
    const record = autoChoose && !program ? byId.get(autoChoose) : undefined;
    if (record) onChoose(historicalGrowthWithIntrabar(record.program, preferredVersion));
  }, [autoChoose, program, byId, onChoose, preferredVersion]);
  const next = nextRotationScenario(rotationCursor);
  const selected = program ? HISTORY20_CATALOG.find(item => item.id === program.scenarioId) : undefined;
  const p0 = Number(initialPrice) > 0 ? initialPrice : '1';
  const summary = program ? historicalGrowthSummary(program, p0) : null;

  async function importPack(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    setBusy(true); setError(null);
    try {
      const result = await importHistory20FromFiles(files);
      await saveHistoricalGrowthWindows(result.records);
      const stored = await listHistoricalGrowthWindows();
      if (!active.current) return;
      setRecords(stored); setReport(result.report);
    } catch (e) { if (active.current) setError(e instanceof Error ? e.message : 'Не удалось проверить пакет'); }
    finally { if (active.current) setBusy(false); }
  }
  async function forget() {
    if (!window.confirm('Удалить загруженные окна только из этого браузера? Сохранённые черновики не изменятся.')) return;
    setBusy(true); setError(null);
    try { await clearHistoricalGrowthWindows(); if (active.current) { setRecords([]); setReport(null); } }
    catch (e) { if (active.current) setError(e instanceof Error ? e.message : 'Не удалось очистить библиотеку'); }
    finally { if (active.current) setBusy(false); }
  }
  function choose(id: string) {
    const record = byId.get(id);
    if (!record) { setError('Сначала загрузите пакет History20 на это устройство'); return; }
    setError(null); onChoose(historicalGrowthWithIntrabar(record.program, intrabarVersion));
  }
  function chooseIntrabar(version: 1 | 2) {
    setPreferredVersion(version);
    if (program) onChoose(historicalGrowthWithIntrabar(program, version));
  }
  const provenance = program ? historicalGrowthProvenance(program) : null;
  function exportDraft() {
    if (!program || !selected) return;
    const s = historicalGrowthSummary(program, p0);
    download(`${draftSymbol || 'listing'}-${program.scenarioId}-draft.json`, 'application/json', JSON.stringify({
      schema: 'voltex.listing-draft.proposal.v1', status: 'ADMIN_FORM_EXPORT_NOT_PUBLISHED', symbol_proposed: draftSymbol || null,
      unit: `${HISTORICAL_GROWTH_PREVIEW_UNIT} (simulation accounting unit only, not deposit currency)`,
      source_scenario_id: program.scenarioId, scenario_sha256: selected.scenarioFileSha256, initial_price: p0,
      target_peak_growth_pct: program.targetPeakGrowthPercent, max_price: historicalGrowthMaxPrice(p0, program.targetPeakGrowthPercent), price_tick: '0.0000000001', cap_rounding: 'FLOOR_TO_TICK',
      source_research_target_peak_growth_pct: selected.targetPeakGrowthPercent, target_normalization: program.targetNormalization ?? null,
      legacy_growth_before_historical: false, legacy_after_growth_chain_enabled: false,
      clock: { mode: 'REAL_TIME', source_step_seconds: 86400, elapsed_days: s.days, proposed_120h_mode: 'INACTIVE_REQUIRES_OWNER_CONFIRMATION' },
      data_kind: program.source.dataKind, intrabar: program.intrabar, listing_at_utc: listingAt, published: false, tradable_in_ordinary_spot: false,
      real_ledger_effects: false, owner_allocation: '0', public_label_required: HISTORICAL_GROWTH_LABEL, rights_status: HISTORY20_PACK.rightsStatus,
      preserve_gate: 'HISTORICAL_RIGHTS_UNVERIFIED', fold: historicalGrowthFold(program.source.asset),
    }, null, 2));
  }
  function exportModel() {
    if (!program) return;
    const rows = historicalGrowthDailyModel(program, p0).map(d => `${d.day},${d.open},${d.high},${d.low},${d.close}`);
    // Model values of THIS listing (P0 units), not the source prices; same licence and rights notice as the pack.
    download(`${program.scenarioId}-model-${HISTORICAL_GROWTH_PREVIEW_UNIT}.csv`, 'text/csv',
      `# ${HISTORICAL_GROWTH_LABEL}. Model of ${program.scenarioId} (${program.source.provider}, ${program.source.license}); P0=${p0}; not a forecast, not source prices.\nscenario_day,open,high,low,close\n${rows.join('\n')}\n`);
  }

  return <section className="listing-history-growth" data-historical-growth aria-label="Историческое окно роста">
    <h3>Историческое окно роста · библиотека History20</h3>
    <p className="listing-growth-label" data-growth-label>{HISTORICAL_GROWTH_LABEL}</p>
    <p className="listing-hint">Окно заменяет запрограммированные этапы: первая цена окна — начальная цена листинга, пик — ровно P0 · (1 + G/100). Черновик и закрытый предпросмотр; публикация, торговля, балансы и выдача владельцу заблокированы, права на данные не подтверждены (некоммерческие лицензии источников).</p>
    <div className="listing-growth-import">
      <label className="listing-file-button">Загрузить пакет (ZIP)<input type="file" accept=".zip,application/zip" disabled={busy || locked} onChange={e => { void importPack(e); }} data-field="history20Zip" /></label>
      <label className="listing-file-button">…или распакованную папку<input type="file" disabled={busy || locked} onChange={e => { void importPack(e); }} data-field="history20Folder"
        {...{ webkitdirectory: '', directory: '' } as Record<string, string>} multiple /></label>
      <span data-history20-status>{records.length === HISTORY20_CATALOG.length ? `Все ${records.length} окон на этом устройстве` : `На устройстве ${records.length} из ${HISTORY20_CATALOG.length} окон`}</span>
      {records.length > 0 && <button type="button" onClick={() => { void forget(); }} disabled={busy} data-history20-clear>Удалить с устройства</button>}
    </div>
    {report && <p role="status" className="listing-hint" data-history20-report>Пакет проверен: {report.filesVerified} файлов по SHA-256, {report.scenarios} окон, {report.rows} суток. Совпадение с normalized_path: отклонение не более {report.maxParityRelError.toExponential(1)}. Сохранены только ln(P/A), {Math.round(report.storedBytes / 1024)} КБ; цены и объёмы источника не сохраняются.</p>}
    {busy && <p role="status">Проверка пакета…</p>}
    {error && <p role="alert" className="listing-error">{error}</p>}
    <fieldset className="listing-growth-intrabar" data-history20-intrabar disabled={busy || locked}>
      <legend>Модель внутри суток (одинаковые дневные значения источника)</legend>
      <label className="listing-check"><input type="radio" name="history20Intrabar" checked={intrabarVersion === 2} onChange={() => chooseIntrabar(2)} data-field="history20IntrabarV2" /> v2 — детерминированный мост с паузами и всплесками (по умолчанию)</label>
      <label className="listing-check"><input type="radio" name="history20Intrabar" checked={intrabarVersion === 1} onChange={() => chooseIntrabar(1)} data-field="history20IntrabarV1" /> v1 — прямые отрезки (базовая линия для сравнения)</label>
    </fieldset>
    <div className="listing-growth-rotation" data-history20-rotation>
      <span>Следующий по ротации: <b>{next.id}</b> (позиция {next.position} из {HISTORY20_ROTATION.length}; по одному шагу на каждый новый листинг)</span>
      <button type="button" disabled={busy || locked || !byId.has(next.id)} onClick={() => choose(next.id)} data-choose-rotation>Выбрать</button>
    </div>
    <p className="listing-hint">Повторное использование окна не создаёт независимых данных для обучения. Это набор сильного роста, а не доказательство прибыльности: контроль на падении, боковике и вне выборки нужен отдельно.</p>
    <div className="listing-growth-cards" role="list" data-history20-cards>
      {HISTORY20_CATALOG.map((item, index) => {
        const ready = byId.has(item.id), chosen = program?.scenarioId === item.id;
        return <article role="listitem" key={item.id} className={`listing-growth-card${chosen ? ' is-chosen' : ''}`} data-history20-card={item.id} aria-current={chosen || undefined}>
          <header><span className="listing-scenario-number">{String(index + 1).padStart(2, '0')}</span><b>{item.id}</b><small>{item.asset} · {item.windowStart} — {item.windowEnd}</small></header>
          <dl>
            <div><dt>Данные</dt><dd>{DATA_KIND[item.dataKind]} · {item.sourceSymbol}</dd></div>
            <div><dt>Рост источника</dt><dd>{percent(item.rawPeakGrowthPercent)}</dd></div>
            <div><dt>Цель исследования</dt><dd>{percent(item.targetPeakGrowthPercent)}</dd></div>
            <div><dt>α исследования</dt><dd>{item.alpha.toFixed(4)}</dd></div>
            <div><dt>Просадка исследования (close)</dt><dd>{item.rawMaxCloseDrawdownPercent}% → {item.modelMaxCloseDrawdownPercent}%</dd></div>
            {item.id === 'VHX-09-MATIC' && <div><dt>Новая модель · политика v1</dt><dd>+15000% · форма ln(P/A) сохранена</dd></div>}
            <div><dt>Длительность</dt><dd>{days(item)} сут. реального времени</dd></div>
            <div><dt>Источник</dt><dd>{item.provider} · {item.license}</dd></div>
            <div><dt>SHA-256 среза</dt><dd><code>{item.sourceSliceSha256.slice(0, 12)}…</code></dd></div>
            <div><dt>Набор</dt><dd>{FOLD[historicalGrowthFold(item.asset)]} (по активу)</dd></div>
          </dl>
          <footer>
            <small>{ready ? 'Данные на устройстве' : 'Нужен пакет History20'} · права не подтверждены</small>
            <button type="button" disabled={busy || locked || !ready} aria-pressed={chosen} onClick={() => choose(item.id)} data-choose-history20={item.id}>{chosen ? 'Выбрано' : 'Выбрать'}</button>
          </footer>
        </article>;
      })}
    </div>
    {program && summary && <div className="listing-growth-selected" data-history20-selected={program.scenarioId}>
      <h4>{program.scenarioId}: вся форма окна</h4>
      {program.targetNormalization && <p className="listing-hint" data-history20-normalization>Производная модель v{program.targetNormalization.version}: цель исследования +{program.targetNormalization.sourceTargetPeakGrowthPercent}% → предел владельца +{program.targetPeakGrowthPercent}%. Изменена только амплитуда в логарифмической шкале; исходные файлы, даты, ln(P/A) и их SHA-256 не изменены. Сохранённые ранее черновики не переписываются.</p>}
      <dl className="listing-preview-metrics" data-history20-summary>
        <div><dt>Начальная цена (P0)</dt><dd>{price(Number(p0))} {HISTORICAL_GROWTH_PREVIEW_UNIT}</dd></div>
        <div><dt>Пик модели = P0 · M</dt><dd data-history20-peak>{price(summary.peak)} {HISTORICAL_GROWTH_PREVIEW_UNIT} ({percent(program.targetPeakGrowthPercent)})</dd></div>
        <div><dt>Пик на сутки</dt><dd>{summary.peakDay + 1}-е из {summary.days}</dd></div>
        <div><dt>Последнее значение</dt><dd>{price(summary.last)} {HISTORICAL_GROWTH_PREVIEW_UNIT}</dd></div>
        <div><dt>Макс. просадка модели</dt><dd>{summary.maxCloseDrawdownPercent.toFixed(2)}%</dd></div>
        <div><dt>α</dt><dd>{summary.alpha.toFixed(6)}</dd></div>
        <div><dt>Время</dt><dd data-history20-clock>REAL_TIME: 1 сутки источника = 24 ч, {summary.days} сут.</dd></div>
      </dl>
      <div className="listing-growth-chart-tools">
        <label className="listing-check"><input type="checkbox" checked={weekly} onChange={e => setWeekly(e.target.checked)} data-field="history20Weekly" /> Недельные группы сценарных суток</label>
        <small>Таймфрейм графика не меняет прошедшее время сценария. Этот график — только дневные значения источника, без внутрисуточной модели.</small>
      </div>
      {provenance && <p className="listing-hint" data-history20-provenance><span data-provenance="observed">{provenance.observed}</span> <span data-provenance="modeled">{provenance.modeled}</span></p>}
      <ListingCandlePreview plan candles={historicalGrowthCandles(program, p0, listingAt ? Date.parse(listingAt) : Date.UTC(2026, 0, 1), weekly ? 7 : 1)} />
      <p className="listing-hint">Сжатие всего окна, например в 120 часов, — отдельный лабораторный режим. Он не активен и включается только по отдельному подтверждению владельца. Точные свечи с тиками — в «Предпросмотре» после сохранения черновика (до 30 дней за запрос).</p>
      <div className="listing-buttons">
        <button type="button" onClick={exportDraft} data-history20-export-draft>Экспорт черновика (JSON)</button>
        <button type="button" onClick={exportModel} data-history20-export-model>Экспорт модели по суткам (CSV)</button>
      </div>
    </div>}
    {!locked && <div className="listing-buttons"><button type="button" onClick={onReturn} data-history20-return>Вернуться к запрограммированным этапам</button></div>}
  </section>;
}
