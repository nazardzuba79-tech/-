import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import {
  DRAWING_PALETTE, DRAWING_TEXT_KINDS, DRAWING_WIDTHS, drawingStyle, type DrawingDash, type DrawingKind, type DrawingStyle, type StoredDrawing,
} from '../lib/chartDrawings';
import { listDrawingTemplates, removeDrawingTemplate, saveDrawingTemplate, type DrawingTemplate } from '../lib/drawingTemplates';

/** Measurements: a label with its own text colour, background and «Информация» lines. */
export const MEASURE_KINDS: readonly DrawingKind[] = ['ruler', 'pricerange', 'daterange'];
const DASHES: DrawingDash[] = ['solid', 'dashed', 'dotted'];
export const TOOLBAR_HEIGHT = 40;
/** The background opacity a kind is painted with until the trader sets one (drawingGeometry). */
export const defaultFillOpacity = (kind: DrawingKind) => (kind === 'ruler' ? 0.12 : 0.2);

type Drawing = StoredDrawing & { id: number };
type Menu = null | 'templates' | 'color' | 'fill' | 'text' | 'width' | 'dash' | 'more';

/** Layout effects measure the chart; a server render (the tests' static markup) has none to measure. */
const useMeasureEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Where the trader last dragged the toolbar to: TradingView keeps it there for every later selection. */
const POSITION_KEY = 'voltex.drawing-toolbar.position';
function rememberedPosition(): { left: number; top: number } | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(POSITION_KEY) ?? 'null') as { left?: unknown; top?: unknown } | null;
    return value && typeof value.left === 'number' && typeof value.top === 'number' && Number.isFinite(value.left) && Number.isFinite(value.top)
      ? { left: value.left, top: value.top } : null;
  } catch { return null; }
}
function rememberPosition(position: { left: number; top: number }) {
  try { window.localStorage.setItem(POSITION_KEY, JSON.stringify(position)); } catch { /* private mode: this session only */ }
}

export interface DrawingObjectToolbarProps {
  drawing: Drawing;
  /** Every drawing on the chart is locked (the rail's lock). */
  locked: boolean;
  t: (key: any) => string;
  onStyle: (style: DrawingStyle | undefined) => void;
  onToggleLock: () => void;
  onClone: () => void;
  onDelete: () => void;
  onEditText?: () => void;
  onSettings?: () => void;
  onOrder?: (to: 'front' | 'back') => void;
  onClose: () => void;
  /** Where it goes when the trader has not moved it: clear of the label and the handles. */
  placement?: { left: number; top: number };
  /** @deprecated vertical-only placement of the previous toolbar; kept for callers that still pass it. */
  top?: number;
}

/**
 * The floating toolbar over a selected drawing, button for button as
 * TradingView's: a grip that moves it, templates, the line colour, the
 * background and the text colour (each with a bar in its colour), the
 * width, settings, lock, delete and «…». Clicking bare chart or Esc closes
 * it; Delete removes the drawing.
 */
