import type { ReactNode } from 'react';

// Ported from the archive's components/voltex/panel.tsx almost verbatim —
// only the import path and default-prop syntax changed for this project's
// TS/React setup.
export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-border bg-card shadow-premium ${className}`}>{children}</section>;
}

export function PanelHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6 sm:py-5">
      <div className="min-w-0">
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-foreground">{title}</h2>
        {subtitle && <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
