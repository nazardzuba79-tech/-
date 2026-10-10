'use strict';
/**
 * Turns one or two runs of scripts/qa-mobile-client-audit.cjs into the
 * review matrix: route → state → viewport → verdict, with the before→after
 * change per cell when two runs are given.
 *
 *   node scripts/qa-mobile-client-report.cjs <after-dir> [before-dir] > matrix.md
 *
 * A cell is judged on the measured signals that matter on a phone: page-wide
 * horizontal overflow, boxes past the edge, text cut without an ellipsis,
 * overlapping text and controls covered at the end of the page. Tap-target
 * counts and 10px-font counts are listed separately as notes, not verdicts.
 * «н/п» = the state does not exist at that width (a phone-only tab on desktop);
 * «не проверено» = the capture failed.
 */
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null;
const [afterDir, beforeDir] = args;
if (!afterDir) { console.error('usage: qa-mobile-client-report.cjs <after-dir> [before-dir] [--json cells.json]'); process.exit(1); }
const load = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
const after = load(afterDir);
const before = beforeDir ? load(beforeDir) : null;

// Signals that are not defects on their own:
//  - the fixed bottom bar, the support launcher and the «Аналитика» launcher
//    over the first screen's content (the page scrolls past them)
//  - the top-gainers marquee's edge clipping (it is an animated strip)
const NOISE = /bottom-nav|support-launcher|markets-analytics-launch|market-ticker|ticker-track/;
// Sticky chrome at the scrolled-to-end position: the header, the ticker, the
// terminal tab strip and the bottom bar sit over mid-page content there; the
// page scrolls on, so a control under them is not out of reach. A floating
// launcher under the bottom bar IS out of reach (it cannot scroll), so for
// those two the bar still counts.
const STICKY = /header|global-header|terminal-mobile-tabs|market-ticker|bottom-nav|support-launcher/;
const FLOATING = /markets-analytics-launch|support-launcher/;
// A slider's stop buttons sit on the track by design (they are its tap targets).
const SIBLING_TARGET = /flc-stop|slider-stop/;
const TOAST = /Не удалось|Not able|Failed/;
// Layers that are open on purpose in the state they appear in: the burger
// menu, the support chat, a dialog (and everything inside it: the calculator
// «fc-», the limit close «flc-», TP/SL, the Earn and bots modals) and the
// «position close failed» alert card. Text under an opaque layer is not an
// overlap, and a control under it is not covered by accident — but anything
// inside the same layer still counts (a dialog's own footer over its own
// field is a defect).
const OVERLAY = /nav-mobile-menu|\bsupport-|voltex-assistant-panel|\bfc-|\bflc-|fut-tpsl|archive-tool-dialog|\[dialog\]|futures-closed-card|modal-liquid-glass|deposit-modal|banking-modal|vb-modal/;
const sameLayer = (a, b) => { const la = a.match(OVERLAY)?.[0], lb = b.match(OVERLAY)?.[0]; return la === lb; };

function judge(c) {
  if (c.skipped) return { verdict: 'н/п', issues: [] };
  if (c.error || !c.metrics || c.metrics.auditError) return { verdict: 'не проверено', issues: [c.error || c.metrics?.auditError || 'audit failed'] };
  // The step that should have produced this state did not complete (a control
  // was not found in time): what was measured is the previous state, so the
  // cell is unchecked rather than a pass.
  if (c.stepError) return { verdict: 'не проверено', issues: [String(c.stepError).split('\n')[0].slice(0, 80)] };
  const m = c.metrics;
  const issues = [];
  if (m.docOverflow > 2) issues.push(`page overflow +${m.docOverflow}px`);
  const spill = (m.spill || []).filter(s => !NOISE.test(s.sel));
  if (spill.length) issues.push(`spill ×${spill.length}`);
  const clip = (m.clipped || []).filter(x => x.kind !== 'ellipsis' && !NOISE.test(x.sel));
  if (clip.length) issues.push(`clip ×${clip.length}`);
  const overlaps = (m.overlaps || []).filter(o => !NOISE.test(o.a) && !NOISE.test(o.b) && !TOAST.test(o.aText + o.bText) && sameLayer(o.a, o.b));
  if (overlaps.length) issues.push(`overlap ×${overlaps.length}`);
  // Sticky chrome (header, ticker, bottom bar) over mid-page content at the
  // scrolled-to-end position is not «covered at the end of the page»: the page
  // scrolls on. An element under an open overlay from another layer is the
  // overlay doing its job. What remains is a control the user cannot reach.
  const occludedBottom = (c.bottom?.occluded || []).filter(o => {
    const by = o.by || '', sel = o.sel || '';
    if (FLOATING.test(sel) && /bottom-nav/.test(by)) return true;
    if (STICKY.test(by) || SIBLING_TARGET.test(by)) return false;
    return sameLayer(sel, by);
  });
  if (occludedBottom.length) issues.push(`covered@end ×${occludedBottom.length}`);
  if (m.text?.nan || m.text?.undefined) issues.push('NaN/undefined');
  if ((c.errors || []).some(e => /pageerror/.test(e))) issues.push('page error');
  return { verdict: issues.length ? 'дефект' : 'ok', issues, notes: { tiny: (m.tinyTargets || []).length, small: (m.smallTargets || []).length, font: (m.tinyFonts || []).length, stepError: c.stepError } };
}

