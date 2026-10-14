import { useMemo, useState, type ReactNode } from 'react';
import { ChartWorkspaceToolbar, type WorkspaceFeature } from './ChartWorkspaceToolbar';
import { ChartTimeframeStrip } from './ChartTimeframeStrip';
import { ChartComparePanel, type CompareStatus } from './ChartComparePanel';
import { useCompareInstruments } from './useCompareInstruments';
import { ICONS } from './chartWorkspaceIcons';
import type { CompareEntry, ComparePeriod, WorkspaceLayout, WorkspacePreset } from '../../lib/chartWorkspace';
import type { ChartTimeframe, TimeframePlan } from '../../lib/chartTimeframes';
import type { Key } from '../../lib/i18n';

type T = (key: Key, params?: Record<string, string | number>) => string;

export type GoToResult = 'ok' | 'missing' | 'future';

export interface ChartWorkspaceControlsProps {
  market: 'spot' | 'futures';
  mainPair: string;
  compact: boolean;
  t: T;
  lang: string;
  timeframe: ChartTimeframe;
  quickTimeframes: ChartTimeframe[];
  plans: Record<ChartTimeframe, TimeframePlan>;
  onTimeframe: (tf: ChartTimeframe) => void;
  onQuickTimeframes: (list: ChartTimeframe[]) => void;
  tradable?: readonly string[];
  /** The chart-type and indicator menus (ChartToolbarMenus). */
  menus: ReactNode;
  compare: {
    entries: CompareEntry[]; period: ComparePeriod; status: Record<string, CompareStatus>; last: Record<string, number | null>; baseTime: number | null;
    onAdd: (pair: string) => void; onRemove: (pair: string) => void; onToggle: (pair: string) => void; onPeriod: (p: ComparePeriod) => void; onExit: () => void;
  };
  layout: { value: WorkspaceLayout; onChange: (v: WorkspaceLayout) => void; syncCursor: boolean; syncTime: boolean; syncTimeframe: boolean; onSync: (patch: { syncCursor?: boolean; syncTime?: boolean; syncTimeframe?: boolean }) => void; fourAllowed: boolean; twoAllowed: boolean };
  tools: { ruler: boolean; onRuler: () => void; railCollapsed: boolean; onRail: () => void; crosshair: boolean; onCrosshair: () => void; onClearDrawings: () => void; drawingCount: number };
  presets: { builtIn: readonly WorkspacePreset[]; custom: WorkspacePreset[]; onApply: (p: WorkspacePreset) => void; onSave: (name: string) => boolean; onRename: (id: string, name: string) => boolean; onDelete: (id: string) => void; onReset: () => void; max: number; applied: string | null };
  goTo: { onGo: (ms: number) => GoToResult | Promise<GoToResult>; lastTime: number | null };
  quick: { onReset: () => void; onFit: () => void; onLatest: () => void; logScale: boolean; onLogScale: () => void; autoScale: boolean; onAutoScale: () => void };
  snapshot: { available: boolean; hasPrivate: boolean; onTake: (options: { includePrivate: boolean; copy: boolean }) => Promise<'ok' | 'copied' | 'failed'> };
  fullscreen: { active: boolean; onToggle: () => void };
  settings?: ReactNode;
  end?: ReactNode;
  openRequest?: { id: string | null; seq: number };
  onOpenChange?: (id: string | null) => void;
}

const presetName = (preset: WorkspacePreset, t: T) => (preset.builtIn ? t(preset.name as Key) : preset.name);

