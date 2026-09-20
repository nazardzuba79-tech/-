import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../lib/i18n';
import { useFuturesAccount } from '../lib/useFuturesAccount';
import { useFuturesExecution } from '../lib/futuresExecution';
import { futuresOrderErrorMessage } from '../lib/futuresOrderErrors';
import { closeConfirmedPositions, formatPositionQuantity, positionSelectionKey, type CloseCandidate } from '../lib/futuresPositionActions';

/** Uses the same engine-aware close command as each position's Market button. */
export function FuturesCloseAllPositions({ visible }: { visible: boolean }) {
  const { lang, t } = useLanguage();
  const ru = lang === 'ru';
  const account = useFuturesAccount({ positions: 4000 });
  const execution = useFuturesExecution();
  const [selection, setSelection] = useState<CloseCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ closed: number; errors: string[] } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const current = useRef({ account, execution });
  current.current = { account, execution };
  const available = execution.ready && !account.positions.failed && account.positions.data !== null;
  const changed = selection !== null && (!available || positionSelectionKey(selection) !== positionSelectionKey(account.positions.data ?? []));
  const title = ru ? 'Закрыть все' : 'Close all';

  useEffect(() => {
    if (selection) dialog.current?.showModal();
    else dialog.current?.close();
  }, [selection]);

  function review() {
    if (submitting.current || !available) return;
    setResult(null);
    setSelection((account.positions.data ?? []).map(({ id, symbol, side, size }) => ({ id, symbol, side, size })));
  }
  function dismiss() {
    if (!submitting.current) setSelection(null);
  }
  async function confirm() {
    const latest = current.current;
    if (submitting.current || !selection?.length || result || !latest.execution.ready || latest.account.positions.failed ||
      latest.account.positions.data === null || positionSelectionKey(selection) !== positionSelectionKey(latest.account.positions.data)) return;
    submitting.current = true;
    setBusy(true);
    try {
      const outcome = await closeConfirmedPositions(selection, id => latest.execution.closePosition(id), candidate => {
        const now = current.current;
        const match = now.account.positions.data?.find(p => p.id === candidate.id);
        return now.execution.engine === latest.execution.engine && now.execution.ready && !now.account.positions.failed &&
          !!match && positionSelectionKey([match]) === positionSelectionKey([candidate]);
      });
      setResult({ closed: outcome.closed.length, errors: outcome.failed.map(({ position, error }) =>
        `${position.symbol} ${position.side}: ${error instanceof Error && error.message === 'POSITION_CHANGED'
          ? (ru ? 'Позиция изменилась — проверьте её состояние.' : 'Position changed — check its current state.')
          : futuresOrderErrorMessage(error, t, t('futures.closePositionError'))}`) });
    } finally {
      latest.execution.refresh(['positions', 'positionHistory', 'balances']);
      submitting.current = false;
      setBusy(false);
    }
  }
  return <>
    <button type="button" className="archive-close-all" hidden={!visible} disabled={!available || !account.positions.data?.length || busy} onClick={review}>{title}</button>
    <dialog ref={dialog} className="archive-tool-dialog archive-close-all-dialog" aria-label={title}
      onCancel={e => { e.preventDefault(); dismiss(); }}>
      <header><strong>{title}</strong></header>
      <div className="archive-close-all-body" aria-busy={busy}>
        {result ? <div role="status">
          <p>{ru ? 'Закрыто позиций' : 'Positions closed'}: {result.closed} / {selection?.length}</p>
          {!!result.errors.length && <><p>{ru ? 'Не удалось закрыть все позиции. Проверьте обновлённый список перед повторной попыткой.' : 'Some positions could not be closed. Check the refreshed list before trying again.'}</p><ul>{result.errors.map((error, i) => <li key={i}>{error}</li>)}</ul></>}
        </div> : <>
          <p>{ru ? 'Закрыть все перечисленные позиции по рыночной цене на всех парах? Цена исполнения может отличаться от текущей. Открытые ордера останутся активными.' : 'Close every listed position at market across all pairs? Execution prices may differ from current prices. Open orders will remain active.'}</p>
          <ul className="archive-close-all-list">{selection?.map(p => <li key={p.id}><strong>{p.symbol} · {p.side}</strong><span>{formatPositionQuantity(p.size, p.symbol)} {p.symbol.split('/')[0]}</span></li>)}</ul>
          {changed && !busy && <p role="alert">{ru ? 'Список позиций изменился или недоступен. Обновите его перед подтверждением.' : 'Positions changed or are unavailable. Refresh the list before confirming.'}</p>}
        </>}
        <div className="archive-close-all-actions">
          <button type="button" disabled={busy} onClick={dismiss}>{result ? t('futures.close') : t('futures.cancel')}</button>
          {!result && (changed ? <button type="button" disabled={!available || busy} onClick={review}>{t('trade.retry')}</button> :
            <button type="button" className="archive-close-all-confirm" disabled={busy || !selection?.length} onClick={confirm}>{busy ? t('futures.closing') : (ru ? 'Подтвердить закрытие' : 'Confirm close')}</button>)}
        </div>
      </div>
    </dialog>
  </>;
}
