/**
 * Drawing templates, as TradingView keeps them: a named style per kind of
 * drawing, saved in this browser and applied from the object toolbar or the
 * settings dialog («Шаблон»). Only the style is a template; anchors, text
 * and visibility stay the drawing's own.
 */
import { sanitizeDrawingStyle, type DrawingKind, type DrawingStyle } from './chartDrawings';

export interface DrawingTemplate { name: string; style: DrawingStyle }

const KEY = 'voltex.drawing-templates.v1';
export const MAX_TEMPLATES_PER_KIND = 20;
export const MAX_TEMPLATE_NAME = 40;

function readAll(): Record<string, DrawingTemplate[]> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, DrawingTemplate[]> = {};
    for (const [kind, list] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      out[kind] = list.flatMap((entry) => {
        const e = entry as Record<string, unknown> | null;
        const style = sanitizeDrawingStyle(e?.style);
        const name = typeof e?.name === 'string' ? e.name.trim().slice(0, MAX_TEMPLATE_NAME) : '';
        return style && name ? [{ name, style }] : [];
      }).slice(0, MAX_TEMPLATES_PER_KIND);
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, DrawingTemplate[]>): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

export function listDrawingTemplates(kind: DrawingKind): DrawingTemplate[] {
  return readAll()[kind] ?? [];
}

/** Save (or replace by name) one template; the newest comes first. Returns the kind's list, or null when storage refused it. */
export function saveDrawingTemplate(kind: DrawingKind, name: string, style: DrawingStyle): DrawingTemplate[] | null {
  const clean = name.trim().slice(0, MAX_TEMPLATE_NAME);
  const safe = sanitizeDrawingStyle(style);
  if (!clean || !safe) return null;
  const all = readAll();
  const list = [{ name: clean, style: safe }, ...(all[kind] ?? []).filter((t) => t.name !== clean)].slice(0, MAX_TEMPLATES_PER_KIND);
  all[kind] = list;
  return writeAll(all) ? list : null;
}

export function removeDrawingTemplate(kind: DrawingKind, name: string): DrawingTemplate[] {
  const all = readAll();
  all[kind] = (all[kind] ?? []).filter((t) => t.name !== name);
  writeAll(all);
  return all[kind];
}