export function DrawingObjectToolbar({ drawing, locked, t, onStyle, onToggleLock, onClone, onDelete, onEditText, onSettings, onOrder, onClose, placement, top }: DrawingObjectToolbarProps) {
  const [menu, setMenu] = useState<Menu>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [moved, setMoved] = useState<{ left: number; top: number } | null>(() => rememberedPosition());
  const [bounds, setBounds] = useState<{ width: number; height: number; w: number } | null>(null);
  const style = drawingStyle(drawing);
  const measure = MEASURE_KINDS.includes(drawing.kind);
  const canFill = style.fill !== undefined || measure;
  const canDash = !measure && !DRAWING_TEXT_KINDS.includes(drawing.kind);
  const frozen = locked || !!drawing.locked;

  // Kept inside its chart, wherever it was dragged to on a wider one.
  useMeasureEffect(() => {
    const node = ref.current, parent = node?.offsetParent as HTMLElement | null;
    if (node && parent) setBounds({ width: parent.clientWidth, height: parent.clientHeight, w: node.offsetWidth });
  }, [drawing.id]);
  const clamp = (p: { left: number; top: number }) => !bounds ? p : {
    left: Math.max(4, Math.min(p.left, bounds.width - bounds.w - 4)),
    top: Math.max(4, Math.min(p.top, bounds.height - TOOLBAR_HEIGHT - 4)),
  };
  const position = moved ? clamp(moved) : placement ? clamp(placement) : null;

  const startDrag = (event: React.PointerEvent) => {
    if (event.button !== 0 || !ref.current) return;
    event.preventDefault();
    const node = ref.current;
    const origin = { x: event.clientX, y: event.clientY, left: node.offsetLeft, top: node.offsetTop };
    let last = { left: origin.left, top: origin.top };
    const move = (ev: PointerEvent) => { last = clamp({ left: origin.left + ev.clientX - origin.x, top: origin.top + ev.clientY - origin.y }); setMoved(last); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); rememberPosition(last); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // A menu opens below the toolbar while the chart has room for it there,
  // otherwise above it (a phone, where a bottom bar covers the screen's foot),
  // and scrolls only when neither side fits it whole. It is fixed to the
  // screen, so the chart's edge never cuts it off.
  useMeasureEffect(() => {
    const node = ref.current, list = node?.querySelector<HTMLElement>(':scope > .drawing-object-menu');
    if (!menu || !node || !list) return;
    const bar = node.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    const chart = (node.offsetParent as HTMLElement | null)?.getBoundingClientRect();
    const below = Math.min(vh, chart ? chart.bottom : vh) - bar.bottom - 10, above = bar.top - 10;
    const up = list.scrollHeight > below && above > below;
    const w = list.offsetWidth;
    Object.assign(list.style, {
      position: 'fixed', zIndex: '1000', right: 'auto',
      left: `${Math.max(4, Math.min(menu === 'more' ? bar.right - w : bar.left, vw - w - 4))}px`,
      top: up ? 'auto' : `${bar.bottom + 6}px`, bottom: up ? `${vh - bar.top + 6}px` : 'auto',
      maxHeight: `${Math.max(80, up ? above : below)}px`, overflowY: 'auto',
    });
  }, [menu]);

  // A click anywhere else closes an open menu, as TradingView's do.
  useEffect(() => {
    if (!menu) return;
    const away = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setMenu(null); };
    // Scrolling the page would leave a screen-fixed menu behind: it closes, as TradingView's do.
    const scrolled = (event: Event) => { if (!ref.current?.contains(event.target as Node)) setMenu(null); };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('scroll', scrolled, true);
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('scroll', scrolled, true); };
  }, [menu]);

  const set = (patch: Partial<DrawingStyle>) => { onStyle({ ...style, ...patch }); };
  const toggle = (next: Exclude<Menu, null>) => setMenu(menu === next ? null : next);
  const placed: CSSProperties = position ? { left: position.left, top: position.top, transform: 'none' } : top !== undefined ? { top } : {};

  return <div ref={ref} className="drawing-object-toolbar" role="toolbar" aria-label={t('draw.objectToolbar')} data-drawing-object-toolbar
    style={placed} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
    onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); if (menu) setMenu(null); else onClose(); } }}>
    <span className="drawing-object-grip" data-object-action="drag" aria-hidden="true" title={t('draw.moveToolbar')} onPointerDown={startDrag}>
      <svg width="8" height="18" viewBox="0 0 8 18"><g fill="currentColor"><circle cx="2" cy="3" r="1.3" /><circle cx="6" cy="3" r="1.3" /><circle cx="2" cy="9" r="1.3" /><circle cx="6" cy="9" r="1.3" /><circle cx="2" cy="15" r="1.3" /><circle cx="6" cy="15" r="1.3" /></g></svg>
    </span>
    <button type="button" data-object-action="templates" title={t('draw.templates')} aria-label={t('draw.templates')} aria-haspopup="menu" aria-expanded={menu === 'templates'} disabled={frozen} onClick={() => toggle('templates')}>
      <svg width="22" height="22" viewBox="0 0 28 28" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="5.5" y="5.5" width="7" height="7" rx="1.5" /><rect x="15.5" y="5.5" width="7" height="7" rx="1.5" /><rect x="5.5" y="15.5" width="7" height="7" rx="1.5" /><path d="M19 15.5v7M15.5 19h7" strokeLinecap="round" /></g></svg>
    </button>
    <button type="button" data-object-action="color" title={t('draw.lineColor')} aria-label={t('draw.lineColor')} aria-haspopup="menu" disabled={frozen} aria-expanded={menu === 'color'} onClick={() => toggle('color')}>
      <span className="drawing-object-swatched">
        <svg width="22" height="22" viewBox="0 0 28 28" aria-hidden="true"><path d="m17.5 5.5 5 5L10 23H5v-5zM15 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
        <i className="drawing-object-swatch" style={{ background: style.color }} />
      </span>
    </button>
    {canFill && <button type="button" data-object-action="fill" title={t('draw.fillColor')} aria-label={t('draw.fillColor')} aria-haspopup="menu" disabled={frozen} aria-expanded={menu === 'fill'} onClick={() => toggle('fill')}>
      <span className="drawing-object-swatched">
        <svg width="22" height="22" viewBox="0 0 28 28" aria-hidden="true"><path d="m12.5 4.5 9 9-7 7-9-9zM5.5 11.5h16M23 16s-2 2.6-2 4a2 2 0 0 0 4 0c0-1.4-2-4-2-4z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
        <i className={`drawing-object-swatch${style.fillOff ? ' is-off' : ''}`} style={{ background: style.fillOff ? undefined : style.fill ?? style.color, opacity: style.fillOff ? undefined : Math.max(.35, style.fillOpacity ?? 1) }} />
      </span>
    </button>}
    {measure && <button type="button" data-object-action="text-color" title={t('draw.textColor')} aria-label={t('draw.textColor')} aria-haspopup="menu" disabled={frozen} aria-expanded={menu === 'text'} onClick={() => toggle('text')}>
      <span className="drawing-object-swatched">
        <svg width="22" height="22" viewBox="0 0 28 28" aria-hidden="true"><path d="M7 7.5V6h14v1.5M14 6v16M11 22h6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        <i className="drawing-object-swatch" style={{ background: style.textColor ?? (style.labelBg ?? style.color) }} />
      </span>
    </button>}
    <button type="button" data-object-action="width" title={t('draw.lineWidth')} aria-label={t('draw.lineWidth')} aria-haspopup="menu" disabled={frozen} aria-expanded={menu === 'width'} onClick={() => toggle('width')}>
      <span className="drawing-object-width"><i style={{ height: Math.max(1, Math.min(4, style.width)) }} />{style.width}px</span>
    </button>
    {canDash && <button type="button" data-object-action="dash" title={t('draw.lineStyle')} aria-label={t('draw.lineStyle')} aria-haspopup="menu" disabled={frozen} aria-expanded={menu === 'dash'} onClick={() => toggle('dash')}>
      <svg width="22" height="18" viewBox="0 0 24 18" aria-hidden="true"><line x1="2" y1="9" x2="22" y2="9" stroke="currentColor" strokeWidth="2" strokeDasharray={style.dash === 'dashed' ? '5 3' : style.dash === 'dotted' ? '1 3' : undefined} strokeLinecap="round" /></svg>
    </button>}
    {onEditText && <button type="button" data-object-action="text" title={t('draw.editText')} aria-label={t('draw.editText')} disabled={frozen} onClick={onEditText}>
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6V4h14v2M12 4v16M9 20h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
    </button>}
    {onSettings && <button type="button" data-object-action="settings" title={t('draw.settings')} aria-label={t('draw.settings')} onClick={() => { setMenu(null); onSettings(); }}>
      <svg width="22" height="22" viewBox="0 0 28 28" aria-hidden="true"><path d="m14 4.5 8.2 4.75v9.5L14 23.5l-8.2-4.75v-9.5z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><circle cx="14" cy="14" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
    </button>}
    <button type="button" data-object-action="lock" title={drawing.locked ? t('draw.unlockObject') : t('draw.lockObject')} aria-label={drawing.locked ? t('draw.unlockObject') : t('draw.lockObject')} aria-pressed={!!drawing.locked} disabled={locked} onClick={onToggleLock}>
      <svg width="22" height="22" viewBox="0 0 28 28" aria-hidden="true"><rect x="7.5" y="13" width="13" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d={drawing.locked ? 'M10 13v-3a4 4 0 0 1 8 0v3' : 'M10 13v-3a4 4 0 0 1 7.6-1.8'} fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M14 17v2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
    </button>
    <button type="button" data-object-action="delete" title={t('draw.deleteObject')} aria-label={t('draw.deleteObject')} disabled={frozen} onClick={onDelete}>
      <svg width="22" height="22" viewBox="0 0 28 28" aria-hidden="true"><path d="M7 8.5h14M11.5 8.5V6.5h5v2M9 8.5l1 14h8l1-14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" /></svg>
    </button>
    <button type="button" data-object-action="more" title={t('draw.more')} aria-label={t('draw.more')} aria-haspopup="menu" aria-expanded={menu === 'more'} onClick={() => toggle('more')}>
      <svg width="22" height="22" viewBox="0 0 28 28" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="7.5" cy="14" r="1.8" /><circle cx="14" cy="14" r="1.8" /><circle cx="20.5" cy="14" r="1.8" /></g></svg>
    </button>

    {(menu === 'color' || menu === 'fill' || menu === 'text') && <ColorMenu t={t} which={menu} style={style} defaultOpacity={defaultFillOpacity(drawing.kind)} onPick={(patch) => set(patch)} onDone={() => setMenu(null)} />}
    {menu === 'width' && <div className="drawing-object-menu" role="menu" data-object-menu="width">
      {DRAWING_WIDTHS.map((w) => <button key={w} type="button" role="menuitemradio" aria-checked={style.width === w} className="drawing-object-menu-row" onClick={() => { set({ width: w }); setMenu(null); }}>
        <i style={{ height: w }} /><span>{w}px</span>
      </button>)}
    </div>}
    {menu === 'dash' && <div className="drawing-object-menu" role="menu" data-object-menu="dash">
      {DASHES.map((d) => <button key={d} type="button" role="menuitemradio" aria-checked={style.dash === d} className="drawing-object-menu-row" onClick={() => { set({ dash: d }); setMenu(null); }}>
        <svg width="40" height="10" viewBox="0 0 40 10" aria-hidden="true"><line x1="2" y1="5" x2="38" y2="5" stroke="currentColor" strokeWidth="2" strokeDasharray={d === 'dashed' ? '6 4' : d === 'dotted' ? '1 4' : undefined} strokeLinecap="round" /></svg>
        <span>{t(`draw.dash.${d}`)}</span>
      </button>)}
    </div>}
    {menu === 'templates' && <TemplatesMenu t={t} kind={drawing.kind} style={style} onApply={(next) => { onStyle(next); setMenu(null); }} />}
    {menu === 'more' && <div className="drawing-object-menu drawing-object-more" role="menu" data-object-menu="more">
      <DrawingActions t={t} drawing={drawing} locked={locked} onSettings={onSettings} onClone={onClone} onOrder={onOrder}
        onToggleLock={onToggleLock} onDelete={onDelete} onDone={() => setMenu(null)} />
    </div>}
  </div>;
}

