import React from 'react';
import { derivativeKpis, marketKpis } from '../data/market';
import { Eyebrow } from './ui/primitives';
import { toneClass } from '../utils/tone';

export function MarketKpiStrip(){return <div className="grid grid-cols-2 border border-line bg-white sm:grid-cols-3 lg:grid-cols-6">{marketKpis.map(kpi=><div key={kpi.label} className="border-b border-r border-line px-5 py-5 last:border-r-0 sm:[&:nth-child(3n)]:border-r-0 lg:border-b-0 lg:[&:nth-child(3n)]:border-r lg:[&:nth-child(6)]:border-r-0"><Eyebrow>{kpi.label}</Eyebrow><p className={`num mt-2.5 text-[21px] font-medium leading-7 ${toneClass(kpi.tone)}`}>{kpi.value}</p></div>)}</div>}
export function DerivativesStrip(){return <div className="grid grid-cols-2 bg-ink-panel md:grid-cols-3 lg:grid-cols-5"><div className="border-b border-r border-ink-line px-5 py-4 lg:border-b-0"><Eyebrow className="text-accent-bright">Деривативы 24ч</Eyebrow><p className="mt-2 text-[15px] font-medium text-white">Деривативы</p></div>{derivativeKpis.map((kpi,index)=><div key={kpi.label} className={`border-b border-ink-line px-5 py-4 lg:border-b-0 ${index===derivativeKpis.length-1?'':'border-r'}`}><p className="text-[11px] text-ink-mute">{kpi.label}</p><p className={`num mt-2 text-[15px] font-medium ${toneClass(kpi.tone,true)}`}>{kpi.value}</p></div>)}</div>}
