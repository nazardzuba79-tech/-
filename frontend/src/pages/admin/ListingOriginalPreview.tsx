import { useEffect, useState } from 'react';
import { ORIGINAL_MODEL_VERSION, ORIGINAL_REGIMES, type OriginalRegimeConfig } from '../../../../src/shared/originalSimulationRegimes';
import { ListingCandlePreview } from './ListingCandlePreview';
import { adminListingsApi, type OriginalPreview } from './adminListingsApi';

export function ListingOriginalPreview({ config, price, seed, draft, onSelect }: {
  config?: OriginalRegimeConfig;
  price: string;
  seed: string;
  draft: string | null;
  onSelect: (config?: OriginalRegimeConfig) => void;
}) {
  const [interval, setInterval] = useState('1h');
  const [result, setResult] = useState<OriginalPreview | null>(null);
  const [error, setError] = useState('');
  const id = config?.id;
  useEffect(() => {
    setResult(null);
    setError('');
    if (!id || id === 'AUTO') return;
    const controller = new AbortController();
    adminListingsApi.originalPreview(id, interval, price, seed, draft, controller.signal).then(response => {
      if (controller.signal.aborted) return;
      if (response.id !== id || response.version !== ORIGINAL_MODEL_VERSION || response.interval !== interval)
        throw Error('Сервер вернул другой сценарий');
      setResult(response);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [id, interval, price, seed, draft]);
  return <fieldset className="listing-growth-mode listing-regime" data-original-panel>
    <legend>Оригинальная модель VOLTEX · симуляция</legend>
    <label>Режим движения
      <select data-original-choice value={id ?? 'off'} disabled={Boolean(draft)} onChange={event => {
        const choice = event.target.value;
        onSelect(choice === 'off' ? undefined : { version: ORIGINAL_MODEL_VERSION,
          id: choice as OriginalRegimeConfig['id'], disclosure: 'SIMULATED_ORIGINAL_MODEL' });
      }}>
        <option value="off">Выбрать другой источник</option>
        <option value="AUTO">Автоматически · 20 режимов</option>
        {ORIGINAL_REGIMES.map(item => <option key={item.id} value={item.id}>{item.id} · {item.title}</option>)}
      </select>
    </label>
    {config && <>
      <p>Цена, свечи и объёмы моделируются. Исторические котировки не используются. Реальная торговля недоступна.</p>
      {id === 'AUTO' ? <small>Режим назначится при сохранении нового черновика. Для просмотра выберите конкретный режим.</small> : <>
        <label>Свечи <select data-original-interval value={interval} onChange={event => setInterval(event.target.value)}>
          {['1m', '5m', '15m', '1h', '4h', '1d'].map(value => <option key={value}>{value}</option>)}
        </select></label>
        <small>Предпросмотр использует {draft ? 'сохранённый' : 'указанный'} seed. При автоматическом seed окончательная траектория появится после сохранения.</small>
        {error && <p role="alert">{error}</p>}
        {result && result.id === id && result.interval === interval && <div data-original-result={id} data-interval={interval}>
          <ListingCandlePreview candles={result.candles} />
        </div>}
      </>}
    </>}
  </fieldset>;
}
