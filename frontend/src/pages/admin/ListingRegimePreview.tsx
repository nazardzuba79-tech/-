import { useEffect, useState } from 'react';
import { ListingCandlePreview } from './ListingCandlePreview';
import { adminListingsApi, type RegimeOption, type RegimePreview } from './adminListingsApi';

const intervals = ['1m', '5m', '15m', '1h', '4h', '1d'];

export function ListingRegimePreview({
  options,
  id,
  price,
  draft,
  onSelect,
}: {
  options: RegimeOption[];
  id?: string;
  price: string;
  draft: string | null;
  onSelect: (id: string) => void;
}) {
  const [interval, setInterval] = useState('1h');
  const [phase, setPhase] = useState('middle');
  const [result, setResult] = useState<RegimePreview | null>(null);
  const [error, setError] = useState('');
  const item = options.find((r) => r.id === id);
  useEffect(() => {
    setResult(null);
    setError('');
    if (!item) return;
    const controller = new AbortController();
    adminListingsApi
      .regimePreview(item.id, interval, phase, price, draft, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        if (
          response.sha256 !== item.sha256 ||
          response.id !== item.id ||
          response.phase !== phase ||
          response.interval !== interval
        )
          throw Error('Сервер вернул другой сценарий');
        setResult(response);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [item?.id, item?.sha256, interval, phase, price, draft]);
  return (
    <fieldset className="listing-growth-mode listing-regime" data-regime-panel>
      <legend>Исторические режимы OHLCV</legend>
      <label>
        Движение цены
        <select
          value={id ?? 'legacy'}
          disabled={Boolean(draft)}
          onChange={(e) => onSelect(e.target.value)}
          data-regime-choice
        >
          <option value="AUTO">Автоматически · ротация 20 режимов</option>
          {options.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id} · {r.title} · {r.pair}
            </option>
          ))}
          <option value="legacy">Программируемые этапы</option>
        </select>
      </label>
      {id === 'AUTO' && (
        <small>
          Режим назначится при сохранении нового черновика. Для просмотра до сохранения выберите конкретный
          режим.
        </small>
      )}
      {item && (
        <>
          <p>
            {item.pair} · Binance Vision Spot · {item.start} — {item.endExclusive} (не включительно), UTC
          </p>
          <small>
            Наблюдения за 1 минуту, контрольный интервал {item.sourceFrame}. Цены и объём нормализованы.
            Внутри незакрытой минуты путь моделируется. Только приватный предпросмотр.
          </small>
          <div className="listing-grid">
            <label>
              Свечи
              <select data-regime-interval value={interval} onChange={(e) => setInterval(e.target.value)}>
                {intervals.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              Часть периода
              <select data-regime-phase value={phase} onChange={(e) => setPhase(e.target.value)}>
                <option value="start">Начало</option>
                <option value="middle">Середина</option>
                <option value="end">Конец</option>
              </select>
            </label>
          </div>
          {error && <p role="alert">{error}</p>}
          {result && result.id === id && result.phase === phase && result.interval === interval && (
            <div data-regime-result={id} data-interval={interval} data-phase={phase}>
              <ListingCandlePreview candles={result.candles} />
            </div>
          )}
        </>
      )}
    </fieldset>
  );
}