/** The «…» menu, and the same items on a right click on the drawing. */
export function DrawingActions({ t, drawing, locked, onSettings, onClone, onOrder, onToggleLock, onDelete, onDone }: {
  t: (key: any) => string; drawing: Drawing; locked: boolean;
  onSettings?: () => void; onClone: () => void; onOrder?: (to: 'front' | 'back') => void; onToggleLock: () => void; onDelete: () => void; onDone: () => void;
}) {
  const frozen = locked || !!drawing.locked;
  const item = (action: string, label: string, run: (() => void) | undefined, disabled = false) => run && <button type="button" role="menuitem"
    className="drawing-object-menu-row" data-object-action={action} disabled={disabled} onClick={() => { onDone(); run(); }}><span>{label}</span></button>;
  return <>
    {item('settings', t('draw.settings'), onSettings)}
    {item('clone', t('draw.clone'), onClone, locked)}
    {onOrder && item('front', t('draw.bringToFront'), () => onOrder('front'), frozen)}
    {onOrder && item('back', t('draw.sendToBack'), () => onOrder('back'), frozen)}
    <span className="drawing-object-menu-sep" />
    {item('lock', drawing.locked ? t('draw.unlockObject') : t('draw.lockObject'), onToggleLock, locked)}
    {item('delete', t('draw.deleteObject'), onDelete, frozen)}
  </>;
}

