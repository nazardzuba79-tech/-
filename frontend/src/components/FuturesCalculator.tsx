import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { nativeDemoApi, type NativeQuoteInput, type NativeQuoteResult } from '../lib/nativeDemoApi';
import { useLanguage } from '../lib/i18n';
import { futuresOrderErrorMessage } from '../lib/futuresOrderErrors';
import './FuturesCalculator.css';

/**
 * THE FUTURES CALCULATOR — A PLACE TO ASK, NOT A PLACE TO TRADE.
 *
 * Every number on every tab is computed by the engine, not here. The one
 * network call this component makes is `nativeDemoApi.quote`, which routes to
 * the same `quoteOrderCost` / `calculatePosition` / `liquidationPrice` /
 * `targetExitPrice` / `closePositionAllocation` the server uses to admit and
 * settle a real order. There is deliberately no arithmetic in this file: a
 * second implementation is a second set of answers, and the moment the fee
 * model or the risk ladder moves, a mirrored formula keeps quoting the old
 * one while the server rejects what it quoted.
 *
 * READ-ONLY, and visibly so. The component never calls `command`, so it
 * cannot open, close, or modify anything. `onUseValues` hands the numbers to
 * the order form as an UNSENT draft — the trader still has to press the
 * order button themselves.
 *
 * `null` from the server means the engine has no answer — an unreachable
 * liquidation boundary, a target that would need a price at or below zero.
 * It renders as a dash. It is never rendered as a zero.
 */

type Tab = 'pnl' | 'target' | 'liquidation' | 'position';
type Side = 'LONG' | 'SHORT';

export interface CalculatorDraft {
  side: Side;
  price: string;
  quantity: string;
  leverage: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  symbol: string;
  /** Seed values from the live terminal, so the calculator opens on the real market. */
  initial?: Partial<CalculatorDraft> & { markPrice?: string | null };
  /** Fills the order form's UNSENT draft. Never submits. Omit to hide the button. */
  onUseValues?: (draft: CalculatorDraft) => void;
}

/** A figure the engine had no answer for is a dash, never a zero. */
const DASH = '—';

