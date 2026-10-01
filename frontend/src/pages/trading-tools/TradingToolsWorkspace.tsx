import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Calculator, Check, ChevronDown, Copy, Crosshair, Gauge, Percent, RotateCcw, ShieldCheck, Sparkles, TrendingUp } from 'lucide-react';
import { toolsCopy, METHODS } from './copy';
import { emptyDraft, exampleDraft, TOOL_MODES, type Draft, type Market, type ToolMode } from './types';
import { Segment, ToolFields, type DraftUpdate } from './ToolFields';
import { calculateTool, exactResultText, ToolResults } from './ToolResults';
import '../trade-terminal/TerminalFonts.css';
import './TradingTools.css';

export type { ToolMode } from './types';
export { TOOL_MODES } from './types';
const ICONS = { pnl: BarChart3, size: Crosshair, liquidation: Gauge, 'risk-reward': ShieldCheck, dca: TrendingUp, fees: Percent };
export function TradingToolsWorkspace({ mode, onModeChange }: { mode: ToolMode; onModeChange: (mode: ToolMode) => void }) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [markets, setMarkets] = useState<Record<'pnl' | 'fees', Market>>({ pnl: 'futures', fees: 'futures' });
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const alive = useRef(true);
  const tabs = useRef<HTMLDivElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const market = mode === 'pnl' || mode === 'fees' ? markets[mode] : 'futures';
  const key = `${mode}:${market}`;
  const fallback = useMemo(() => emptyDraft(), [key]);
  const draft = drafts[key] || fallback;
  const calculation = useMemo(() => calculateTool(mode, draft, market), [mode, draft, market]);
  const errors = calculation.result.ok ? {} : calculation.result.errors;
  const update: DraftUpdate = useCallback((name, value) => {
    setCopyState('idle');
    setDrafts((current) => { const previous = current[key] || emptyDraft(); return { ...current, [key]: { ...previous, [name]: value, touched: [...new Set([...previous.touched, name])] } }; });
  }, [key]);
  const replaceDraft = (value: Draft) => { setCopyState('idle'); setDrafts((current) => ({ ...current, [key]: value })); };
  const chooseMode = (next: ToolMode) => { setCopyState('idle'); onModeChange(next); };
  const copy = async () => {
    if (!calculation.result.ok) return;
    try { await navigator.clipboard.writeText(exactResultText(calculation)); if (alive.current) setCopyState('copied'); }
    catch { if (alive.current) setCopyState('failed'); }
  };
  const ActiveIcon = ICONS[mode];
  return <main className="vx-trading-tools" lang="ru" data-tools-workspace>
    <div className="tt-container">
      <header className="tt-page-heading"><div className="tt-page-symbol"><Calculator size={23} aria-hidden="true" /></div><div><h1>{toolsCopy.title}</h1><p>{toolsCopy.subtitle}</p></div><span className="tt-currency-label">USDT · расчётная валюта</span></header>
      <div className="tt-tools" ref={tabs} role="tablist" aria-label="Торговые инструменты" onKeyDown={(event) => {
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const index = TOOL_MODES.indexOf(mode);
        const next = event.key === 'Home' ? TOOL_MODES[0] : event.key === 'End' ? TOOL_MODES[5] : TOOL_MODES[(index + (event.key === 'ArrowRight' ? 1 : 5)) % 6];
        chooseMode(next); tabs.current?.querySelector<HTMLButtonElement>(`[data-tools-mode="${next}"]`)?.focus();
      }}>{TOOL_MODES.map((item) => { const Icon = ICONS[item]; return <button type="button" role="tab" id={`tt-tab-${item}`} aria-selected={mode === item} aria-controls="tt-work-panel" tabIndex={mode === item ? 0 : -1} data-tools-mode={item} key={item} className={mode === item ? 'is-active' : ''} onClick={() => chooseMode(item)}><span className="tt-tool-icon"><Icon size={20} aria-hidden="true" /></span><span><strong>{toolsCopy.modes[item].title}</strong><small>{toolsCopy.modes[item].description}</small></span></button>; })}</div>
      <section id="tt-work-panel" className="tt-work-panel" role="tabpanel" aria-labelledby={`tt-tab-${mode}`}>
        <header className="tt-work-heading"><div className="tt-work-title"><span><ActiveIcon size={22} aria-hidden="true" /></span><div><h2>{toolsCopy.modes[mode].heading}</h2><p>{toolsCopy.context}</p></div></div><div className="tt-heading-actions"><button type="button" data-tools-action="example" onClick={() => replaceDraft(exampleDraft(mode, market))}><Sparkles size={15} aria-hidden="true" />Заполнить пример</button><button type="button" data-tools-action="reset" onClick={() => replaceDraft(emptyDraft())}><RotateCcw size={15} aria-hidden="true" />{mode === 'dca' ? 'Очистить' : 'Сбросить'}</button></div></header>
        <div className="tt-work-grid"><section className="tt-parameters" aria-label="Параметры расчёта">
          {(mode === 'pnl' || mode === 'fees') && <Segment label="Рынок" field="market" value={market} options={[{ value: 'spot', label: 'Спот' }, { value: 'futures', label: 'Фьючерсы USDT' }]} onChange={(value) => { setCopyState('idle'); setMarkets((current) => ({ ...current, [mode]: value })); }} />}
          <ToolFields mode={mode} market={market} draft={draft} errors={errors} update={update} />
        </section><div className="tt-results-column"><ToolResults calculation={calculation} draft={draft} /><button type="button" className="tt-copy-button" data-tools-action="copy" disabled={!calculation.result.ok} onClick={copy}>{copyState === 'copied' ? <Check size={16} /> : <Copy size={16} />}{copyState === 'copied' ? 'Расчёт скопирован' : 'Скопировать расчёт'}</button>{copyState === 'failed' && <p className="tt-copy-error" role="status">Не удалось скопировать. Откройте «Точные значения» и скопируйте текст вручную.</p>}</div></div>
        <details className="tt-method" key={`method-${mode}`}><summary data-tools-action="method"><span>Как считается</span><ChevronDown size={17} aria-hidden="true" /></summary><div><code>{METHODS[mode].formula}</code>{METHODS[mode].paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}<p>Лимит калькулятора: до 30 цифр до разделителя и 24 после. Поддерживаются точка или запятая; экспоненциальный ввод не принимается.</p></div></details>
      </section>
      <p className="tt-page-note">Оценка сценария не заменяет правила контракта и проверку условий исполнения.</p>
    </div>
  </main>;
}