/** TradingView's colour menu: its palette, a colour of the trader's own and, for a background, the opacity and an off switch. */
function ColorMenu({ t, which, style, defaultOpacity, onPick, onDone }: { t: (key: any) => string; which: 'color' | 'fill' | 'text'; style: DrawingStyle; defaultOpacity: number; onPick: (patch: Partial<DrawingStyle>) => void; onDone: () => void }) {
  const current = which === 'color' ? style.color : which === 'fill' ? style.fill ?? style.color : style.textColor ?? '#ffffff';
  const pick = (c: string) => {
    onPick(which === 'color' ? { color: c } : which === 'fill' ? { fill: c, fillOff: undefined } : { textColor: c });
    if (which !== 'fill') onDone();
  };
  return <div className="drawing-object-menu" role="menu" data-object-menu={which === 'text' ? 'text-color' : which}>
    <div className="drawing-object-palette">
      {DRAWING_PALETTE.map((c) => <button key={c} type="button" role="menuitemradio" aria-checked={current === c} aria-label={c} title={c}
        style={{ background: c }} onClick={() => pick(c)} />)}
    </div>
    <label className="drawing-object-custom">
      <input type="color" value={current} aria-label={t('draw.customColor')} onChange={(e) => pick(e.target.value)} />
      <span>{t('draw.customColor')}</span>
    </label>
    {which === 'fill' && <>
      <label className="drawing-object-opacity">
        <span>{t('draw.opacity')}</span>
        <input type="range" min={0} max={100} step={5} value={Math.round((style.fillOpacity ?? defaultOpacity) * 100)}
          data-field="fillOpacity" onChange={(e) => onPick({ fillOpacity: Number(e.target.value) / 100, fillOff: undefined })} />
      </label>
      <label className="drawing-object-check">
        <input type="checkbox" checked={!style.fillOff} data-field="fillOn" onChange={(e) => onPick({ fillOff: e.target.checked ? undefined : true })} />
        <span>{t('draw.background')}</span>
      </label>
    </>}
  </div>;
}