const key = (c) => `${c.scenario}|${c.state}`;
const widths = after.widths;
const rows = new Map();
for (const c of after.captures) {
  const k = key(c);
  if (!rows.has(k)) rows.set(k, { scenario: c.scenario, path: c.path, state: c.state, cells: {} });
  rows.get(k).cells[c.viewport] = { after: judge(c) };
}
if (before) for (const c of before.captures) {
  const k = key(c); const row = rows.get(k); if (!row) continue;
  const cell = row.cells[c.viewport]; if (!cell) continue;
  cell.before = judge(c);
}

const mark = (j) => j.verdict === 'ok' ? '✅' : j.verdict === 'н/п' ? '—' : j.verdict === 'не проверено' ? '⚠️ не проверено' : `❌ ${j.issues.join(', ')}`;
const out = [];
out.push(`# Матриця перевірки — ${after.lang} / шрифти: ${after.fonts} / ${after.browser}`);
out.push('');
out.push(`Після: ${after.startedAt} → ${after.finishedAt}, ${after.captures.length} знімків стану.${before ? ` До: ${before.startedAt}, ${before.captures.length} знімків.` : ''}`);
out.push(`Запити на запис із браузера, відхилені fixture-сервером: ${after.writesAttempted}. Невідомі fixture-ендпоінти: ${after.unknownEndpoints.join(', ') || 'немає'}.`);
out.push('');
out.push('Комірка: ✅ — без виміряних дефектів; ❌ — що саме знайдено (page overflow = горизонтальна прокрутка сторінки; spill = блок за краєм екрана; clip = обрізаний текст без «…»; overlap = накладання текстових рядків; covered@end = кнопка накрита шаром наприкінці сторінки); — = стан не існує на цій ширині; «не проверено» = крок до цього стану не виконався (елемент не знайдено) або знімок не вдався; стрілка «до→після» показує зміну відносно базової збірки. Відфільтровано як шум: нижня панель навігації, кнопка підтримки, кнопка «Аналитика» й біжучий рядок котирувань над вмістом на межі екрана; липкі шапка/смужка вкладок/панель над серединою сторінки у положенні «кінець сторінки» (сторінка прокручується далі; плаваюча кнопка під панеллю, навпаки, рахується); тости «Не удалось…»; текст під відкритим меню/чатом підтримки/діалогом (шар поверх сторінки), крім накладань усередині того самого шару; кнопки-упори повзунка над його доріжкою.');
out.push('');
out.push(`| маршрут | стан | ${widths.join(' | ')} |`);
out.push(`|---|---|${widths.map(() => '---').join('|')}|`);
for (const r of rows.values()) {
  const cells = widths.map(w => {
    const cell = r.cells[w]; if (!cell) return '⚠️ не проверено';
    const a = mark(cell.after);
    if (cell.before && cell.before.verdict !== cell.after.verdict) return `${mark(cell.before)} → ${a}`;
    return a;
  });
  out.push(`| ${r.path} | ${r.state} | ${cells.join(' | ')} |`);
}
out.push('');
// Summary counts
let ok = 0, bad = 0, na = 0, unchecked = 0, fixed = 0, regressed = 0;
for (const r of rows.values()) for (const w of widths) {
  const cell = r.cells[w]; if (!cell) { unchecked++; continue; }
  const v = cell.after.verdict;
  if (v === 'ok') ok++; else if (v === 'н/п') na++; else if (v === 'дефект') bad++; else unchecked++;
  if (cell.before) { if (cell.before.verdict === 'дефект' && v === 'ok') fixed++; if (cell.before.verdict === 'ok' && v === 'дефект') regressed++; }
}
out.push(`Підсумок після: ✅ ${ok}, ❌ ${bad}, — ${na}, не перевірено ${unchecked}.${before ? ` Виправлено комірок: ${fixed}; регресій (було ✅, стало ❌): ${regressed}.` : ''}`);
out.push('');
// Residual defects, listed once per route/state with the widths they persist on
out.push('## Залишкові виміряні сигнали після правок');
out.push('');
const residual = [];
for (const r of rows.values()) {
  const per = {};
  for (const w of widths) { const cell = r.cells[w]; if (cell && cell.after.verdict === 'дефект') for (const i of cell.after.issues) (per[i] ||= []).push(w); }
  for (const [issue, ws] of Object.entries(per)) residual.push(`- ${r.path} · ${r.state}: ${issue} (${ws.join(', ')})`);
}
out.push(residual.length ? residual.join('\n') : '- немає');
process.stdout.write(out.join('\n') + '\n');
if (jsonOut) {
  // Compact per-cell verdicts (the raw report.json carries every measured box and is too large to keep in the repo).
  const cells = [];
  for (const r of rows.values()) for (const w of widths) {
    const cell = r.cells[w]; if (!cell) continue;
    cells.push({ path: r.path, scenario: r.scenario, state: r.state, viewport: w, after: cell.after.verdict, afterIssues: cell.after.issues, before: cell.before?.verdict, beforeIssues: cell.before?.issues, notes: cell.after.notes });
  }
  fs.writeFileSync(jsonOut, JSON.stringify({ lang: after.lang, fonts: after.fonts, browser: after.browser, after: { startedAt: after.startedAt, finishedAt: after.finishedAt }, before: before ? { startedAt: before.startedAt, finishedAt: before.finishedAt } : null, summary: { ok, bad, na, unchecked, fixed, regressed }, cells }, null, 1));
}
