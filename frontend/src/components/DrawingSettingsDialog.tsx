import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DEFAULT_MEASURE_INFO, DRAWING_FONT_SIZES, DRAWING_INTERVAL_UNITS, DRAWING_PALETTE, DRAWING_TEXT_KINDS, DRAWING_WIDTHS,
  applyRulerPrices, drawingPriceInput, drawingStyle, livePoints, parseDrawingPrice,
  type DrawingDash, type DrawingIntervals, type DrawingPoint, type DrawingStyle, type MeasureInfo, type StoredDrawing,
} from '../lib/chartDrawings';
import { listDrawingTemplates, saveDrawingTemplate, type DrawingTemplate } from '../lib/drawingTemplates';
import { MEASURE_KINDS, defaultFillOpacity } from './DrawingObjectToolbar';

type Drawing = StoredDrawing & { id: number };
type Tab = 'style' | 'text' | 'coordinates' | 'visibility';

const ALL_INTERVALS: DrawingIntervals = { minutes: true, hours: true, days: true, weeks: true, months: true };

/** The kind's own name for the dialog title, as the rail calls it (PriceChart's tool list). */
const TITLE_KEY: Partial<Record<Drawing['kind'], string>> = {
  trendline: 'draw.trendline', rayline: 'draw.ray', extended: 'draw.extendedLine', ray: 'draw.hray',
  fib: 'draw.fibRetracement', ruler: 'draw.datepricerange',
};

/**
 * A drawing's settings, as TradingView's dialog: Style, Text, Coordinates
 * and Visibility, with Template, Cancel and Ok. Every change shows on the
 * chart at once; Cancel (or Esc) puts the drawing back exactly as it was.
 */