/** «Шаблоны»: save this style under a name, apply a saved one, or go back to the kind's default. */
function TemplatesMenu({ t, kind, style, onApply }: { t: (key: any) => string; kind: DrawingKind; style: DrawingStyle; onApply: (style: DrawingStyle | undefined) => void }) {
  const [templates, setTemplates] = useState<DrawingTemplate[]>(() => listDrawingTemplates(kind));
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [failed, setFailed] = useState(false);
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const next = saveDrawingTemplate(kind, name, style);
    if (!next) { setFailed(true); return; }
    setTemplates(next); setNaming(false); setName(''); setFailed(false);
  };
  return <div className="drawing-object-menu drawing-object-templates" role="menu" data-object-menu="templates">
    {naming
      ? <form className="drawing-template-form" onSubmit={save}>
        <input autoFocus value={name} maxLength={40} placeholder={t('draw.templateName')} aria-label={t('draw.templateName')} data-field="templateName"
          onChange={(e) => { setName(e.target.value); setFailed(false); }} />
        <button type="submit" disabled={!name.trim()} data-object-action="template-save">{t('draw.save')}</button>
        {failed && <p role="alert">{t('draw.templateFailed')}</p>}
      </form>
      : <button type="button" role="menuitem" className="drawing-object-menu-row" data-object-action="template-new" onClick={() => setNaming(true)}><span>{t('draw.templateSave')}</span></button>}
    <button type="button" role="menuitem" className="drawing-object-menu-row" data-object-action="template-default" onClick={() => onApply(undefined)}><span>{t('draw.templateDefault')}</span></button>
    {templates.length > 0 && <span className="drawing-object-menu-sep" />}
    {templates.map((template) => <div key={template.name} className="drawing-template-row" data-template={template.name}>
      <button type="button" role="menuitem" className="drawing-object-menu-row" onClick={() => onApply(template.style)}>
        <i className="drawing-template-swatch" style={{ background: template.style.color }} /><span>{template.name}</span>
      </button>
      <button type="button" className="drawing-template-remove" aria-label={`${t('draw.templateRemove')}: ${template.name}`} title={t('draw.templateRemove')}
        onClick={() => setTemplates(removeDrawingTemplate(kind, template.name))}>×</button>
    </div>)}
  </div>;
}