function PresetsBody({ presets, t, close }: { presets: ChartWorkspaceControlsProps['presets']; t: T; close: () => void }) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const full = presets.custom.length >= presets.max;
  return (
    <div className="cw-presets" data-cw-presets>
      <div className="cw-section">
        <div className="cw-section-title">{t('chart.ws.presets.builtIn')}</div>
        {presets.builtIn.map(preset => (
          <button key={preset.id} type="button" role="menuitem" className={`cw-item${presets.applied === preset.id ? ' active' : ''}`} data-cw-preset={preset.id} onClick={() => { presets.onApply(preset); close(); }}>
            <span className="cw-item-label">{presetName(preset, t)}</span>
            <span className="cw-item-hint">{preset.timeframe} · {preset.indicators.length}</span>
            <span className="cw-item-tick" aria-hidden="true">{presets.applied === preset.id ? ICONS.check : null}</span>
          </button>
        ))}
      </div>
      <div className="cw-section">
        <div className="cw-section-title">{t('chart.ws.presets.custom')}</div>
        {presets.custom.map(preset => (
          <div key={preset.id} className="cw-preset-row" data-cw-preset-row={preset.id}>
            {renaming === preset.id ? (
              <form className="cw-inline-form" onSubmit={e => { e.preventDefault(); if (presets.onRename(preset.id, renameText)) setRenaming(null); }}>
                <input type="text" className="cw-input" value={renameText} maxLength={40} aria-label={t('chart.ws.presets.name')} autoFocus data-cw-preset-rename-input onChange={e => setRenameText(e.target.value)} />
                <button type="submit" className="cw-button is-primary">{t('chart.ws.presets.saveAction')}</button>
                <button type="button" className="cw-button" onClick={() => setRenaming(null)}>{t('chart.ws.presets.cancel')}</button>
              </form>
            ) : (
              <>
                <button type="button" role="menuitem" className={`cw-item${presets.applied === preset.id ? ' active' : ''}`} data-cw-preset={preset.id} onClick={() => { presets.onApply(preset); close(); }}>
                  <span className="cw-item-label">{preset.name}</span>
                  <span className="cw-item-hint">{preset.timeframe} · {preset.indicators.length}</span>
                </button>
                <button type="button" className="cw-icon-button" aria-label={`${preset.name}: ${t('chart.ws.presets.rename')}`} title={t('chart.ws.presets.rename')} data-cw-preset-rename={preset.id} onClick={() => { setRenaming(preset.id); setRenameText(preset.name); }}>✎</button>
                <button type="button" className="cw-icon-button is-remove" aria-label={`${preset.name}: ${t('chart.ws.presets.delete')}`} title={t('chart.ws.presets.delete')} data-cw-preset-delete={preset.id} onClick={() => presets.onDelete(preset.id)}>{ICONS.trash}</button>
              </>
            )}
          </div>
        ))}
        {saving ? (
          <form className="cw-inline-form" data-cw-preset-form onSubmit={e => { e.preventDefault(); if (presets.onSave(name)) { setSaving(false); setName(''); } }}>
            <input type="text" className="cw-input" value={name} maxLength={40} placeholder={t('chart.ws.presets.name')} aria-label={t('chart.ws.presets.name')} autoFocus data-cw-preset-name onChange={e => setName(e.target.value)} />
            <button type="submit" className="cw-button is-primary" disabled={!name.trim()} data-cw-preset-save>{t('chart.ws.presets.saveAction')}</button>
            <button type="button" className="cw-button" onClick={() => setSaving(false)}>{t('chart.ws.presets.cancel')}</button>
          </form>
        ) : (
          <button type="button" className="cw-item" data-cw-preset-new disabled={full} title={full ? t('chart.ws.presets.max', { n: presets.max }) : undefined} onClick={() => setSaving(true)}>
            <span className="cw-item-label">{t('chart.ws.presets.save')}</span>
            <span className="cw-item-tick" aria-hidden="true">{ICONS.plus}</span>
          </button>
        )}
        {full && <p className="cw-hint">{t('chart.ws.presets.max', { n: presets.max })}</p>}
      </div>
      <div className="cw-actions">
        <span className="cw-hint">{t('chart.ws.presets.note')}</span>
        <button type="button" className="cw-button" data-cw-preset-reset onClick={() => { presets.onReset(); close(); }}>{t('chart.ws.presets.reset')}</button>
      </div>
    </div>
  );
}

