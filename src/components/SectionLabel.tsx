import React from 'react';
import { Eyebrow } from './ui/primitives';

export function SectionLabel({ label, note }: {label: string;note?: string;}) {
  return <div className="flex items-center gap-4 pt-2"><Eyebrow className="shrink-0 text-muted">{label}</Eyebrow><span className="h-px flex-1 bg-line" aria-hidden="true" />{note && <span className="shrink-0 text-[11px] text-faint">{note}</span>}</div>;
}
