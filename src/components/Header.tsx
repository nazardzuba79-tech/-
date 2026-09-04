import React, { useState } from 'react';
import { BellIcon, ChevronDownIcon, GlobeIcon } from 'lucide-react';
import { navItems } from '../data/market';

export function Header() {
  const [active, setActive] = useState('Аналитика');
  return (
    <header className="sticky top-0 z-40 w-full border-b border-ink-line bg-ink">
      <div className="mx-auto flex h-[60px] max-w-[1560px] items-center gap-8 px-6">
        <a href="#" className="flex shrink-0 items-center gap-2.5" aria-label="VOLTEX"><span className="flex h-7 w-7 items-center justify-center border border-accent text-[13px] font-bold text-accent-bright">V</span><span className="text-[15px] font-bold tracking-[0.22em] text-white">VOLTEX</span></a>
        <nav aria-label="Основная навигация" className="hidden min-w-0 flex-1 overflow-x-auto md:block"><ul className="flex items-center gap-1">{navItems.map(item=>{const isActive=item===active;return <li key={item}><button type="button" onClick={()=>setActive(item)} aria-current={isActive?'page':undefined} className={`relative flex h-[59px] items-center px-3 text-[13px] transition-colors duration-150 ease-out ${isActive?'font-medium text-white':'text-ink-mute hover:text-white'}`}>{item}{isActive&&<span className="absolute inset-x-2 bottom-0 h-[2px] bg-accent-bright" />}</button></li>})}</ul></nav>
        <div className="ml-auto flex items-center gap-1"><button type="button" className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] text-ink-mute transition-colors duration-150 ease-out hover:text-white"><GlobeIcon className="h-4 w-4" aria-hidden="true" />RU<ChevronDownIcon className="h-3.5 w-3.5" aria-hidden="true" /></button><button type="button" aria-label="Уведомления" className="relative flex h-8 w-8 items-center justify-center text-ink-mute transition-colors duration-150 ease-out hover:text-white"><BellIcon className="h-4 w-4" aria-hidden="true" /><span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent-bright" /></button><span className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-accent-bright text-[11px] font-semibold text-ink">АК</span></div>
      </div>
    </header>
  );
}
