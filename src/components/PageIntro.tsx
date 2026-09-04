import React from 'react';
import { Eyebrow, Segmented } from './ui/primitives';
import { contextTabs } from '../data/market';

export function PageIntro({ context, onContextChange }: {context:string;onContextChange:(value:string)=>void;}) {
  return <div><div className="flex flex-wrap items-end justify-between gap-4"><div><Eyebrow className="text-accent">Аналитика крипторынка в реальном времени</Eyebrow><h1 className="mt-3 text-[34px] font-medium leading-[1.1] tracking-[-0.02em] text-ink">Аналитика</h1><p className="mt-3 text-[13px] text-muted">Деривативы, потоки капитала и ключевые индикаторы рынка</p></div><p className="flex items-center gap-2 pb-1 text-[12px] text-muted"><span className="h-[7px] w-[7px] rounded-full bg-pos" aria-hidden="true" />Обновлено 08:47 UTC</p></div><div className="mt-6 flex flex-wrap items-center justify-between gap-4 border border-line bg-white px-5 py-3"><div className="flex items-center gap-5"><Eyebrow>Аналитический контекст</Eyebrow><Segmented options={contextTabs} value={context} onChange={onContextChange} label="Аналитический контекст" /></div><p className="text-[12px] text-faint">{context==='Обзор'?'Сводный рынок · панели показывают BTC как референс':`Фокус на ${context} · панели пересчитаны под выбранный актив`}</p></div></div>;
}
