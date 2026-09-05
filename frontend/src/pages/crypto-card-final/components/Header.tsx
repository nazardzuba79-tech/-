import { MenuIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { useCardCopy } from '../useCardCopy';

/** Product anchors complement the real exchange Nav; never replace its routing. */
export function Header() {
  const { c } = useCardCopy();
  const navItems = [
    { label: c.navBenefits, href: '#possibilities' }, { label: c.navHow, href: '#how-it-works' },
    { label: c.navCards, href: '#cards' }, { label: c.navFees, href: '#fees' }, { label: c.navFaq, href: '#faq' },
  ];
  const [open, setOpen] = useState(false);
  return <div className="crypto-card-section-nav vc-border-b vc-border-white/[0.07] vc-bg-voltex-black">
    <div className="vc-mx-auto vc-flex vc-h-16 vc-max-w-[1440px] vc-items-center vc-justify-between vc-gap-4 vc-px-5 sm:vc-px-8 lg:vc-h-20 lg:vc-px-12">
      <a href="#top" className="vc-flex vc-items-center vc-gap-2.5 vc-text-sm vc-font-bold vc-tracking-tight vc-text-white" aria-label={c.navTop}><span>VOLTEX</span><span className="vc-text-[10px] vc-font-semibold vc-tracking-wide3 vc-text-voltex-goldLight">CARD</span></a>
      <nav className="vc-hidden vc-items-center vc-gap-7 lg:vc-flex" aria-label={c.navSections}>{navItems.map(item => <a key={item.href} href={item.href} className="vc-text-sm vc-text-voltex-muted vc-transition-colors hover:vc-text-white">{item.label}</a>)}</nav>
      <a href="#apply" className="vc-hidden vc-whitespace-nowrap vc-rounded-full vc-bg-white vc-px-6 vc-py-3 vc-text-sm vc-font-semibold vc-text-black vc-transition-colors hover:vc-bg-voltex-goldLight sm:vc-inline-flex">{c.getCard}</a>
      <button type="button" className="vc-grid vc-h-10 vc-w-10 vc-place-items-center vc-text-white lg:vc-hidden" onClick={() => setOpen(!open)} aria-label={open ? c.navClose : c.navOpen} aria-expanded={open} aria-controls="crypto-card-mobile-sections">{open ? <XIcon size={21} /> : <MenuIcon size={21} />}</button>
    </div>
    {open && <nav id="crypto-card-mobile-sections" className="vc-border-t vc-border-white/10 vc-bg-voltex-black vc-px-5 vc-pb-6 vc-pt-4 lg:vc-hidden" aria-label={c.navSections}>
      {navItems.map(item => <a key={item.href} href={item.href} onClick={() => setOpen(false)} className="vc-block vc-border-b vc-border-white/[0.07] vc-py-4 vc-text-base vc-text-voltex-text">{item.label}</a>)}
      <a href="#apply" onClick={() => setOpen(false)} className="vc-mt-5 vc-flex vc-justify-center vc-rounded-full vc-bg-white vc-px-6 vc-py-3 vc-text-sm vc-font-semibold vc-text-black">{c.getCard}</a>
    </nav>}
  </div>;
}
