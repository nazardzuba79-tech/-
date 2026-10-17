/**
 * «Снимок графика» (2026-10-13): the VOLTEX chart's own canvas, as
 * Lightweight Charts paints it, composed with a title band (instrument,
 * timeframe, UTC date), the drawing overlay and the legend into one PNG.
 * The TradingView widget is a cross-origin frame and cannot be captured;
 * the caller says so instead of pretending.
 */
export interface SnapshotLegendItem { color: string; label: string }
export interface SnapshotInput {
  chart: HTMLCanvasElement;
  /** The drawing overlay, rendered on top of the chart at the same size. */
  overlay?: SVGSVGElement | null;
  title: string;
  subtitle: string;
  legend: SnapshotLegendItem[];
  background?: string;
  /** Logical size of the chart area; defaults to the canvas size. */
  width?: number;
  height?: number;
  /** Device pixel ratio the chart canvas was painted at. */
  scale?: number;
}

const BAND = 36, LEGEND = 22, PAD = 10;

/** The overlay SVG as an image the canvas can draw. */
function overlayImage(svg: SVGSVGElement, width: number, height: number): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    try {
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', String(width));
      clone.setAttribute('height', String(height));
      const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      image.src = url;
    } catch { resolve(null); }
  });
}

export async function composeChartSnapshot(input: SnapshotInput): Promise<HTMLCanvasElement> {
  const scale = input.scale && input.scale > 0 ? input.scale : 1;
  const width = input.width ?? input.chart.width / scale, height = input.height ?? input.chart.height / scale;
  const legendRows = input.legend.length ? 1 : 0;
  const out = document.createElement('canvas');
  out.width = Math.round(width * scale);
  out.height = Math.round((BAND + height + legendRows * LEGEND + PAD) * scale);
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('snapshot_context');
  ctx.scale(scale, scale);
  ctx.fillStyle = input.background ?? '#101014';
  ctx.fillRect(0, 0, width, BAND + height + legendRows * LEGEND + PAD);
  ctx.font = '600 13px Inter, Arial, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(input.title, PAD, BAND / 2);
  ctx.font = '400 11px Inter, Arial, sans-serif';
  ctx.fillStyle = '#9aa3ad';
  const titleWidth = ctx.measureText(input.title).width;
  ctx.font = '600 13px Inter, Arial, sans-serif';
  const measured = ctx.measureText(input.title).width;
  ctx.font = '400 11px Inter, Arial, sans-serif';
  ctx.fillText(input.subtitle, PAD + Math.max(titleWidth, measured) + 12, BAND / 2);
  ctx.font = '700 11px Inter, Arial, sans-serif';
  ctx.fillStyle = '#f0b90b';
  const brand = 'VOLTEX';
  ctx.fillText(brand, width - PAD - ctx.measureText(brand).width, BAND / 2);
  ctx.drawImage(input.chart, 0, BAND, width, height);
  if (input.overlay) {
    const image = await overlayImage(input.overlay, width, height);
    if (image) ctx.drawImage(image, 0, BAND, width, height);
  }
  if (legendRows) {
    let x = PAD;
    const y = BAND + height + LEGEND / 2 + 2;
    ctx.font = '500 11px Inter, Arial, sans-serif';
    for (const item of input.legend) {
      ctx.fillStyle = item.color;
      ctx.fillRect(x, y - 1.5, 12, 3);
      x += 16;
      ctx.fillStyle = '#d7dde5';
      ctx.fillText(item.label, x, y);
      x += ctx.measureText(item.label).width + 14;
      if (x > width - 40) break;
    }
  }
  return out;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') { reject(new Error('snapshot_blob')); return; }
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('snapshot_blob'))), 'image/png');
  });
}

export function snapshotFileName(pair: string, timeframe: string, at = new Date()): string {
  const stamp = at.toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
  return `voltex_${pair.replace(/[^A-Za-z0-9]+/g, '')}_${timeframe}_${stamp}.png`;
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** True when the image reached the clipboard; false where the browser refuses. */
export async function copyBlobToClipboard(blob: Blob): Promise<boolean> {
  try {
    const Item = (window as unknown as { ClipboardItem?: new (items: Record<string, Blob>) => unknown }).ClipboardItem;
    if (!Item || !navigator.clipboard || typeof (navigator.clipboard as { write?: unknown }).write !== 'function') return false;
    await (navigator.clipboard as unknown as { write: (items: unknown[]) => Promise<void> }).write([new Item({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

/** «BTC/USDT · 1ч · 2026-10-13 18:40 UTC» */
export function snapshotSubtitle(timeframeLabel: string, at = new Date()): string {
  return `${timeframeLabel} · ${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