export function DrawingSettingsDialog({ drawing, locked, live, t, onPreview, onClose }: {
  drawing: Drawing;
  locked: boolean;
  /** The latest candle: a ruler's end can follow it. */
  live: DrawingPoint | null;
  t: (key: any) => string;
  onPreview: (next: Drawing) => void;
  onClose: () => void;
}) {
  const original = useRef(drawing);
  const [tab, setTab] = useState<Tab>('style');
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [text, setText] = useState(drawing.text ?? '');
  const dialog = useRef<HTMLDivElement>(null);
  const measure = MEASURE_KINDS.includes(drawing.kind);
  const textKind = DRAWING_TEXT_KINDS.includes(drawing.kind);
  const frozen = locked || !!drawing.locked;
  const style = drawingStyle(drawing);
  const info = style.info ?? DEFAULT_MEASURE_INFO;
  const canFill = style.fill !== undefined || measure;
  const tabs: Tab[] = ['style', ...(measure || textKind ? ['text' as const] : []), 'coordinates', 'visibility'];

  const update = (patch: Partial<Drawing>) => onPreview({ ...drawing, ...patch });
  const setStyle = (patch: Partial<DrawingStyle>) => update({ style: { ...style, ...patch } });
  const cancel = () => { onPreview(original.current); onClose(); };

  useEffect(() => {
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const title = t(TITLE_KEY[drawing.kind] ?? `draw.${drawing.kind}`);
  const body = <div className="drawing-settings-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
    <div ref={dialog} className="drawing-settings-dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} data-drawing-settings={drawing.kind}>
      <header><h2>{title}</h2><button type="button" className="drawing-settings-x" aria-label={t('draw.cancel')} onClick={cancel}>×</button></header>
      <nav className="drawing-settings-tabs" role="tablist">
        {tabs.map((name) => <button key={name} type="button" role="tab" aria-selected={tab === name} data-settings-tab={name} onClick={() => setTab(name)}>{t(`draw.tab.${name}`)}</button>)}
      </nav>
      <fieldset className="drawing-settings-body" disabled={frozen}>
        {tab === 'style' && <>
          <div className="drawing-settings-row">
            <span>{t('draw.line')}</span>
            <ColorField t={t} value={style.color} field="color" onChange={(color) => setStyle({ color })} />
            <select value={style.width} aria-label={t('draw.lineWidth')} data-field="width" onChange={(e) => setStyle({ width: Number(e.target.value) })}>
              {DRAWING_WIDTHS.map((w) => <option key={w} value={w}>{w}px</option>)}
            </select>
            {!measure && !textKind && <select value={style.dash} aria-label={t('draw.lineStyle')} data-field="dash" onChange={(e) => setStyle({ dash: e.target.value as DrawingDash })}>
              {(['solid', 'dashed', 'dotted'] as const).map((d) => <option key={d} value={d}>{t(`draw.dash.${d}`)}</option>)}
            </select>}
          </div>
          {canFill && <div className="drawing-settings-row">
            <label className="drawing-settings-check"><input type="checkbox" checked={!style.fillOff} data-field="fillOn" onChange={(e) => setStyle({ fillOff: e.target.checked ? undefined : true })} /><span>{t('draw.background')}</span></label>
            <ColorField t={t} value={style.fill ?? style.color} field="fill" onChange={(fill) => setStyle({ fill, fillOff: undefined })} />
            <label className="drawing-settings-range"><span>{t('draw.opacity')}</span>
              <input type="range" min={0} max={100} step={5} value={Math.round((style.fillOpacity ?? defaultFillOpacity(drawing.kind)) * 100)} data-field="fillOpacity"
                onChange={(e) => setStyle({ fillOpacity: Number(e.target.value) / 100, fillOff: undefined })} />
              <output>{Math.round((style.fillOpacity ?? defaultFillOpacity(drawing.kind)) * 100)}%</output>
            </label>
          </div>}
          {measure && <>
            <h3>{t('draw.info')}</h3>
            <div className="drawing-settings-grid" data-field="info">
              {infoKeys(drawing.kind).map((key) => <label key={key} className="drawing-settings-check"><input type="checkbox" name={`info-${key}`} checked={info[key]}
                  onChange={(e) => setStyle({ info: { ...info, [key]: e.target.checked } as MeasureInfo })} /><span>{t(`draw.info.${key}`)}</span></label>)}
            </div>
            <div className="drawing-settings-row">
              <span>{t('draw.label')}</span>
              <ColorField t={t} value={style.textColor ?? '#ffffff'} field="textColor" onChange={(textColor) => setStyle({ textColor })} />
              <select value={style.fontSize ?? (drawing.kind === 'ruler' ? 12 : 14)} aria-label={t('draw.fontSize')} data-field="fontSize" onChange={(e) => setStyle({ fontSize: Number(e.target.value) })}>
                {DRAWING_FONT_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </div>
            <div className="drawing-settings-row">
              <label className="drawing-settings-check"><input type="checkbox" checked={!style.labelBgOff} data-field="labelBgOn" onChange={(e) => setStyle({ labelBgOff: e.target.checked ? undefined : true })} /><span>{t('draw.labelBackground')}</span></label>
              <ColorField t={t} value={style.labelBg ?? style.color} field="labelBg" onChange={(labelBg) => setStyle({ labelBg, labelBgOff: undefined })} />
            </div>
          </>}
        </>}
        {tab === 'text' && <>
          <textarea value={text} maxLength={280} rows={4} placeholder={t('draw.textPlaceholder')} aria-label={t('draw.tab.text')} data-field="text"
            onChange={(e) => {
              setText(e.target.value);
              // A text drawing is its words: an emptied box keeps the last ones until new ones are typed.
              if (!textKind || e.target.value.trim()) update({ text: e.target.value.trim() ? e.target.value : undefined });
            }} />
          {measure && <div className="drawing-settings-row">
            <label className="drawing-settings-check"><input type="checkbox" checked={!!style.bold} data-field="bold" onChange={(e) => setStyle({ bold: e.target.checked || undefined })} /><span style={{ fontWeight: 700 }}>{t('draw.bold')}</span></label>
            <label className="drawing-settings-check"><input type="checkbox" checked={!!style.italic} data-field="italic" onChange={(e) => setStyle({ italic: e.target.checked || undefined })} /><span style={{ fontStyle: 'italic' }}>{t('draw.italic')}</span></label>
          </div>}
        </>}
        {tab === 'coordinates' && (drawing.kind === 'ruler'
          ? <RulerCoordinates drawing={drawing} live={live} t={t} onChange={onPreview} />
          : <PointCoordinates drawing={drawing} t={t} onChange={onPreview} />)}
        {tab === 'visibility' && <div className="drawing-settings-grid" data-field="intervals">
          {DRAWING_INTERVAL_UNITS.map((unit) => {
            const intervals = drawing.intervals ?? ALL_INTERVALS;
            return <label key={unit} className="drawing-settings-check"><input type="checkbox" name={`interval-${unit}`} checked={intervals[unit]}
              onChange={(e) => {
                const next = { ...intervals, [unit]: e.target.checked };
                update({ intervals: DRAWING_INTERVAL_UNITS.every((u) => next[u]) ? undefined : next });
              }} /><span>{t(`draw.vis.${unit}`)}</span></label>;
          })}
        </div>}
      </fieldset>
      <footer>
        <div className="drawing-settings-template">
          <button type="button" aria-haspopup="menu" aria-expanded={templatesOpen} data-object-action="dialog-templates" disabled={frozen} onClick={() => setTemplatesOpen((open) => !open)}>{t('draw.template')} ▾</button>
          {templatesOpen && <DialogTemplates t={t} drawing={drawing} style={style} onApply={(next) => { update({ style: next }); setTemplatesOpen(false); }} />}
        </div>
        <button type="button" data-settings-action="cancel" onClick={cancel}>{t('draw.cancel')}</button>
        <button type="button" className="primary" data-settings-action="ok" onClick={onClose}>{t('draw.ok')}</button>
      </footer>
    </div>
  </div>;
  return typeof document === 'undefined' ? body : createPortal(body, document.body);
}

/** The lines a measurement can report: a price range has no bars, a date range no price. */
function infoKeys(kind: Drawing['kind']): (keyof MeasureInfo)[] {
  const price: (keyof MeasureInfo)[] = ['price', 'percent', 'ticks'], date: (keyof MeasureInfo)[] = ['bars', 'time', 'volume'];
  return kind === 'pricerange' ? price : kind === 'daterange' ? date : [...price, ...date];
}

function ColorField({ t, value, field, onChange }: { t: (key: any) => string; value: string; field: string; onChange: (color: string) => void }) {
  const [open, setOpen] = useState(false);
  return <span className="drawing-settings-color">
    <button type="button" className="drawing-settings-swatch" style={{ background: value }} aria-label={`${t('draw.color')}: ${value}`} aria-expanded={open} data-field={field} onClick={() => setOpen((o) => !o)} />
    {open && <span className="drawing-settings-palette" role="menu">
      {DRAWING_PALETTE.map((c) => <button key={c} type="button" role="menuitemradio" aria-checked={value === c} aria-label={c} style={{ background: c }} onClick={() => { onChange(c); setOpen(false); }} />)}
      <label className="drawing-object-custom"><input type="color" value={value} aria-label={t('draw.customColor')} onChange={(e) => onChange(e.target.value)} /><span>{t('draw.customColor')}</span></label>
    </span>}
  </span>;
}

/** A ruler's exact prices (owner, 2026-10-04): the start, and an end price or the latest price, followed as it moves. */
function RulerCoordinates({ drawing, live, t, onChange }: { drawing: Drawing; live: DrawingPoint | null; t: (key: any) => string; onChange: (next: Drawing) => void }) {
  const shown = livePoints(drawing, live);
  const [from, setFrom] = useState(() => drawingPriceInput(shown[0].price));
  const [to, setTo] = useState(() => drawingPriceInput(shown[1].price));
  const apply = (next: { from: string; to: string; followLast: boolean }) => {
    const start = parseDrawingPrice(next.from);
    const end = next.followLast ? (live?.price ?? shown[1].price) : parseDrawingPrice(next.to);
    if (start === null || end === null) return;
    onChange({ ...applyRulerPrices(drawing, { from: start, to: end, followLast: next.followLast }, live), id: drawing.id });
  };
  const followLast = !!drawing.followLast;
  return <div className="drawing-settings-coordinates" data-object-menu="measure">
    <PointRow t={t} n={1} time={shown[0].time}>
      <input name="from" inputMode="decimal" autoComplete="off" value={from} aria-label={`${t('draw.point')} 1 · ${t('draw.price')}`} aria-invalid={parseDrawingPrice(from) === null}
        onChange={(e) => { setFrom(e.target.value); apply({ from: e.target.value, to, followLast }); }} />
    </PointRow>
    <PointRow t={t} n={2} time={shown[1].time}>
      <input name="to" inputMode="decimal" autoComplete="off" value={followLast && live ? drawingPriceInput(live.price) : to} disabled={followLast}
        aria-label={`${t('draw.point')} 2 · ${t('draw.price')}`} aria-invalid={!followLast && parseDrawingPrice(to) === null}
        onChange={(e) => { setTo(e.target.value); apply({ from, to: e.target.value, followLast }); }} />
    </PointRow>
    <label className="drawing-settings-check">
      <input type="checkbox" name="followLast" checked={followLast} disabled={!live && !followLast}
        onChange={(e) => apply({ from, to, followLast: e.target.checked })} />
      <span>{t('draw.toCurrentPrice')}</span>
    </label>
    {(parseDrawingPrice(from) === null || (!followLast && parseDrawingPrice(to) === null)) && <p className="drawing-measure-error" role="alert">{t('draw.priceInvalid')}</p>}
  </div>;
}

/** Every other drawing: each anchor's price; its time is where it was placed. */
function PointCoordinates({ drawing, t, onChange }: { drawing: Drawing; t: (key: any) => string; onChange: (next: Drawing) => void }) {
  const [texts, setTexts] = useState(() => drawing.points.map((p) => drawingPriceInput(p.price)));
  const shown = drawing.points.slice(0, 8);
  return <div className="drawing-settings-coordinates">
    {shown.map((point, i) => <PointRow key={i} t={t} n={i + 1} time={drawing.kind === 'horizontal' ? null : point.time}>
      <input name={`price-${i}`} inputMode="decimal" autoComplete="off" value={texts[i]} disabled={drawing.kind === 'vertical'}
        aria-label={`${t('draw.point')} ${i + 1} · ${t('draw.price')}`} aria-invalid={parseDrawingPrice(texts[i]) === null}
        onChange={(e) => {
          const next = texts.slice(); next[i] = e.target.value; setTexts(next);
          const price = parseDrawingPrice(e.target.value);
          if (price !== null) onChange({ ...drawing, points: drawing.points.map((p, j) => (j === i ? { ...p, price } : p)) });
        }} />
    </PointRow>)}
    {drawing.points.length > shown.length && <p className="drawing-settings-note">{t('draw.morePoints')}</p>}
  </div>;
}

function PointRow({ t, n, time, children }: { t: (key: any) => string; n: number; time: number | null; children: React.ReactNode }) {
  const when = time !== null && Number.isFinite(time) && time > 0
    ? new Date(time * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : null;
  return <div className="drawing-settings-point">
    <span className="drawing-settings-point-name">{t('draw.point')} {n}</span>
    <label><span>{t('draw.price')}</span>{children}</label>
    {when && <span className="drawing-settings-when">{when}</span>}
  </div>;
}

function DialogTemplates({ t, drawing, style, onApply }: { t: (key: any) => string; drawing: Drawing; style: DrawingStyle; onApply: (style: DrawingStyle | undefined) => void }) {
  const [templates, setTemplates] = useState<DrawingTemplate[]>(() => listDrawingTemplates(drawing.kind));
  const [name, setName] = useState('');
  return <div className="drawing-object-menu drawing-settings-template-menu" role="menu" data-object-menu="dialog-templates">
    <form className="drawing-template-form" onSubmit={(e) => { e.preventDefault(); const next = saveDrawingTemplate(drawing.kind, name, style); if (next) { setTemplates(next); setName(''); } }}>
      <input value={name} maxLength={40} placeholder={t('draw.templateName')} aria-label={t('draw.templateName')} onChange={(e) => setName(e.target.value)} />
      <button type="submit" disabled={!name.trim()}>{t('draw.save')}</button>
    </form>
    <button type="button" role="menuitem" className="drawing-object-menu-row" onClick={() => onApply(undefined)}><span>{t('draw.templateDefault')}</span></button>
    {templates.map((template) => <button key={template.name} type="button" role="menuitem" className="drawing-object-menu-row" onClick={() => onApply(template.style)}>
      <i className="drawing-template-swatch" style={{ background: template.style.color }} /><span>{template.name}</span>
    </button>)}
  </div>;
}