function GoToBody({ goTo, t, close }: { goTo: ChartWorkspaceControlsProps['goTo']; t: T; close: () => void }) {
  const initial = goTo.lastTime ? new Date(goTo.lastTime * 1000).toISOString().slice(0, 16) : '';
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<GoToResult | 'busy' | null>(null);
  return (
    <form className="cw-goto" data-cw-goto onSubmit={e => {
      e.preventDefault();
      const ms = Date.parse(`${value}:00Z`);
      if (!Number.isFinite(ms) || status === 'busy') return;
      setStatus('busy');
      void Promise.resolve(goTo.onGo(ms)).then(result => { setStatus(result); if (result === 'ok') close(); }, () => setStatus('missing'));
    }}>
      <label className="cw-field">
        <span>{t('chart.ws.goTo.label')}</span>
        <input type="datetime-local" className="cw-input" value={value} step={60} required data-cw-goto-input onChange={e => { setValue(e.target.value); setStatus(null); }} />
      </label>
      <div className="cw-actions">
        {status === 'missing' && <span className="cw-hint is-warn" role="status">{t('chart.ws.goTo.missing')}</span>}
        {status === 'future' && <span className="cw-hint is-warn" role="status">{t('chart.ws.goTo.future')}</span>}
        <button type="submit" className="cw-button is-primary" data-cw-goto-apply disabled={status === 'busy'}>{t('chart.ws.goTo.apply')}</button>
      </div>
    </form>
  );
}

function SnapshotBody({ snapshot, t }: { snapshot: ChartWorkspaceControlsProps['snapshot']; t: T }) {
  const [includePrivate, setIncludePrivate] = useState(false);
  const [status, setStatus] = useState<'ok' | 'copied' | 'failed' | 'busy' | null>(null);
  const take = async (copy: boolean) => {
    setStatus('busy');
    setStatus(await snapshot.onTake({ includePrivate, copy }));
  };
  if (!snapshot.available) return <p className="cw-hint" data-cw-snapshot-unavailable>{t('chart.ws.snapshot.tv')}</p>;
  return (
    <div className="cw-snapshot" data-cw-snapshot>
      {snapshot.hasPrivate && (
        <label className="cw-check">
          <input type="checkbox" checked={includePrivate} data-cw-snapshot-private onChange={e => setIncludePrivate(e.target.checked)} />
          <span>{t('chart.ws.snapshot.private')}</span>
        </label>
      )}
      <div className="cw-actions">
        <button type="button" className="cw-button is-primary" data-cw-snapshot-download disabled={status === 'busy'} onClick={() => void take(false)}>{t('chart.ws.snapshot.download')}</button>
        <button type="button" className="cw-button" data-cw-snapshot-copy disabled={status === 'busy'} onClick={() => void take(true)}>{t('chart.ws.snapshot.copy')}</button>
      </div>
      {status === 'copied' && <p className="cw-hint" role="status">{t('chart.ws.snapshot.copied')}</p>}
      {status === 'failed' && <p className="cw-hint is-warn" role="status">{t('chart.ws.snapshot.failed')}</p>}
    </div>
  );
}

const SHORTCUT_KEYS: Key[] = ['chart.ws.shortcuts.timeframes', 'chart.ws.shortcuts.prevNext', 'chart.ws.shortcuts.indicators', 'chart.ws.shortcuts.compare', 'chart.ws.shortcuts.fullscreen', 'chart.ws.shortcuts.latest', 'chart.ws.shortcuts.reset', 'chart.ws.shortcuts.clearCompare', 'chart.ws.shortcuts.data', 'chart.ws.shortcuts.drawing', 'chart.ws.shortcuts.escape', 'chart.ws.shortcuts.note'];