function money(value: string | null | undefined, digits = 2): string {
  if (value === null || value === undefined || value === '') return DASH;
  const n = Number(value);
  if (!Number.isFinite(n)) return DASH;
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function percent(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return DASH;
  const n = Number(value);
  if (!Number.isFinite(n)) return DASH;
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function signClass(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '';
  return n > 0 ? 'fc-up' : 'fc-down';
}

/** A row of the results column. */
function Row({ label, value, tone, strong }: { label: string; value: string; tone?: string; strong?: boolean }) {
  return (
    <div className={`fc-row${strong ? ' fc-rowStrong' : ''}`}>
      <span className="fc-rowLabel">{label}</span>
      <span className={`fc-rowValue mono ${tone ?? ''}`}>{value}</span>
    </div>
  );
}

function Field({ id, label, value, onChange, suffix, hint, inputMode = 'decimal' }: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  suffix?: string; hint?: string; inputMode?: 'decimal' | 'numeric';
}) {
  return (
    <label className="fc-field" htmlFor={id}>
      <span className="fc-fieldHead">
        <span className="fc-fieldLabel">{label}</span>
        {hint ? <span className="fc-fieldHint mono">{hint}</span> : null}
      </span>
      <span className="fc-inputWrap">
        <input
          id={id}
          className="fc-input mono"
          value={value}
          inputMode={inputMode}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
        {suffix ? <span className="fc-suffix mono">{suffix}</span> : null}
      </span>
    </label>
  );
}

/** A decimal the engine will accept: digits with at most one point, no sign. */
const clean = (raw: string): string => {
  const kept = raw.replace(/[^\d.]/g, '');
  const [head, ...rest] = kept.split('.');
  return rest.length ? `${head}.${rest.join('')}` : head;
};
/** Same, but a leading minus survives — target PnL may be negative. */
const cleanSigned = (raw: string): string => {
  const negative = raw.trim().startsWith('-');
  return (negative ? '-' : '') + clean(raw);
};
const usable = (value: string): boolean => value !== '' && value !== '.' && Number(value) > 0;

export function FuturesCalculator({ open, onClose, symbol, initial, onUseValues }: Props) {
  const { t } = useLanguage();
  const uid = useId();
  const [tab, setTab] = useState<Tab>('pnl');
  const [side, setSide] = useState<Side>(initial?.side ?? 'LONG');
  const [leverage, setLeverage] = useState(initial?.leverage ?? '10');
  const [quantity, setQuantity] = useState(initial?.quantity ?? '');
  const [entry, setEntry] = useState(initial?.price ?? '');
  const [exit, setExit] = useState('');
  const [maker, setMaker] = useState(false);
  const [targetBasis, setTargetBasis] = useState<'GROSS' | 'NET'>('GROSS');
  const [targetMode, setTargetMode] = useState<'PNL' | 'ROI'>('ROI');
  const [targetPnl, setTargetPnl] = useState('');
  const [targetRoi, setTargetRoi] = useState('100');
  const [allocated, setAllocated] = useState('');
  const [fundingRate, setFundingRate] = useState('');
  const [fundingIntervals, setFundingIntervals] = useState('3');

  const [result, setResult] = useState<NativeQuoteResult | null>(null);
  const [funding, setFunding] = useState<NativeQuoteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Seed from the live terminal each time the panel is opened, so it starts
  // on the real market rather than on whatever was typed last session.
  useEffect(() => {
    if (!open) return;
    if (initial?.price && entry === '') setEntry(initial.price);
    if (initial?.price && exit === '') setExit(initial.price);
    if (initial?.side) setSide(initial.side);
    if (initial?.leverage) setLeverage(initial.leverage);
    // Only on open: re-seeding on every render would fight the trader's typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  /** The request this tab's answer depends on — or null when the inputs cannot form one. */
  const request = useMemo((): NativeQuoteInput | null => {
    if (!usable(leverage)) return null;
    if (tab === 'pnl') {
      if (!usable(quantity) || !usable(entry) || !usable(exit)) return null;
      return { kind: 'PNL', symbol, side, quantity, entryPrice: entry, exitPrice: exit, leverage, maker };
    }
    if (tab === 'target') {
      if (!usable(quantity) || !usable(entry)) return null;
      const aim = targetMode === 'PNL'
        ? (targetPnl === '' || targetPnl === '-' ? null : { targetPnl })
        : (targetRoi === '' || targetRoi === '-' ? null : { targetRoiPercent: targetRoi });
      if (!aim) return null;
      return { kind: 'TARGET', symbol, side, quantity, entryPrice: entry, leverage, basis: targetBasis, maker, ...aim };
    }
    if (tab === 'liquidation') {
      if (!usable(quantity) || !usable(entry)) return null;
      return {
        kind: 'POSITION', symbol, side, quantity, entryPrice: entry,
        markPrice: usable(exit) ? exit : entry, leverage,
        ...(usable(allocated) ? { allocatedMargin: allocated } : {}),
      };
    }
    if (!usable(quantity) || !usable(entry)) return null;
    return { kind: 'ORDER', symbol, side, quantity, price: entry, leverage, maker };
  }, [tab, symbol, side, quantity, entry, exit, leverage, maker, targetBasis, targetMode, targetPnl, targetRoi, allocated]);

  const fundingRequest = useMemo((): NativeQuoteInput | null => {
    if (tab !== 'pnl') return null;
    if (!usable(quantity) || !usable(exit) || fundingRate === '' || fundingRate === '-') return null;
    const intervals = Number(fundingIntervals);
    if (!Number.isInteger(intervals) || intervals < 1) return null;
    return { kind: 'FUNDING', symbol, side, quantity, markPrice: exit, rate: fundingRate, intervals };
  }, [tab, symbol, side, quantity, exit, fundingRate, fundingIntervals]);

  const ask = useCallback((input: NativeQuoteInput | null, apply: (r: NativeQuoteResult | null) => void, controller: AbortController) => {
    if (!input) { apply(null); return Promise.resolve(); }
    return nativeDemoApi.quote(input, controller.signal)
      .then((r) => { apply(r); setError(null); })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        apply(null);
        // The server's own sentence never reaches this panel. `body.code` is
        // a closed vocabulary — INVALID_QUANTITY, TIER_LEVERAGE_EXCEEDED,
        // MIN_NOTIONAL — and `futuresOrderErrorMessage` is the one module
        // allowed to turn it into words, the same module the order ticket
        // uses. A quote refused for a reason the ticket would refuse it for
        // should say the same thing in both places.
        setError(futuresOrderErrorMessage(e, t, t('calc.unavailable')));
      });
  }, [t]);

  // One debounced round trip per settled edit. Every superseded request is
  // aborted, so a slow answer can never overwrite a newer one.
  useEffect(() => {
    if (!open) return;
    if (!request) { setResult(null); setError(null); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setPending(true);
      void Promise.all([
        ask(request, setResult, controller),
        ask(fundingRequest, setFunding, controller),
      ]).finally(() => { if (!controller.signal.aborted) setPending(false); });
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, request, fundingRequest, ask]);

  if (!open) return null;

  const pnl = result?.kind === 'PNL' ? result : null;
  const target = result?.kind === 'TARGET' ? result : null;
  const position = result?.kind === 'POSITION' ? result : null;
  const order = result?.kind === 'ORDER' ? result : null;
  const fundingTotal = funding?.kind === 'FUNDING' ? funding.total : null;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'pnl', label: t('calc.tab.pnl') },
    { id: 'target', label: t('calc.tab.target') },
    { id: 'liquidation', label: t('calc.tab.liquidation') },
    { id: 'position', label: t('calc.tab.position') },
  ];

  const canUse = Boolean(onUseValues) && usable(entry) && usable(quantity) && usable(leverage);

  return (
    <div className="fc-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="fc-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('calc.title')}
        data-futures-calculator="true"
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className="fc-head">
          <div className="fc-headText">
            <h2 className="fc-title">{t('calc.title')}</h2>
            <p className="fc-sub mono">{symbol}</p>
          </div>
          <span className="fc-readonly" data-calculator-readonly="true">{t('calc.readOnly')}</span>
          <button type="button" className="fc-close" onClick={onClose} aria-label={t('calc.close')}>×</button>
        </header>

        <div className="fc-tabs" role="tablist" aria-label={t('calc.title')}>
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`${uid}-tab-${item.id}`}
              aria-selected={tab === item.id}
              aria-controls={`${uid}-panel`}
              className={`fc-tab${tab === item.id ? ' fc-tabActive' : ''}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="fc-body" id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${tab}`}>
          <div className="fc-inputs">
            <div className="fc-sideRow" role="group" aria-label={t('calc.side')}>
              {(['LONG', 'SHORT'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`fc-sideBtn${side === value ? ` fc-sideActive fc-side${value}` : ''}`}
                  aria-pressed={side === value}
                  onClick={() => setSide(value)}
                >
                  {value === 'LONG' ? t('calc.long') : t('calc.short')}
                </button>
              ))}
            </div>

            <Field id={`${uid}-entry`} label={t('futures.entryPrice')} value={entry}
              onChange={(v) => setEntry(clean(v))} suffix="USDT"
              hint={initial?.markPrice ? `${t('calc.mark')} ${money(initial.markPrice)}` : undefined} />

            {(tab === 'pnl' || tab === 'liquidation') && (
              <Field id={`${uid}-exit`} label={tab === 'pnl' ? t('calc.exitPrice') : t('calc.markPrice')}
                value={exit} onChange={(v) => setExit(clean(v))} suffix="USDT" />
            )}

            <Field id={`${uid}-qty`} label={t('calc.quantity')} value={quantity}
              onChange={(v) => setQuantity(clean(v))} suffix={symbol.replace(/\/?USDT$/, '')} />

            <Field id={`${uid}-lev`} label={t('futures.leverage')} value={leverage}
              onChange={(v) => setLeverage(clean(v))} suffix="x" />

            {tab === 'liquidation' && (
              <Field id={`${uid}-alloc`} label={t('calc.allocatedMargin')} value={allocated}
                onChange={(v) => setAllocated(clean(v))} suffix="USDT" hint={t('calc.allocatedHint')} />
            )}

            {tab === 'target' && (
              <>
                <div className="fc-segment" role="group" aria-label={t('calc.targetBasis')}>
                  <span className="fc-segmentLabel">{t('calc.targetBasis')}</span>
                  <div className="fc-segmentBtns">
                    {(['GROSS', 'NET'] as const).map((value) => (
                      <button key={value} type="button" aria-pressed={targetBasis === value}
                        className={`fc-chip${targetBasis === value ? ' fc-chipActive' : ''}`}
                        onClick={() => setTargetBasis(value)}>
                        {value === 'GROSS' ? t('calc.gross') : t('calc.net')}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="fc-segment" role="group" aria-label={t('calc.targetAim')}>
                  <span className="fc-segmentLabel">{t('calc.targetAim')}</span>
                  <div className="fc-segmentBtns">
                    {(['ROI', 'PNL'] as const).map((value) => (
                      <button key={value} type="button" aria-pressed={targetMode === value}
                        className={`fc-chip${targetMode === value ? ' fc-chipActive' : ''}`}
                        onClick={() => setTargetMode(value)}>
                        {value === 'ROI' ? t('calc.roi') : t('calc.pnl')}
                      </button>
                    ))}
                  </div>
                </div>
                {targetMode === 'ROI'
                  ? <Field id={`${uid}-roi`} label={t('calc.desiredRoi')} value={targetRoi}
                      onChange={(v) => setTargetRoi(cleanSigned(v))} suffix="%" />
                  : <Field id={`${uid}-tpnl`} label={t('calc.desiredPnl')} value={targetPnl}
                      onChange={(v) => setTargetPnl(cleanSigned(v))} suffix="USDT" />}
              </>
            )}

            {(tab === 'pnl' || tab === 'target' || tab === 'position') && (
              <div className="fc-segment" role="group" aria-label={t('calc.feeSide')}>
                <span className="fc-segmentLabel">{t('calc.feeSide')}</span>
                <div className="fc-segmentBtns">
                  {[false, true].map((value) => (
                    <button key={String(value)} type="button" aria-pressed={maker === value}
                      className={`fc-chip${maker === value ? ' fc-chipActive' : ''}`}
                      onClick={() => setMaker(value)}>
                      {value ? t('calc.maker') : t('calc.taker')}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {tab === 'pnl' && (
              <details className="fc-funding">
                <summary className="fc-fundingSummary">{t('calc.fundingSection')}</summary>
                <div className="fc-fundingBody">
                  <Field id={`${uid}-frate`} label={t('futures.fundingRate')} value={fundingRate}
                    onChange={(v) => setFundingRate(cleanSigned(v))} hint={t('calc.fundingRateHint')} />
                  <Field id={`${uid}-fint`} label={t('calc.fundingIntervals')} value={fundingIntervals}
                    onChange={(v) => setFundingIntervals(v.replace(/[^\d]/g, ''))} inputMode="numeric" />
                  <p className="fc-note">{t('calc.fundingNote')}</p>
                </div>
              </details>
            )}
          </div>

          <div className="fc-results" aria-live="polite" aria-busy={pending}>
            {error ? <p className="fc-error">{error}</p> : null}

            {tab === 'pnl' && (
              <>
                <div className="fc-headline">
                  <span className="fc-headlineLabel">{t('calc.netPnl')}</span>
                  <strong className={`fc-headlineValue mono ${signClass(pnl?.netPnl)}`}>
                    {pnl ? money(pnl.netPnl) : DASH} <span className="fc-unit">USDT</span>
                  </strong>
                  <span className={`fc-headlineRoi mono ${signClass(pnl?.roiPercentNet)}`}>
                    {pnl ? percent(pnl.roiPercentNet) : DASH} {t('calc.roi')}
                  </span>
                </div>
                <Row label={t('calc.notional')} value={pnl ? `${money(pnl.entryNotional)} USDT` : DASH} />
                <Row label={t('calc.initialMargin')} value={pnl ? `${money(pnl.baseInitialMargin)} USDT` : DASH} />
                <Row label={t('calc.positionMargin')} value={pnl ? `${money(pnl.positionMargin)} USDT` : DASH} />
                <Row label={t('calc.openingFee')} value={pnl ? `${money(pnl.openingFee, 4)} USDT` : DASH} />
                <Row label={t('calc.closingFee')} value={pnl ? `${money(pnl.closingFee, 4)} USDT` : DASH} />
                <Row label={t('calc.grossPnl')} value={pnl ? `${money(pnl.grossPnl)} USDT` : DASH}
                  tone={signClass(pnl?.grossPnl)} />
                <Row label={t('calc.netPnl')} value={pnl ? `${money(pnl.netPnl)} USDT` : DASH}
                  tone={signClass(pnl?.netPnl)} strong />
                {fundingTotal !== null && (
                  <Row label={t('calc.fundingEstimate')} value={`${money(fundingTotal, 4)} USDT`}
                    tone={signClass(fundingTotal)} />
                )}
                <p className="fc-explain">{t('calc.netExplain')}</p>
              </>
            )}

            {tab === 'target' && (
              <>
                <div className="fc-headline">
                  <span className="fc-headlineLabel">{t('calc.targetExit')}</span>
                  <strong className="fc-headlineValue mono">
                    {target?.exitPrice ? money(target.exitPrice) : DASH} <span className="fc-unit">USDT</span>
                  </strong>
                  {target && target.exitPrice === null
                    ? <span className="fc-headlineRoi fc-muted">{t('calc.noTarget')}</span>
                    : null}
                </div>
                <Row label={t('calc.targetPnl')} value={target ? `${money(target.targetPnl)} USDT` : DASH}
                  tone={signClass(target?.targetPnl)} />
                <Row label={t('calc.roiBasis')} value={target ? `${money(target.roiMarginBasis)} USDT` : DASH} />
                {targetBasis === 'NET' && (
                  <Row label={t('calc.openingFee')} value={target ? `${money(target.openingFee, 4)} USDT` : DASH} />
                )}
                <p className="fc-explain">
                  {targetBasis === 'NET' ? t('calc.targetNetExplain') : t('calc.targetGrossExplain')}
                </p>
              </>
            )}

            {tab === 'liquidation' && (
              <>
                <div className="fc-headline">
                  <span className="fc-headlineLabel">{t('calc.liqPrice')}</span>
                  <strong className="fc-headlineValue mono">
                    {position?.liquidationPrice ? money(position.liquidationPrice) : DASH}
                    {position?.liquidationPrice ? <span className="fc-unit"> USDT</span> : null}
                  </strong>
                  {position && position.liquidationPrice === null
                    ? <span className="fc-headlineRoi fc-muted">{t('calc.noLiquidation')}</span>
                    : null}
                </div>
                <Row label={t('calc.positionMargin')} value={position ? `${money(position.allocatedMargin)} USDT` : DASH} />
                <Row label={t('calc.maintenance')} value={position ? `${money(position.maintenanceMargin)} USDT` : DASH} />
                <Row label={t('calc.feeReserve')} value={position ? `${money(position.closeFeeReserve, 4)} USDT` : DASH} />
                <Row label={t('calc.equity')} value={position ? `${money(position.equity)} USDT` : DASH} />
                <Row label={t('calc.unrealized')} value={position ? `${money(position.unrealizedPnl)} USDT` : DASH}
                  tone={signClass(position?.unrealizedPnl)} />
                <p className="fc-explain">{t('calc.liqExplain')}</p>
              </>
            )}

            {tab === 'position' && (
              <>
                <div className="fc-headline">
                  <span className="fc-headlineLabel">{t('calc.totalCost')}</span>
                  <strong className="fc-headlineValue mono">
                    {order?.totalCost ? money(order.totalCost) : DASH} <span className="fc-unit">USDT</span>
                  </strong>
                </div>
                <Row label={t('calc.notional')} value={order?.entryNotional ? `${money(order.entryNotional)} USDT` : DASH} />
                <Row label={t('calc.initialMargin')} value={order?.baseInitialMargin ? `${money(order.baseInitialMargin)} USDT` : DASH} />
                <Row label={t('calc.feeReserve')} value={order?.closeFeeReserve ? `${money(order.closeFeeReserve, 4)} USDT` : DASH} />
                <Row label={t('calc.positionMargin')} value={order?.positionMargin ? `${money(order.positionMargin)} USDT` : DASH} />
                <Row label={t('calc.openingFee')} value={order?.openingFee ? `${money(order.openingFee, 4)} USDT` : DASH} />
                <Row label={t('calc.totalCost')} value={order?.totalCost ? `${money(order.totalCost)} USDT` : DASH} strong />
                {order?.violation ? (
                  <p className="fc-warn" role="status">
                    {t('calc.ruleWarning')}
                    {order.violation.limit
                      ? <span className="mono"> · {order.violation.limit}: {order.violation.allowed} · {order.violation.actual}</span>
                      : null}
                  </p>
                ) : null}
                {order ? (
                  <p className="fc-explain mono fc-rules">
                    {t('calc.step')} {order.rules.qtyStep} · {t('calc.minQty')} {order.rules.minOrderQty} · {t('calc.maxQty')} {order.rules.maxOrderQty}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>

        <footer className="fc-foot">
          <p className="fc-footNote">{t('calc.footNote')}</p>
          {onUseValues ? (
            <button
              type="button"
              className="fc-use"
              data-calculator-use-values="true"
              disabled={!canUse}
              onClick={() => onUseValues({ side, price: entry, quantity, leverage })}
            >
              {t('calc.useValues')}
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
