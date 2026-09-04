import React from 'react';
import { narrative } from '../data/market';
import { Panel } from './ui/Panel';
const dotClass:Record<string,string>={neg:'bg-neg',warn:'bg-accent',neutral:'bg-faint',pos:'bg-pos'};
export function MarketNarrative(){return <Panel title="Что происходит на рынке" dense><div className="grid divide-y divide-line lg:grid-cols-3 lg:divide-x lg:divide-y-0">{narrative.map(item=><article key={item.index} className="px-5 py-5"><p className="flex items-center gap-2 text-[11px] text-faint"><span className={`h-[6px] w-[6px] rounded-full ${dotClass[item.statusTone]}`} aria-hidden="true" />{item.index} · {item.status}</p><h3 className="mt-2.5 text-[13.5px] font-medium leading-5 text-ink">{item.title}</h3><p className="num mt-2 text-[12px] leading-5 text-muted">{item.detail}</p></article>)}</div></Panel>}
