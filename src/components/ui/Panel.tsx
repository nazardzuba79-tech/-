import React from 'react';

type PanelProps = { title?: string; subtitle?: string; action?: React.ReactNode; source?: string; dense?: boolean; className?: string; children: React.ReactNode; };

export function Panel({ title, subtitle, action, source, dense = false, className = '', children }: PanelProps) {
  return <section className={`flex flex-col border border-line bg-white ${className}`}>
    {(title || action) && <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4"><div className="min-w-0">{title && <h2 className="text-[15px] font-medium leading-5 text-ink">{title}</h2>}{subtitle && <p className="mt-1.5 max-w-3xl text-[12px] leading-[1.5] text-muted">{subtitle}</p>}</div>{action && <div className="shrink-0">{action}</div>}</header>}
    <div className={`flex-1 ${dense ? '' : 'px-5 py-4'}`}>{children}</div>
    {source && <footer className="border-t border-line px-5 py-2.5 text-[11px] text-faint">{source}</footer>}
  </section>;
}