/** The whole second row of the workspace: features assembled from the chart's state and handed to the toolbar. */
export function ChartWorkspaceControls(props: ChartWorkspaceControlsProps) {
  const { t, compact, market, mainPair, compare, layout, tools, presets, goTo, quick, snapshot, fullscreen } = props;
  const instruments = useCompareInstruments(market, [mainPair]);
  const features = useMemo<WorkspaceFeature[]>(() => [
    {
      id: 'compare', label: t('chart.ws.compare'), icon: ICONS.compare, priority: 2, phoneRow: true, menuWidth: 340, separator: true,
      active: compare.entries.length > 0, badge: compare.entries.length ? String(compare.entries.length) : undefined,
      body: close => <ChartComparePanel market={market} mainPair={mainPair} entries={compare.entries} period={compare.period} status={compare.status} last={compare.last} baseTime={compare.baseTime}
        instruments={instruments} onAdd={compare.onAdd} onRemove={compare.onRemove} onToggle={compare.onToggle} onPeriod={compare.onPeriod} onExit={compare.onExit} t={t} lang={props.lang} close={close} />,
    },
    {
      id: 'layout', label: t('chart.ws.layout'), icon: ICONS.layout, priority: 3, menuWidth: 280, active: layout.value !== 1, badge: layout.value !== 1 ? String(layout.value) : undefined,
      body: close => (
        <div data-cw-layout-menu>
          {([1, 2, 4] as WorkspaceLayout[]).map(value => {
            const allowed = value === 1 || (value === 2 ? layout.twoAllowed : layout.fourAllowed);
            return (
              <button key={value} type="button" role="menuitemradio" aria-checked={layout.value === value} className="cw-item" data-cw-layout-option={value} disabled={!allowed}
                title={!allowed ? t(value === 4 ? 'chart.ws.layout.fourDesktop' : 'chart.ws.layout.phone') : undefined}
                onClick={() => { layout.onChange(value); close(); }}>
                <span className="cw-item-label">{t(value === 1 ? 'chart.ws.layout.one' : value === 2 ? 'chart.ws.layout.two' : 'chart.ws.layout.four')}</span>
                {!allowed && <span className="cw-item-hint">{t(value === 4 ? 'chart.ws.layout.fourDesktop' : 'chart.ws.layout.phone')}</span>}
                <span className="cw-item-tick" aria-hidden="true">{layout.value === value ? ICONS.check : null}</span>
              </button>
            );
          })}
          <div className="cw-section">
            <label className="cw-check"><input type="checkbox" checked={layout.syncCursor} data-cw-sync="cursor" onChange={e => layout.onSync({ syncCursor: e.target.checked })} /><span>{t('chart.ws.layout.syncCursor')}</span></label>
            <label className="cw-check"><input type="checkbox" checked={layout.syncTime} data-cw-sync="time" onChange={e => layout.onSync({ syncTime: e.target.checked })} /><span>{t('chart.ws.layout.syncTime')}</span></label>
            <label className="cw-check"><input type="checkbox" checked={layout.syncTimeframe} data-cw-sync="timeframe" onChange={e => layout.onSync({ syncTimeframe: e.target.checked })} /><span>{t('chart.ws.layout.syncTimeframe')}</span></label>
          </div>
          {compact && <p className="cw-hint">{t('chart.ws.layout.phone')}</p>}
        </div>
      ),
    },
    {
      id: 'tools', label: t('chart.ws.tools'), icon: ICONS.tools, priority: 4, menuWidth: 300, active: tools.ruler,
      body: close => (
        <div data-cw-tools-menu>
          <button type="button" role="menuitemcheckbox" aria-checked={tools.ruler} className={`cw-item${tools.ruler ? ' active' : ''}`} data-cw-tool="ruler" onClick={() => { tools.onRuler(); close(); }}>
            <span className="cw-feature-icon" aria-hidden="true">{ICONS.ruler}</span><span className="cw-item-label">{t('chart.ws.tools.ruler')}</span><span className="cw-item-tick" aria-hidden="true">{tools.ruler ? ICONS.check : null}</span>
          </button>
          <button type="button" role="menuitemcheckbox" aria-checked={!tools.railCollapsed} className="cw-item" data-cw-tool="rail" onClick={tools.onRail}>
            <span className="cw-item-label">{t('chart.ws.tools.rail')}</span><span className="cw-item-tick" aria-hidden="true">{!tools.railCollapsed ? ICONS.check : null}</span>
          </button>
          <button type="button" role="menuitemcheckbox" aria-checked={tools.crosshair} className="cw-item" data-cw-tool="crosshair" onClick={tools.onCrosshair}>
            <span className="cw-item-label">{t('chart.ws.tools.crosshair')}</span><span className="cw-item-tick" aria-hidden="true">{tools.crosshair ? ICONS.check : null}</span>
          </button>
          <button type="button" role="menuitem" className="cw-item is-danger" data-cw-tool="clear" disabled={tools.drawingCount === 0} onClick={() => { tools.onClearDrawings(); close(); }}>
            <span className="cw-feature-icon" aria-hidden="true">{ICONS.trash}</span><span className="cw-item-label">{t('chart.ws.tools.clear')}{tools.drawingCount ? ` (${tools.drawingCount})` : ''}</span>
          </button>
          <details className="cw-details" data-cw-shortcuts>
            <summary className="cw-item"><span className="cw-feature-icon" aria-hidden="true">{ICONS.keyboard}</span><span className="cw-item-label">{t('chart.ws.tools.shortcuts')}</span></summary>
            <ul className="cw-shortcuts">{SHORTCUT_KEYS.map(key => <li key={key}>{t(key)}</li>)}</ul>
          </details>
        </div>
      ),
    },
    {
      id: 'presets', label: t('chart.ws.presets'), icon: ICONS.presets, priority: 5, menuWidth: 320, active: presets.applied !== null,
      body: close => <PresetsBody presets={presets} t={t} close={close} />,
    },
    {
      id: 'goto', label: t('chart.ws.goTo'), icon: ICONS.calendar, priority: 6, iconOnly: true, menuWidth: 280, separator: true,
      body: close => <GoToBody goTo={goTo} t={t} close={close} />,
    },
    {
      id: 'scale', label: t('chart.ws.resetScale'), icon: ICONS.reset, priority: 4, iconOnly: true, menuWidth: 260,
      body: close => (
        <div data-cw-scale-menu>
          <button type="button" role="menuitem" className="cw-item" data-cw-scale="reset" onClick={() => { quick.onReset(); close(); }}><span className="cw-feature-icon" aria-hidden="true">{ICONS.reset}</span><span className="cw-item-label">{t('chart.ws.resetScale')}</span></button>
          <button type="button" role="menuitem" className="cw-item" data-cw-scale="fit" onClick={() => { quick.onFit(); close(); }}><span className="cw-feature-icon" aria-hidden="true">{ICONS.fit}</span><span className="cw-item-label">{t('chart.ws.fit')}</span></button>
          <button type="button" role="menuitem" className="cw-item" data-cw-scale="latest" onClick={() => { quick.onLatest(); close(); }}><span className="cw-feature-icon" aria-hidden="true">{ICONS.latest}</span><span className="cw-item-label">{t('chart.ws.latest')}</span></button>
          <button type="button" role="menuitemcheckbox" aria-checked={quick.autoScale} className="cw-item" data-cw-scale="auto" onClick={quick.onAutoScale}><span className="cw-item-label">{t('chart.ws.autoScale')}</span><span className="cw-item-tick" aria-hidden="true">{quick.autoScale ? ICONS.check : null}</span></button>
          <button type="button" role="menuitemcheckbox" aria-checked={quick.logScale} className="cw-item" data-cw-scale="log" onClick={quick.onLogScale}><span className="cw-item-label">{t('chart.ws.logScale')}</span><span className="cw-item-tick" aria-hidden="true">{quick.logScale ? ICONS.check : null}</span></button>
        </div>
      ),
    },
    {
      id: 'snapshot', label: t('chart.ws.snapshot'), icon: ICONS.camera, priority: 6, iconOnly: true, menuWidth: 280,
      body: () => <SnapshotBody snapshot={snapshot} t={t} />,
    },
    {
      id: 'fullscreen', label: t(fullscreen.active ? 'chart.ws.fullscreen.exit' : 'chart.ws.fullscreen'), icon: fullscreen.active ? ICONS.exitFullscreen : ICONS.fullscreen, priority: 3, iconOnly: true,
      onAction: fullscreen.onToggle, active: fullscreen.active,
    },
  ], [t, compact, market, mainPair, compare, layout, tools, presets, goTo, quick, snapshot, fullscreen, instruments, props.lang]);

  return (
    <ChartWorkspaceToolbar
      features={features}
      compact={compact}
      start={<ChartTimeframeStrip timeframe={props.timeframe} quick={props.quickTimeframes} plans={props.plans} onSelect={props.onTimeframe} onQuickChange={props.onQuickTimeframes} t={t} compact={compact} tradable={props.tradable} />}
      menus={props.menus}
      end={<>{props.settings}{props.end}</>}
      moreLabel={t('chart.ws.more')}
      phoneLabel={t('chart.ws.phone.tools')}
      closeLabel={t('chart.ws.close')}
      openRequest={props.openRequest}
      onOpenChange={props.onOpenChange}
    />
  );
}
