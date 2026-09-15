import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';

type RulerVisual = {
  left: number;
  top: number;
  width: number;
  height: number;
  startX: number;
  startY: number;
  endY: number;
  labelLeft: number;
  labelTop: number;
  labelWidth: number;
  primary: string;
  secondary: string;
};

type RulerGroup = {
  group: SVGGElement;
  line: SVGLineElement;
  pending: boolean;
};

const BLUE = '#2962ff';
const LABEL_HEIGHT = 44;

function frames(count = 1): Promise<void> {
  return new Promise((resolve) => {
    const step = () => {
      if (--count <= 0) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function intervalSeconds(value: string | null): number {
  const unit = value?.trim().toLowerCase();
  const map: Record<string, number> = {
    '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
    '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '12h': 43200,
    '1d': 86400, '1w': 604800,
  };
  return unit ? map[unit] ?? 0 : 0;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0m';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes || parts.length === 0) parts.push(`${minutes}m`);
  return parts.slice(0, 2).join(' ');
}

function directRulerLine(group: SVGGElement): SVGLineElement | null {
  for (const child of Array.from(group.children)) {
    if (!(child instanceof SVGLineElement)) continue;
    if (child.getAttribute('stroke') !== '#5b8def') continue;
    const dash = child.getAttribute('stroke-dasharray');
    if (dash === '4 3' || dash === '3 3') return child;
  }
  return null;
}

function rulerGroups(root: HTMLElement): RulerGroup[] {
  const drawings = root.querySelector<SVGGElement>('svg.drawing-overlay g[data-chart-drawings]');
  if (!drawings) return [];
  const result: RulerGroup[] = [];
  for (const child of Array.from(drawings.children)) {
    if (!(child instanceof SVGGElement)) continue;
    const line = directRulerLine(child);
    if (!line) continue;
    result.push({ group: child, line, pending: line.getAttribute('stroke-dasharray') === '3 3' });
  }
  return result;
}

function numberAttr(element: SVGLineElement, name: string): number | null {
  const value = Number(element.getAttribute(name));
  return Number.isFinite(value) ? value : null;
}

function sameVisual(a: RulerVisual | null, b: RulerVisual | null) {
  if (!a || !b) return a === b;
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height
    && a.startX === b.startX && a.startY === b.startY && a.endY === b.endY
    && a.labelLeft === b.labelLeft && a.labelTop === b.labelTop && a.labelWidth === b.labelWidth
    && a.primary === b.primary && a.secondary === b.secondary;
}

/**
 * Presentation/interaction adapter for the existing authoritative VOLTEX ruler.
 * Price/time anchors and math still come from PriceChart; this layer only gives
 * that ruler the familiar TradingView Measure behaviour and visuals.
 */
export function TradingViewRulerLayer({ children }: { children: ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const scheduledRef = useRef<number | null>(null);
  const clearingRef = useRef(false);
  const replayRulerClickRef = useRef(false);
  const [visual, setVisual] = useState<RulerVisual | null>(null);

  const scan = useCallback(() => {
    const root = hostRef.current;
    if (!root) return;
    const groups = rulerGroups(root);
    for (const item of groups) {
      item.group.style.visibility = 'hidden';
      item.group.dataset.voltexNativeRulerHidden = 'true';
    }
    const chosen = groups.find((item) => item.pending) ?? groups.at(-1);
    const svg = root.querySelector<SVGSVGElement>('svg.drawing-overlay');
    if (!chosen || !svg) {
      setVisual((previous) => (previous === null ? previous : null));
      return;
    }
    const x1 = numberAttr(chosen.line, 'x1');
    const y1 = numberAttr(chosen.line, 'y1');
    const x2 = numberAttr(chosen.line, 'x2');
    const y2 = numberAttr(chosen.line, 'y2');
    if (x1 === null || y1 === null || x2 === null || y2 === null) return;

    const rootRect = root.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    const offsetLeft = svgRect.left - rootRect.left;
    const offsetTop = svgRect.top - rootRect.top;
    const left = offsetLeft + Math.min(x1, x2);
    const top = offsetTop + Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);

    const texts = Array.from(chosen.group.querySelectorAll('text')).map((node) => node.textContent?.trim() ?? '').filter(Boolean);
    const pct = texts[0] ?? '—';
    const details = texts[1] ?? '';
    const detailParts = details.split('·').map((value) => value.trim()).filter(Boolean);
    const priceDiff = detailParts[0] ?? details;
    const barsText = detailParts[1] ?? '';
    const bars = Number.parseInt(barsText, 10);
    const activeInterval = root.querySelector<HTMLButtonElement>('.chart-tab[aria-pressed="true"]')?.textContent ?? null;
    const duration = Number.isFinite(bars) ? formatDuration(bars * intervalSeconds(activeInterval)) : '';
    const primary = priceDiff ? `${priceDiff} (${pct})` : pct;
    const secondary = duration ? `${barsText}, ${duration}` : barsText;
    const labelWidth = Math.max(128, Math.min(260, Math.max(primary.length, secondary.length) * 6.5 + 20));
    const center = left + width / 2;
    const plotLeft = offsetLeft + 4;
    const plotRight = offsetLeft + svgRect.width - 4;
    const labelLeft = Math.max(plotLeft, Math.min(center - labelWidth / 2, plotRight - labelWidth));
    const labelTop = top >= LABEL_HEIGHT + 8 ? top - LABEL_HEIGHT - 6 : top + 4;

    const next: RulerVisual = {
      left, top, width, height,
      startX: offsetLeft + x1,
      startY: offsetTop + y1,
      endY: offsetTop + y2,
      labelLeft, labelTop, labelWidth,
      primary, secondary,
    };
    setVisual((previous) => (sameVisual(previous, next) ? previous : next));
  }, []);

  const scheduleScan = useCallback(() => {
    if (scheduledRef.current !== null) return;
    scheduledRef.current = requestAnimationFrame(() => {
      scheduledRef.current = null;
      scan();
    });
  }, [scan]);

  const clearNativeRulers = useCallback(async () => {
    if (clearingRef.current) return;
    const root = hostRef.current;
    if (!root) return;
    clearingRef.current = true;
    try {
      // Cancel a half-drawn measurement first; committed rulers are removed
      // through PriceChart's own eraser so React state and localStorage agree.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await frames(1);

      const lock = root.querySelector<HTMLButtonElement>('button[data-drawing-tool="lock"][aria-pressed="true"]');
      const relock = !!lock;
      if (lock) { lock.click(); await frames(1); }

      const eraser = root.querySelector<HTMLButtonElement>('button[data-drawing-tool="erase"]');
      const cursor = root.querySelector<HTMLButtonElement>('button[data-drawing-tool="cursor"]');
      if (!eraser) { setVisual(null); return; }
      eraser.click();
      await frames(2);

      // Re-query after every deletion because React replaces the drawing list.
      for (let guard = 0; guard < 20; guard++) {
        const currentRoot = hostRef.current;
        if (!currentRoot) break;
        const committed = rulerGroups(currentRoot).filter((item) => !item.pending);
        const target = committed.at(-1);
        const svg = currentRoot.querySelector<SVGSVGElement>('svg.drawing-overlay');
        if (!target || !svg) break;
        const x1 = numberAttr(target.line, 'x1');
        const y1 = numberAttr(target.line, 'y1');
        const x2 = numberAttr(target.line, 'x2');
        const y2 = numberAttr(target.line, 'y2');
        if ([x1, y1, x2, y2].some((value) => value === null)) break;
        const rect = svg.getBoundingClientRect();
        svg.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true, cancelable: true, button: 0,
          clientX: rect.left + ((x1 as number) + (x2 as number)) / 2,
          clientY: rect.top + ((y1 as number) + (y2 as number)) / 2,
        }));
        await frames(2);
      }

      if (relock) {
        const lockAgain = root.querySelector<HTMLButtonElement>('button[data-drawing-tool="lock"]');
        lockAgain?.click();
        await frames(1);
      }
      cursor?.click();
      setVisual(null);
      scheduleScan();
    } finally {
      clearingRef.current = false;
    }
  }, [scheduleScan]);

  useEffect(() => {
    const root = hostRef.current;
    if (!root) return;
    const observer = new MutationObserver(scheduleScan);
    observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleScan);
    resize?.observe(root);
    root.addEventListener('pointermove', scheduleScan, { passive: true });
    root.addEventListener('wheel', scheduleScan, { passive: true });
    scheduleScan();
    return () => {
      observer.disconnect();
      resize?.disconnect();
      root.removeEventListener('pointermove', scheduleScan);
      root.removeEventListener('wheel', scheduleScan);
      if (scheduledRef.current !== null) cancelAnimationFrame(scheduledRef.current);
      for (const item of rulerGroups(root)) {
        if (item.group.dataset.voltexNativeRulerHidden === 'true') item.group.style.visibility = '';
      }
    };
  }, [scheduleScan]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && rulerGroups(hostRef.current as HTMLElement).some((item) => !item.pending)) void clearNativeRulers();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [clearNativeRulers]);

  const handleClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-drawing-tool="ruler"]') : null;
    if (!target || replayRulerClickRef.current || clearingRef.current) return;
    const root = hostRef.current;
    if (!root || !rulerGroups(root).some((item) => !item.pending)) return;
    event.preventDefault();
    event.stopPropagation();
    void clearNativeRulers().then(async () => {
      replayRulerClickRef.current = true;
      try { target.click(); await frames(1); } finally { replayRulerClickRef.current = false; }
    });
  }, [clearNativeRulers]);

  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const root = hostRef.current;
    if (!root || rulerGroups(root).length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    void clearNativeRulers();
  }, [clearNativeRulers]);

  const arrowTop = visual ? Math.min(visual.startY, visual.endY) : 0;
  const arrowHeight = visual ? Math.abs(visual.endY - visual.startY) : 0;

  return (
    <div ref={hostRef} onClickCapture={handleClickCapture} onContextMenu={handleContextMenu}
      style={{ position: 'relative', flex: 1, display: 'flex', minWidth: 0, minHeight: 0 }}>
      {children}
      {visual && (
        <div data-tradingview-ruler="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
          <div style={{
            position: 'absolute', left: visual.left, top: visual.top,
            width: Math.max(1, visual.width), height: Math.max(1, visual.height),
            background: 'rgba(41,98,255,0.20)', border: '1px solid rgba(82,128,255,0.78)',
            boxSizing: 'border-box',
          }} />
          {arrowHeight >= 14 && (
            <div style={{ position: 'absolute', left: visual.startX - 5, top: arrowTop, width: 10, height: arrowHeight }}>
              <div style={{ position: 'absolute', left: 4.5, top: 4, bottom: 4, width: 1.5, background: BLUE }} />
              <div style={{ position: 'absolute', left: 2, top: 2, width: 6, height: 6, borderLeft: `1.5px solid ${BLUE}`, borderTop: `1.5px solid ${BLUE}`, transform: 'rotate(45deg)' }} />
              <div style={{ position: 'absolute', left: 2, bottom: 2, width: 6, height: 6, borderRight: `1.5px solid ${BLUE}`, borderBottom: `1.5px solid ${BLUE}`, transform: 'rotate(45deg)' }} />
            </div>
          )}
          <div data-ruler-label="true" style={{
            position: 'absolute', left: visual.labelLeft, top: visual.labelTop, width: visual.labelWidth,
            height: LABEL_HEIGHT, borderRadius: 4, background: BLUE, color: '#fff',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'Inter, Arial, sans-serif', boxSizing: 'border-box', padding: '4px 8px',
          }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, lineHeight: '16px', whiteSpace: 'nowrap' }}>{visual.primary}</div>
            <div style={{ fontSize: 10.5, fontWeight: 600, lineHeight: '15px', opacity: 0.92, whiteSpace: 'nowrap' }}>{visual.secondary}</div>
          </div>
        </div>
      )}
    </div>
  );
}
